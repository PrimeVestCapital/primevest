// routes/users.js – User profile, transactions, withdrawal
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
    const { amount, pin } = req.body;

    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount." });
    }

    if (!pin || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ success: false, message: "Invalid PIN." });
    }

    const userRes = await db.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = userRes.rows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const pinValid = await bcrypt.compare(pin, user.pin_hash);
    if (!pinValid) {
      return res.status(400).json({ success: false, message: "Incorrect PIN.", code: "WRONG_PIN" });
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

    // ─── Manual "transaction" (Postgres style) ───
    await db.query("BEGIN");

    try {
      await db.query(
        "UPDATE users SET balance = $1, profit = $2, updated_at = $3 WHERE id = $4",
        [newBalance, newProfit, now, user.id]
      );

      await db.query(
        `INSERT INTO transactions (id, user_id, type, amount, status, note, created_at)
         VALUES ($1, $2, 'withdrawal', $3, 'confirmed', 'Client withdrawal', $4)`,
        [txId, user.id, amount, now]
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
      [user.id, subject, `Withdrawal of $${amount} processed`]
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

module.exports = router;