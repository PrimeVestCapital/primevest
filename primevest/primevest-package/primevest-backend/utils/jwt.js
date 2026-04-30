// utils/jwt.js – Token generation & verification
"use strict";

const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const JWT_SECRET = process.env.JWT_SECRET || "fallback_dev_secret_do_not_use_in_prod";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "fallback_refresh_secret_do_not_use";
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "30d";

/**
 * Generate an access token for a given user payload
 */
function generateAccessToken(payload) {
  return jwt.sign(
    { sub: payload.id, email: payload.email, role: payload.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Generate a refresh token (opaque random string)
 */
function generateRefreshToken() {
  return crypto.randomBytes(64).toString("hex");
}

/**
 * Hash a refresh token for storage
 */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Verify an access token – returns decoded payload or throws
 */
function verifyAccessToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Decode without verifying (for reading expired tokens in refresh flow)
 */
function decodeToken(token) {
  return jwt.decode(token);
}

/**
 * Calculate refresh token expiry timestamp
 */
function refreshTokenExpiry() {
  const days = parseInt(JWT_REFRESH_EXPIRES_IN) || 30;

  return new Date(
    Date.now() + days * 24 * 60 * 60 * 1000
  ).toISOString();
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  verifyAccessToken,
  decodeToken,
  refreshTokenExpiry,
};
