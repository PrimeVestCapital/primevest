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
function getUserFull(userId) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return null;

  const transactions = db.prepare(`
    SELECT id, type, amount, status, note, created_at as date
    FROM transactions WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId);

  const profitHistory = db.prepare(`
    SELECT month, value FROM profit_history WHERE user_id = ? ORDER BY month ASC
  `).all(userId);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    plan: user.plan,
    balance: user.balance,
    profit: user.profit,
    joinDate: user.join_date,
    transactions,
    profitHistory,
  };
}

// ─── GET /api/users/me ───────────────────────────────────────────────
router.get("/me", (req, res, next) => {
  try {
    const userData = getUserFull(req.user.id);
    if (!userData) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    return res.json({ success: true, data: userData });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/users/transactions ────────────────────────────────────
router.get("/transactions", (req, res, next) => {
  try {
    const { limit = 50, offset = 0, type } = req.query;

    let query = `
      SELECT id, type, amount, status, note, created_at as date
      FROM transactions WHERE user_id = ?
    `;
    const params = [req.user.id];

    if (type && ["deposit", "withdrawal", "profit", "adjustment"].includes(type)) {
      query += " AND type = ?";
      params.push(type);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), parseInt(offset));

    const transactions = db.prepare(query).all(...params);
    const total = db.prepare(
      "SELECT COUNT(*) as count FROM transactions WHERE user_id = ?"
    ).get(req.user.id).count;

    return res.json({
      success: true,
      data: transactions,
      pagination: { total, limit: parseInt(limit), offset: parseInt(offset) },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/users/withdraw ────────────────────────────────────────
router.post("/withdraw", async (req, res, next) => {
  try {
    const { amount, pin } = req.body;

    // Validate inputs
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: "Please enter a valid withdrawal amount." });
    }
    if (!pin || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ success: false, message: "Please enter a valid 4-digit PIN." });
    }

    const withdrawAmt = parseFloat(parseFloat(amount).toFixed(2));

    // Get fresh user data
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    // Verify PIN
    const pinValid = await bcrypt.compare(pin, user.pin_hash);
    if (!pinValid) {
      return res.status(400).json({ success: false, message: "Incorrect security PIN. Please try again.", code: "WRONG_PIN" });
    }

    // Check funds
    const totalPortfolio = user.balance + user.profit;
    if (withdrawAmt > totalPortfolio) {
      return res.status(400).json({ success: false, message: `Insufficient funds. Available: $${totalPortfolio.toFixed(2)}` });
    }

    // Calculate new balance/profit (deduct from profit first, then balance)
    let newProfit = user.profit;
    let newBalance = user.balance;

    if (withdrawAmt <= newProfit) {
      newProfit -= withdrawAmt;
    } else {
      const remainder = withdrawAmt - newProfit;
      newProfit = 0;
      newBalance = Math.max(0, newBalance - remainder);
    }

    const txId = uuidv4();
    const now = Date.now();

    // Atomic transaction
    const doWithdraw = db.transaction(() => {
      db.prepare(`UPDATE users SET balance = ?, profit = ?, updated_at = ? WHERE id = ?`)
        .run(newBalance, newProfit, now, user.id);

      db.prepare(`
        INSERT INTO transactions (id, user_id, type, amount, status, note, created_at)
        VALUES (?, ?, 'withdrawal', ?, 'confirmed', 'Client withdrawal', ?)
      `).run(txId, user.id, withdrawAmt, now);
    });

    doWithdraw();

    // Fetch updated user
    const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);

    // Send email (non-blocking)
    const { subject, html, text } = templates.withdrawalEmail(updatedUser, withdrawAmt, txId);
    sendEmail(user.email, { subject, html, text }).catch(() => {});

    db.prepare("INSERT INTO notifications (user_id, subject, body) VALUES (?, ?, ?)")
      .run(user.id, subject, `Withdrawal of $${withdrawAmt} processed`);

    return res.json({
      success: true,
      message: `Withdrawal of $${withdrawAmt.toFixed(2)} processed successfully. Funds will arrive in 1–3 business days.`,
      data: {
        transaction: {
          id: txId,
          type: "withdrawal",
          amount: withdrawAmt,
          date: now,
          status: "confirmed",
          note: "Client withdrawal",
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
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);

    const updates = {};
    const now = Date.now();

    if (name && name.trim().length >= 2) {
      updates.name = name.trim();
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: "Current password required to change password." });
      }
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) {
        return res.status(400).json({ success: false, message: "Current password is incorrect." });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ success: false, message: "New password must be at least 8 characters." });
      }
      updates.password_hash = await bcrypt.hash(newPassword, 12);
    }

    if (newPin) {
      if (!/^\d{4}$/.test(newPin)) {
        return res.status(400).json({ success: false, message: "PIN must be exactly 4 digits." });
      }
      if (!currentPin) {
        return res.status(400).json({ success: false, message: "Current PIN required to change PIN." });
      }
      const pinValid = await bcrypt.compare(currentPin, user.pin_hash);
      if (!pinValid) {
        return res.status(400).json({ success: false, message: "Current PIN is incorrect." });
      }
      updates.pin_hash = await bcrypt.hash(newPin, 10);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields to update." });
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(", ");
    db.prepare(`UPDATE users SET ${setClauses}, updated_at = ? WHERE id = ?`)
      .run(...Object.values(updates), now, user.id);

    return res.json({ success: true, message: "Profile updated successfully." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
