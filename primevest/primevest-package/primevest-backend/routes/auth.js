// routes/auth.js – Register, Login, Refresh, Logout
"use strict";

const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const rateLimit = require("express-rate-limit");

const db = require("../db/database");
const { generateAccessToken, generateRefreshToken, hashToken, refreshTokenExpiry } = require("../utils/jwt");
const { requireAuth } = require("../middleware/auth");
const { sendEmail, templates } = require("../utils/email");

// Strict rate limit on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  message: { success: false, message: "Too many authentication attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Helper: build user response object ────────────────────────────
function buildUserPayload(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    plan: user.plan,
    balance: user.balance,
    profit: user.profit,
    joinDate: user.join_date,
  };
}

// ─── POST /api/auth/register ────────────────────────────────────────
router.post("/register", authLimiter, async (req, res, next) => {
  try {
    const { name, email, password, pin } = req.body;

    // Validation
    if (!name || !email || !password || !pin) {
      return res.status(400).json({ success: false, message: "All fields are required." });
    }
    if (name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({ success: false, message: "Name must be between 2 and 100 characters." });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ success: false, message: "PIN must be exactly 4 digits." });
    }

    // Check duplicate email
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase().trim());
    if (existing) {
      return res.status(409).json({ success: false, message: "An account with this email already exists." });
    }

    // Hash credentials
    const [passwordHash, pinHash] = await Promise.all([
      bcrypt.hash(password, 12),
      bcrypt.hash(pin, 10),
    ]);

    const userId = uuidv4();
    const now = Date.now();

    // Create user + initial profit history in a transaction
    const insertUser = db.transaction(() => {
      db.prepare(`
        INSERT INTO users (id, name, email, password_hash, pin_hash, role, plan, balance, profit, join_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'user', 'Starter', 0, 0, ?, ?, ?)
      `).run(userId, name.trim(), email.toLowerCase().trim(), passwordHash, pinHash, now, now, now);

      // Seed 12 months of zero profit history
      const insertHistory = db.prepare(`
        INSERT OR IGNORE INTO profit_history (user_id, month, year, value) VALUES (?, ?, ?, 0)
      `);
      const currentYear = new Date().getFullYear();
      for (let m = 1; m <= 12; m++) {
        insertHistory.run(userId, m, currentYear);
      }
    });

    insertUser();

    const newUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);

    // Issue tokens
    const accessToken = generateAccessToken(newUser);
    const refreshToken = generateRefreshToken();
    const refreshHash = hashToken(refreshToken);
    const expiresAt = refreshTokenExpiry();

    db.prepare(`
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)
    `).run(userId, refreshHash, expiresAt);

    // Send welcome email (non-blocking)
    const { subject, html, text } = templates.welcomeEmail(newUser);
    sendEmail(newUser.email, { subject, html, text }).catch(() => {});

    // Log notification
    db.prepare(`
      INSERT INTO notifications (user_id, subject, body) VALUES (?, ?, ?)
    `).run(userId, subject, "Welcome email sent");

    return res.status(201).json({
      success: true,
      message: "Account created successfully.",
      data: {
        accessToken,
        refreshToken,
        user: buildUserPayload(newUser),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/login ────────────────────────────────────────────
router.post("/login", authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    // Check admin credentials
    const adminEmail = process.env.ADMIN_EMAIL || "admin@primevest.com";
    const adminPassword = process.env.ADMIN_PASSWORD || "Admin@2024";

    if (email === adminEmail && password === adminPassword) {
      // Get or create admin user record
      let adminUser = db.prepare("SELECT * FROM users WHERE email = ? AND role = 'admin'").get(adminEmail);

      if (!adminUser) {
        const adminId = uuidv4();
        const passwordHash = await bcrypt.hash(adminPassword, 12);
        const pinHash = await bcrypt.hash("0000", 10);
        const now = Date.now();
        db.prepare(`
          INSERT INTO users (id, name, email, password_hash, pin_hash, role, plan, balance, profit, join_date, created_at, updated_at)
          VALUES (?, 'Administrator', ?, ?, ?, 'admin', 'Admin', 0, 0, ?, ?, ?)
        `).run(adminId, adminEmail, passwordHash, pinHash, now, now, now);
        adminUser = db.prepare("SELECT * FROM users WHERE id = ?").get(adminId);
      }

      const accessToken = generateAccessToken(adminUser);
      const refreshToken = generateRefreshToken();
      db.prepare("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
        .run(adminUser.id, hashToken(refreshToken), refreshTokenExpiry());

      return res.json({
        success: true,
        message: "Admin login successful.",
        data: { accessToken, refreshToken, user: { ...buildUserPayload(adminUser), role: "admin" } },
      });
    }

    // Regular user login
    const user = db.prepare("SELECT * FROM users WHERE email = ? AND role = 'user'").get(email.toLowerCase().trim());
    if (!user) {
      // Timing-safe: still hash even on miss
      await bcrypt.compare(password, "$2a$12$invalidhashfortimingatk");
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: "Account deactivated. Contact support." });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();
    db.prepare("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
      .run(user.id, hashToken(refreshToken), refreshTokenExpiry());

    // Fetch transactions for the user
    const transactions = db.prepare(`
      SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
    `).all(user.id);

    const profitHistory = db.prepare(`
      SELECT month, value FROM profit_history WHERE user_id = ? ORDER BY month ASC
    `).all(user.id);

    return res.json({
      success: true,
      message: "Login successful.",
      data: {
        accessToken,
        refreshToken,
        user: {
          ...buildUserPayload(user),
          transactions: transactions.map(tx => ({
            id: tx.id,
            type: tx.type,
            amount: tx.amount,
            date: tx.created_at,
            status: tx.status,
            note: tx.note,
          })),
          profitHistory: profitHistory.map(h => ({ month: h.month, value: h.value })),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/refresh ──────────────────────────────────────────
router.post("/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: "Refresh token is required." });
    }

    const tokenHash = hashToken(refreshToken);
    const stored = db.prepare(`
      SELECT rt.*, u.id as uid, u.email, u.role, u.name, u.is_active
      FROM refresh_tokens rt
      JOIN users u ON rt.user_id = u.id
      WHERE rt.token_hash = ? AND rt.expires_at > ?
    `).get(tokenHash, Date.now());

    if (!stored) {
      return res.status(401).json({ success: false, message: "Invalid or expired refresh token." });
    }

    if (!stored.is_active) {
      return res.status(403).json({ success: false, message: "Account deactivated." });
    }

    // Rotate refresh token
    db.prepare("DELETE FROM refresh_tokens WHERE token_hash = ?").run(tokenHash);
    const newRefreshToken = generateRefreshToken();
    const newAccessToken = generateAccessToken({ id: stored.uid, email: stored.email, role: stored.role });
    db.prepare("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
      .run(stored.uid, hashToken(newRefreshToken), refreshTokenExpiry());

    return res.json({
      success: true,
      data: { accessToken: newAccessToken, refreshToken: newRefreshToken },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/logout ───────────────────────────────────────────
router.post("/logout", requireAuth, (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    db.prepare("DELETE FROM refresh_tokens WHERE token_hash = ?").run(hashToken(refreshToken));
  }
  // Optionally invalidate all sessions
  // db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(req.user.id);
  return res.json({ success: true, message: "Logged out successfully." });
});

module.exports = router;
