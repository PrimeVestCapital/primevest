// routes/admin.js – Admin-only endpoints
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
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getUserWithDetails(userId) {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(userId);
  if (!user) return null;

  const transactions = db.prepare(`
    SELECT id, type, amount, status, note, created_at as date
    FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(userId);

  const profitHistory = db.prepare(`
    SELECT month, value FROM profit_history WHERE user_id = ? ORDER BY month ASC
  `).all(userId);

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

// ─── GET /api/admin/dashboard ────────────────────────────────────────
router.get("/dashboard", (req, res, next) => {
  try {
    const users = db.prepare("SELECT * FROM users WHERE role = 'user' AND is_active = 1").all();

    const totalAUM = users.reduce((s, u) => s + u.balance + u.profit, 0);
    const totalProfit = users.reduce((s, u) => s + u.profit, 0);
    const totalBalance = users.reduce((s, u) => s + u.balance, 0);

    const recentTx = db.prepare(`
      SELECT t.*, u.name as user_name, u.email as user_email
      FROM transactions t JOIN users u ON t.user_id = u.id
      ORDER BY t.created_at DESC LIMIT 10
    `).all();

    return res.json({
      success: true,
      data: {
        stats: {
          totalClients: users.length,
          totalAUM,
          totalProfit,
          totalBalance,
        },
        recentTransactions: recentTx.map(tx => ({
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

// ─── GET /api/admin/users ────────────────────────────────────────────
router.get("/users", (req, res, next) => {
  try {
    const { search, plan, limit = 100, offset = 0 } = req.query;

    let query = "SELECT * FROM users WHERE role = 'user'";
    const params = [];

    if (search) {
      query += " AND (name LIKE ? OR email LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }
    if (plan) {
      query += " AND plan = ?";
      params.push(plan);
    }

    query += " ORDER BY join_date DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), parseInt(offset));

    const users = db.prepare(query).all(...params);
    const total = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'user'").get().count;

    return res.json({
      success: true,
      data: users.map(u => ({
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
      pagination: { total, limit: parseInt(limit), offset: parseInt(offset) },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/users/:id ────────────────────────────────────────
router.get("/users/:id", (req, res, next) => {
  try {
    const userData = getUserWithDetails(req.params.id);
    if (!userData) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    return res.json({ success: true, data: userData });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/admin/users/:id/portfolio ──────────────────────────────
router.put("/users/:id/portfolio", async (req, res, next) => {
  try {
    const { balance, profit, plan } = req.body;

    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const newBalance = parseFloat(balance);
    const newProfit = parseFloat(profit);
    const validPlans = ["Starter", "Growth", "Premium", "Platinum"];

    if (isNaN(newBalance) || newBalance < 0) {
      return res.status(400).json({ success: false, message: "Invalid balance value." });
    }
    if (isNaN(newProfit) || newProfit < 0) {
      return res.status(400).json({ success: false, message: "Invalid profit value." });
    }
    if (plan && !validPlans.includes(plan)) {
      return res.status(400).json({ success: false, message: `Plan must be one of: ${validPlans.join(", ")}` });
    }

    const txId = uuidv4();
    const now = Date.now();
    const newPlan = plan || user.plan;

    const doUpdate = db.transaction(() => {
      db.prepare(`
        UPDATE users SET balance = ?, profit = ?, plan = ?, updated_at = ? WHERE id = ?
      `).run(newBalance, newProfit, newPlan, now, user.id);

      // Record the balance change as a transaction
      if (newBalance !== user.balance) {
        const diff = newBalance - user.balance;
        const txType = diff >= 0 ? "deposit" : "adjustment";
        db.prepare(`
          INSERT INTO transactions (id, user_id, type, amount, status, note, created_at)
          VALUES (?, ?, ?, ?, 'confirmed', 'Admin portfolio update', ?)
        `).run(txId, user.id, txType, Math.abs(diff), now);
      }

      // Update latest month profit history
      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();
      db.prepare(`
        INSERT INTO profit_history (user_id, month, year, value) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, month, year) DO UPDATE SET value = excluded.value
      `).run(user.id, currentMonth, currentYear, newProfit);
    });

    doUpdate();

    const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);

    // Send email notification
    const { subject, html, text } = templates.portfolioUpdateEmail(updatedUser, {
      balance: newBalance,
      profit: newProfit,
      plan: newPlan,
    });
    sendEmail(user.email, { subject, html, text }).catch(() => {});
    db.prepare("INSERT INTO notifications (user_id, subject, body) VALUES (?, ?, ?)")
      .run(user.id, subject, `Portfolio updated by admin: balance=$${newBalance}, profit=$${newProfit}`);

    return res.json({
      success: true,
      message: `Portfolio updated and notification sent to ${user.email}`,
      data: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        plan: updatedUser.plan,
        balance: updatedUser.balance,
        profit: updatedUser.profit,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/users/:id/deposit ───────────────────────────────
router.post("/users/:id/deposit", async (req, res, next) => {
  try {
    const { amount, note } = req.body;
    const depositAmt = parseFloat(amount);

    if (isNaN(depositAmt) || depositAmt <= 0) {
      return res.status(400).json({ success: false, message: "Invalid deposit amount." });
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const txId = uuidv4();
    const now = Date.now();
    const newBalance = user.balance + depositAmt;

    db.transaction(() => {
      db.prepare("UPDATE users SET balance = ?, updated_at = ? WHERE id = ?")
        .run(newBalance, now, user.id);
      db.prepare(`
        INSERT INTO transactions (id, user_id, type, amount, status, note, created_at)
        VALUES (?, ?, 'deposit', ?, 'confirmed', ?, ?)
      `).run(txId, user.id, depositAmt, note || "Admin deposit", now);
    })();

    const { subject, html, text } = templates.depositEmail({ ...user, balance: newBalance }, depositAmt, txId);
    sendEmail(user.email, { subject, html, text }).catch(() => {});

    return res.json({
      success: true,
      message: `$${depositAmt.toFixed(2)} deposited to ${user.name}'s account.`,
      data: { transactionId: txId, newBalance },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/users/:id/credit-profit ─────────────────────────
router.post("/users/:id/credit-profit", async (req, res, next) => {
  try {
    const { amount, note } = req.body;
    const profitAmt = parseFloat(amount);

    if (isNaN(profitAmt) || profitAmt <= 0) {
      return res.status(400).json({ success: false, message: "Invalid profit amount." });
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const txId = uuidv4();
    const now = Date.now();
    const newProfit = user.profit + profitAmt;
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    db.transaction(() => {
      db.prepare("UPDATE users SET profit = ?, updated_at = ? WHERE id = ?")
        .run(newProfit, now, user.id);
      db.prepare(`
        INSERT INTO transactions (id, user_id, type, amount, status, note, created_at)
        VALUES (?, ?, 'profit', ?, 'confirmed', ?, ?)
      `).run(txId, user.id, profitAmt, note || "Monthly profit credit", now);
      db.prepare(`
        INSERT INTO profit_history (user_id, month, year, value) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, month, year) DO UPDATE SET value = value + excluded.value
      `).run(user.id, currentMonth, currentYear, profitAmt);
    })();

    return res.json({
      success: true,
      message: `$${profitAmt.toFixed(2)} profit credited to ${user.name}.`,
      data: { transactionId: txId, newProfit },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/notify ───────────────────────────────────────────
router.post("/notify", async (req, res, next) => {
  try {
    const { userId, subject, body } = req.body;

    if (!subject || !body) {
      return res.status(400).json({ success: false, message: "Subject and message body are required." });
    }

    let recipients;

    if (!userId || userId === "all") {
      recipients = db.prepare("SELECT * FROM users WHERE role = 'user' AND is_active = 1").all();
    } else {
      const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }
      recipients = [user];
    }

    if (recipients.length === 0) {
      return res.status(404).json({ success: false, message: "No recipients found." });
    }

    const results = await Promise.allSettled(
      recipients.map(async (user) => {
        const { subject: emailSubject, html, text } = templates.customEmail(user, subject, body);
        await sendEmail(user.email, { subject: emailSubject, html, text });
        db.prepare("INSERT INTO notifications (user_id, subject, body) VALUES (?, ?, ?)")
          .run(user.id, subject, body);
        return user.email;
      })
    );

    const sent = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected").length;

    return res.json({
      success: true,
      message: `Notification sent to ${sent} recipient(s)${failed > 0 ? `, ${failed} failed` : ""}.`,
      data: { sent, failed, total: recipients.length },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/notifications ────────────────────────────────────
router.get("/notifications", (req, res, next) => {
  try {
    const { limit = 50 } = req.query;
    const notifications = db.prepare(`
      SELECT n.*, u.name as user_name, u.email as user_email
      FROM notifications n
      LEFT JOIN users u ON n.user_id = u.id
      ORDER BY n.sent_at DESC LIMIT ?
    `).all(parseInt(limit));

    return res.json({ success: true, data: notifications });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/admin/users/:id/status ─────────────────────────────────
router.put("/users/:id/status", (req, res, next) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== "boolean") {
      return res.status(400).json({ success: false, message: "isActive must be a boolean." });
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    db.prepare("UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?")
      .run(isActive ? 1 : 0, Date.now(), user.id);

    return res.json({
      success: true,
      message: `Account ${isActive ? "activated" : "deactivated"} successfully.`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
