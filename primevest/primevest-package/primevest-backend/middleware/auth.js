// middleware/auth.js – JWT authentication & role guards
"use strict";

const { verifyAccessToken } = require("../utils/jwt");
const db = require("../db/database");

/**
 * requireAuth – validates Bearer JWT and attaches req.user
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Authentication required. Please sign in." });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = verifyAccessToken(token);

    // Verify user still exists and is active
    const user = db
      .prepare("SELECT id, email, role, name, is_active FROM users WHERE id = ?")
      .get(decoded.sub);

    if (!user) {
      return res.status(401).json({ success: false, message: "User account not found." });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: "Account has been deactivated. Contact support." });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Session expired. Please sign in again.", code: "TOKEN_EXPIRED" });
    }
    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ success: false, message: "Invalid authentication token." });
    }
    return res.status(401).json({ success: false, message: "Authentication failed." });
  }
}

/**
 * requireAdmin – must be used after requireAuth
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required." });
  }
  next();
}

/**
 * optionalAuth – attaches req.user if token present, doesn't fail if absent
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }
  try {
    const token = authHeader.slice(7);
    const decoded = verifyAccessToken(token);
    const user = db
      .prepare("SELECT id, email, role, name, is_active FROM users WHERE id = ?")
      .get(decoded.sub);
    if (user && user.is_active) req.user = user;
  } catch (_) {
    // ignore
  }
  next();
}

module.exports = { requireAuth, requireAdmin, optionalAuth };
