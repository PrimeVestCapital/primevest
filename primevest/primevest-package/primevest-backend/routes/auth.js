// routes/auth.js – Register, Login, Refresh, Logout (Postgres/Neon)
"use strict";

const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const rateLimit = require("express-rate-limit");

const db = require("../db/database");
const {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
} = require("../utils/jwt");

const { requireAuth } = require("../middleware/auth");
const { sendEmail, templates } = require("../utils/email");

// ─── Rate limiter ─────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  message: {
    success: false,
    message: "Too many authentication attempts. Please try again later.",
  },
});

// ─── Helper ───────────────────────────────────
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

// ──────────────────────────────────────────────
// REGISTER
// ──────────────────────────────────────────────
router.post("/register", authLimiter, async (req, res, next) => {
  try {
    const { name, email, password, pin } = req.body;

    if (!name || !email || !password || !pin) {
      return res.status(400).json({ success: false, message: "All fields required." });
    }

    const emailNorm = email.toLowerCase().trim();

    const existing = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [emailNorm]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: "Email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const pinHash = await bcrypt.hash(pin, 10);

    const userId = uuidv4();
    const now = Date.now();

    await db.query(
      `INSERT INTO users
      (id, name, email, password_hash, pin_hash, role, plan, balance, profit, join_date, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,'user','Starter',0,0,$6,$7,$8)`,
      [userId, name.trim(), emailNorm, passwordHash, pinHash, now, now, now]
    );

    const newUserRes = await db.query(
      "SELECT * FROM users WHERE id = $1",
      [userId]
    );

    const newUser = newUserRes.rows[0];

    const accessToken = generateAccessToken(newUser);
    const refreshToken = generateRefreshToken();

    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1,$2,$3)`,
      [userId, hashToken(refreshToken), refreshTokenExpiry()]
    );

    const emailTpl = templates.welcomeEmail(newUser);
    sendEmail(newUser.email, emailTpl).catch(() => {});

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

// ──────────────────────────────────────────────
// LOGIN
// ──────────────────────────────────────────────
router.post("/login", authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const emailNorm = email.toLowerCase().trim();

    // Admin shortcut
    const adminEmail = process.env.ADMIN_EMAIL || "admin@primevest.com";
    const adminPassword = process.env.ADMIN_PASSWORD || "Admin@2024";

    if (email === adminEmail && password === adminPassword) {
      let adminRes = await db.query(
        "SELECT * FROM users WHERE email = $1 AND role = 'admin'",
        [adminEmail]
      );

      let adminUser = adminRes.rows[0];

      if (!adminUser) {
        const adminId = uuidv4();
        const passwordHash = await bcrypt.hash(adminPassword, 12);
        const pinHash = await bcrypt.hash("0000", 10);
        const now = Date.now();

        await db.query(
          `INSERT INTO users
          (id, name, email, password_hash, pin_hash, role, plan, balance, profit, join_date, created_at, updated_at)
          VALUES ($1,'Administrator',$2,$3,$4,'admin','Admin',0,0,$5,$6,$7)`,
          [adminId, adminEmail, passwordHash, pinHash, now, now, now]
        );

        adminRes = await db.query("SELECT * FROM users WHERE id = $1", [adminId]);
        adminUser = adminRes.rows[0];
      }

      const accessToken = generateAccessToken(adminUser);
      const refreshToken = generateRefreshToken();

      await db.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1,$2,$3)`,
        [adminUser.id, hashToken(refreshToken), refreshTokenExpiry()]
      );

      return res.json({
        success: true,
        message: "Admin login successful.",
        data: {
          accessToken,
          refreshToken,
          user: { ...buildUserPayload(adminUser), role: "admin" },
        },
      });
    }

    const userRes = await db.query(
      "SELECT * FROM users WHERE email = $1 AND role = 'user'",
      [emailNorm]
    );

    const user = userRes.rows[0];

    if (!user) {
      await bcrypt.compare(password, "$2a$12$fakehash");
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: "Account disabled." });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();

    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1,$2,$3)`,
      [user.id, hashToken(refreshToken), refreshTokenExpiry()]
    );

    const txRes = await db.query(
      "SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20",
      [user.id]
    );

    const profitRes = await db.query(
      "SELECT month, value FROM profit_history WHERE user_id = $1 ORDER BY month ASC",
      [user.id]
    );

    return res.json({
      success: true,
      message: "Login successful.",
      data: {
        accessToken,
        refreshToken,
        user: {
          ...buildUserPayload(user),
          transactions: txRes.rows,
          profitHistory: profitRes.rows,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────
// REFRESH TOKEN
// ──────────────────────────────────────────────
router.post("/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    const tokenHash = hashToken(refreshToken);

    const result = await db.query(
      `SELECT rt.*, u.id, u.email, u.role, u.is_active
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.token_hash = $1 AND rt.expires_at > $2`,
      [tokenHash, Date.now()]
    );

    const row = result.rows[0];

    if (!row) {
      return res.status(401).json({ success: false, message: "Invalid refresh token." });
    }

    await db.query("DELETE FROM refresh_tokens WHERE token_hash = $1", [tokenHash]);

    const newRefresh = generateRefreshToken();
    const newAccess = generateAccessToken(row);

    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1,$2,$3)`,
      [row.id, hashToken(newRefresh), refreshTokenExpiry()]
    );

    return res.json({
      success: true,
      data: {
        accessToken: newAccess,
        refreshToken: newRefresh,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────
// LOGOUT
// ──────────────────────────────────────────────
router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      await db.query(
        "DELETE FROM refresh_tokens WHERE token_hash = $1",
        [hashToken(refreshToken)]
      );
    }

    return res.json({ success: true, message: "Logged out." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;