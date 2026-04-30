// routes/admin.js – Admin-only endpoints (Postgres version)
"use strict";

const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");

const db = require("../db/database");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { sendEmail, templates } = require("../utils/email");

// All admin routes require auth + admin role
router.use(requireAuth, requireAdmin);

// ─── Helpers ─────────────────────────────────────────────────────────
function fmt(n) {
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ─── USER DETAILS ────────────────────────────────────────────────────
async function getUserWithDetails(userId) {
  const user = await db.get(
    "SELECT * FROM users WHERE id = $1 AND role = 'user'",
    [userId]
  );

  if (!user) return null;

  const transactions = await db.all(
    `SELECT id, type, amount, status, note, created_at as date
     FROM transactions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [userId]
  );

  const profitHistory = await db.all(
    `SELECT month, value
     FROM profit_history
     WHERE user_id = $1
     ORDER BY month ASC`,
    [userId]
  );

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    plan: user.plan,
    balance: user.balance,
    profit: user.profit,
    isActive: !!user.is_active,
    joinDate: user.join_date,
    transactions,
    profitHistory,
  };
}

// ─── DASHBOARD ───────────────────────────────────────────────────────
router.get("/dashboard", async (req, res, next) => {
  try {
    const users = await db.all(
      "SELECT * FROM users WHERE role = 'user' AND is_active = true"
    );

    const totalAUM = users.reduce((s, u) => s + u.balance + u.profit, 0);
    const totalProfit = users.reduce((s, u) => s + u.profit, 0);
    const totalBalance = users.reduce((s, u) => s + u.balance, 0);

    const recentTx = await db.all(
      `SELECT t.*, u.name as user_name, u.email as user_email
       FROM transactions t
       JOIN users u ON t.user_id = u.id
       ORDER BY t.created_at DESC
       LIMIT 10`
    );

    return res.json({
      success: true,
      data: {
        stats: {
          totalClients: users.length,
          totalAUM,
          totalProfit,
          totalBalance,
        },
        recentTransactions: recentTx.map((tx) => ({
          id: tx.id,
          type: tx.type,
          amount: tx.amount,
          status: tx.status,
          note: tx.note,
          date: tx.created_at,
          userName: tx.user_name,
          userEmail: tx.user_email,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── USERS LIST ──────────────────────────────────────────────────────
router.get("/users", async (req, res, next) => {
  try {
    const { search, plan, limit = 100, offset = 0 } = req.query;

    let query = "SELECT * FROM users WHERE role = 'user'";
    const params = [];

    if (search) {
      query += " AND (name ILIKE $1 OR email ILIKE $2)";
      params.push(`%${search}%`, `%${search}%`);
    }

    if (plan) {
      query += ` AND plan = $${params.length + 1}`;
      params.push(plan);
    }

    query += ` ORDER BY join_date DESC LIMIT $${params.length + 1} OFFSET $${
      params.length + 2
    }`;

    params.push(parseInt(limit), parseInt(offset));

    const users = await db.all(query, params);

    const total = await db.get(
      "SELECT COUNT(*) FROM users WHERE role = 'user'"
    );

    return res.json({
      success: true,
      data: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        plan: u.plan,
        balance: u.balance,
        profit: u.profit,
        portfolio: u.balance + u.profit,
        isActive: !!u.is_active,
        joinDate: u.join_date,
      })),
      pagination: {
        total: parseInt(total.count || total.count),
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── SINGLE USER ─────────────────────────────────────────────────────
router.get("/users/:id", async (req, res, next) => {
  try {
    const userData = await getUserWithDetails(req.params.id);

    if (!userData) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    return res.json({ success: true, data: userData });
  } catch (err) {
    next(err);
  }
});

// ─── UPDATE PORTFOLIO ───────────────────────────────────────────────
router.put("/users/:id/portfolio", async (req, res, next) => {
  try {
    const { balance, profit, plan } = req.body;

    const user = await db.get(
      "SELECT * FROM users WHERE id = $1 AND role = 'user'",
      [req.params.id]
    );

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    const newBalance = parseFloat(balance);
    const newProfit = parseFloat(profit);
    const validPlans = ["Starter", "Growth", "Premium", "Platinum"];

    if (isNaN(newBalance) || newBalance < 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid balance value." });
    }

    if (isNaN(newProfit) || newProfit < 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid profit value." });
    }

    if (plan && !validPlans.includes(plan)) {
      return res.status(400).json({
        success: false,
        message: `Plan must be one of: ${validPlans.join(", ")}`,
      });
    }

    const txId = uuidv4();
    const now = Date.now();
    const newPlan = plan || user.plan;

    await db.query("BEGIN");

    try {
      await db.query(
        `UPDATE users
         SET balance = $1, profit = $2, plan = $3, updated_at = $4
         WHERE id = $5`,
        [newBalance, newProfit, newPlan, now, user.id]
      );

      if (newBalance !== user.balance) {
        const diff = newBalance - user.balance;
        const txType = diff >= 0 ? "deposit" : "adjustment";

        await db.query(
          `INSERT INTO transactions (id, user_id, type, amount, status, note, created_at)
           VALUES ($1, $2, $3, $4, 'confirmed', 'Admin portfolio update', $5)`,
          [txId, user.id, txType, Math.abs(diff), now]
        );
      }

      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();

      await db.query(
        `INSERT INTO profit_history (user_id, month, year, value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, month, year)
         DO UPDATE SET value = EXCLUDED.value`,
        [user.id, currentMonth, currentYear, newProfit]
      );

      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }

    const updatedUser = await db.get(
      "SELECT * FROM users WHERE id = $1",
      [user.id]
    );

    const { subject, html, text } = templates.portfolioUpdateEmail(
      updatedUser,
      {
        balance: newBalance,
        profit: newProfit,
        plan: newPlan,
      }
    );

    sendEmail(user.email, { subject, html, text }).catch(() => {});

    await db.query(
      "INSERT INTO notifications (user_id, subject, body) VALUES ($1, $2, $3)",
      [
        user.id,
        subject,
        `Portfolio updated: balance=$${newBalance}, profit=$${newProfit}`,
      ]
    );

    return res.json({
      success: true,
      message: `Portfolio updated and notification sent to ${user.email}`,
      data: updatedUser,
    });
  } catch (err) {
    next(err);
  }
});

// ─── DEPOSIT ────────────────────────────────────────────────────────
router.post("/users/:id/deposit", async (req, res, next) => {
  try {
    const { amount, note } = req.body;
    const depositAmt = parseFloat(amount);

    if (isNaN(depositAmt) || depositAmt <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid deposit amount." });
    }

    const user = await db.get(
      "SELECT * FROM users WHERE id = $1 AND role = 'user'",
      [req.params.id]
    );

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    const txId = uuidv4();
    const now = Date.now();
    const newBalance = user.balance + depositAmt;

    await db.query("BEGIN");

    try {
      await db.query(
        "UPDATE users SET balance = $1, updated_at = $2 WHERE id = $3",
        [newBalance, now, user.id]
      );

      await db.query(
        `INSERT INTO transactions (id, user_id, type, amount, status, note, created_at)
         VALUES ($1, $2, 'deposit', $3, 'confirmed', $4, $5)`,
        [txId, user.id, depositAmt, note || "Admin deposit", now]
      );

      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }

    return res.json({
      success: true,
      message: `$${depositAmt.toFixed(
        2
      )} deposited to ${user.name}'s account.`,
      data: { transactionId: txId, newBalance },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;