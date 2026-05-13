// routes/users.js – User profile, transactions, withdrawal, support
"use strict";

const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");
const { sendEmail, templates } = require("../utils/email");

// All user routes require authentication
router.use(requireAuth);

// ─── Helper ─────────────────────────────────────────────────────────
async function getUserFull(userId) {
  const userRes = await db.query("SELECT * FROM users WHERE id = $1", [userId]);
  const user = userRes.rows[0];
  if (!user) return null;

  const txRes = await db.query(`
    SELECT id, type, amount, status, note, created_at as date
    FROM transactions
    WHERE user_id = $1
    ORDER BY created_at DESC
  `, [userId]);

  const phRes = await db.query(`
    SELECT month, value
    FROM profit_history
    WHERE user_id = $1
    ORDER BY month ASC
  `, [userId]);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    plan: user.plan,
    balance: user.balance,
    profit: user.profit,
    joinDate: user.join_date,
    transactions: txRes.rows,
    profitHistory: phRes.rows,
  };
}

// ─── GET /api/users/me ───────────────────────────────────────────────
router.get("/me", async (req, res, next) => {
  try {
    const userData = await getUserFull(req.user.id);

    if (!userData) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    return res.json({ success: true, data: userData });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/users/transactions ────────────────────────────────────
router.get("/transactions", async (req, res, next) => {
  try {
    const { limit = 50, offset = 0, type } = req.query;

    let query = `
      SELECT id, type, amount, status, note, created_at as date
      FROM transactions
      WHERE user_id = $1
    `;
    const params = [req.user.id];

    if (type && ["deposit", "withdrawal", "profit", "adjustment"].includes(type)) {
      query += " AND type = $2";
      params.push(type);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await db.query(query, params);

    const countRes = await db.query(
      "SELECT COUNT(*) FROM transactions WHERE user_id = $1",
      [req.user.id]
    );

    return res.json({
      success: true,
      data: result.rows,
      pagination: {
        total: parseInt(countRes.rows[0].count),
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/users/withdraw ────────────────────────────────────────
router.post("/withdraw", async (req, res, next) => {
  try {
    const { amount, pin, withdrawalMethod, paymentDetails, withdrawalCode } = req.body;

    // Validate amount
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount." });
    }

    // Validate PIN
    if (!pin || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ success: false, message: "Invalid PIN." });
    }

    // Validate withdrawal method
    if (!withdrawalMethod || !["bank", "crypto"].includes(withdrawalMethod)) {
      return res.status(400).json({ success: false, message: "Invalid withdrawal method." });
    }

    // Validate payment details
    if (withdrawalMethod === "bank") {
      if (!paymentDetails || !paymentDetails.accountName || !paymentDetails.bankName || !paymentDetails.accountNumber) {
        return res.status(400).json({ success: false, message: "Complete bank details required." });
      }
    } else if (withdrawalMethod === "crypto") {
      if (!paymentDetails || !paymentDetails.walletAddress) {
        return res.status(400).json({ success: false, message: "Wallet address required." });
      }
    }

    // Validate withdrawal code
    if (!withdrawalCode || withdrawalCode.trim().length === 0) {
      return res.status(400).json({ success: false, message: "Withdrawal code required." });
    }

    const userRes = await db.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = userRes.rows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    // Verify PIN
    const pinValid = await bcrypt.compare(pin, user.pin_hash);
    if (!pinValid) {
      return res.status(400).json({ success: false, message: "Incorrect PIN.", code: "WRONG_PIN" });
    }

    // Verify withdrawal code (check against user's stored code)
    const codeRes = await db.query(
      "SELECT * FROM withdrawal_codes WHERE user_id = $1 AND code = $2 AND is_used = false AND expires_at > NOW()",
      [user.id, withdrawalCode]
    );

    if (codeRes.rows.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid or expired withdrawal code. Please contact support to get a valid code.", 
        code: "INVALID_WITHDRAWAL_CODE" 
      });
    }

    const total = Number(user.balance) + Number(user.profit);

    if (amount > total) {
      return res.status(400).json({
        success: false,
        message: `Insufficient funds. Available: $${total.toFixed(2)}`
      });
    }

    let newProfit = Number(user.profit);
    let newBalance = Number(user.balance);

    if (amount <= newProfit) {
      newProfit -= amount;
    } else {
      const remainder = amount - newProfit;
      newProfit = 0;
      newBalance = Math.max(0, newBalance - remainder);
    }

    const txId = uuidv4();
    const now = new Date().toISOString();

    // Prepare payment details JSON
    const paymentDetailsJson = withdrawalMethod === "bank" 
      ? {
          method: "bank",
          accountName: paymentDetails.accountName,
          bankName: paymentDetails.bankName,
          accountNumber: paymentDetails.accountNumber
        }
      : {
          method: "crypto",
          walletAddress: paymentDetails.walletAddress,
          network: paymentDetails.network || "ERC20"
        };

    // ─── Manual "transaction" (Postgres style) ───
    await db.query("BEGIN");

    try {
      await db.query(
        "UPDATE users SET balance = $1, profit = $2, updated_at = $3 WHERE id = $4",
        [newBalance, newProfit, now, user.id]
      );

      await db.query(
        `INSERT INTO transactions (id, user_id, type, amount, status, note, payment_details, created_at)
         VALUES ($1, $2, 'withdrawal', $3, 'confirmed', $4, $5, $6)`,
        [
          txId, 
          user.id, 
          amount, 
          `${withdrawalMethod === 'bank' ? 'Bank Transfer' : 'USDT ERC20'} withdrawal`, 
          JSON.stringify(paymentDetailsJson),
          now
        ]
      );

      // Mark withdrawal code as used
      await db.query(
        "UPDATE withdrawal_codes SET is_used = true, used_at = $1 WHERE id = $2",
        [now, codeRes.rows[0].id]
      );

      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    }

    const updatedRes = await db.query("SELECT * FROM users WHERE id = $1", [user.id]);
    const updatedUser = updatedRes.rows[0];

    const { subject } = templates.withdrawalEmail(updatedUser, amount, txId);

    sendEmail(user.email, { subject }).catch(() => {});

    await db.query(
      "INSERT INTO notifications (user_id, subject, body) VALUES ($1, $2, $3)",
      [user.id, subject, `Withdrawal of $${amount} processed via ${withdrawalMethod === 'bank' ? 'Bank Transfer' : 'USDT ERC20'}`]
    );

    return res.json({
      success: true,
      message: `Withdrawal of $${amount.toFixed(2)} processed.`,
      data: {
        transaction: {
          id: txId,
          amount,
          type: "withdrawal",
          date: now,
          status: "confirmed",
        },
        newBalance: updatedUser.balance,
        newProfit: updatedUser.profit,
      },
    });

  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/users/profile ──────────────────────────────────────────
router.put("/profile", async (req, res, next) => {
  try {
    const { name, currentPassword, newPassword, newPin, currentPin } = req.body;

    const userRes = await db.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = userRes.rows[0];

    const updates = {};
    const now = new Date().toISOString();

    if (name && name.trim().length >= 2) {
      updates.name = name.trim();
    }

    if (newPassword) {
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) {
        return res.status(400).json({ success: false, message: "Wrong password." });
      }
      updates.password_hash = await bcrypt.hash(newPassword, 12);
    }

    if (newPin) {
      const pinValid = await bcrypt.compare(currentPin, user.pin_hash);
      if (!pinValid) {
        return res.status(400).json({ success: false, message: "Wrong PIN." });
      }
      updates.pin_hash = await bcrypt.hash(newPin, 10);
    }

    const keys = Object.keys(updates);
    if (!keys.length) {
      return res.status(400).json({ success: false, message: "No updates." });
    }

    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = Object.values(updates);

    await db.query(
      `UPDATE users SET ${setClause}, updated_at = $${values.length + 1} WHERE id = $${values.length + 2}`,
      [...values, now, user.id]
    );

    return res.json({ success: true, message: "Profile updated." });

  } catch (err) {
    next(err);
  }
});

// ─── GET /api/users/support/messages ─────────────────────────────────
router.get("/support/messages", async (req, res, next) => {
  try {
    const messagesRes = await db.query(
      `SELECT id, message, admin_reply, sender, created_at
       FROM support_messages
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    return res.json({
      success: true,
      data: messagesRes.rows.map(m => ({
        id: m.id,
        message: m.message,
        adminReply: m.admin_reply,
        sender: m.sender,
        createdAt: m.created_at
      }))
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/users/support/send ────────────────────────────────────
router.post("/support/send", async (req, res, next) => {
  try {
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ success: false, message: "Message cannot be empty." });
    }

    if (message.length > 1000) {
      return res.status(400).json({ success: false, message: "Message too long. Maximum 1000 characters." });
    }

    const msgId = uuidv4();
    const now = new Date().toISOString();

    await db.query(
      `INSERT INTO support_messages (id, user_id, message, sender, created_at)
       VALUES ($1, $2, $3, 'user', $4)`,
      [msgId, req.user.id, message.trim(), now]
    );

    const newMsg = await db.query(
      "SELECT id, message, admin_reply, sender, created_at FROM support_messages WHERE id = $1",
      [msgId]
    );

    return res.json({
      success: true,
      message: "Message sent to support.",
      data: {
        id: newMsg.rows[0].id,
        message: newMsg.rows[0].message,
        adminReply: newMsg.rows[0].admin_reply,
        sender: newMsg.rows[0].sender,
        createdAt: newMsg.rows[0].created_at
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
