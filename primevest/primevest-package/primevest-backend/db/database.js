// db/database.js – SQLite database initialisation & helpers
"use strict";

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH = process.env.DB_PATH || "./data/primevest.db";

// Ensure data directory exists
const dataDir = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.resolve(DB_PATH));

// Performance pragmas
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");
db.pragma("cache_size = -32000"); // 32MB cache

// ─── Schema ─────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    pin_hash      TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
    plan          TEXT NOT NULL DEFAULT 'Starter',
    balance       REAL NOT NULL DEFAULT 0,
    profit        REAL NOT NULL DEFAULT 0,
    is_active     INTEGER NOT NULL DEFAULT 1,
    join_date     INTEGER NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL CHECK(type IN ('deposit','withdrawal','profit','adjustment')),
    amount     REAL NOT NULL,
    status     TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('pending','confirmed','rejected')),
    note       TEXT DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    CONSTRAINT positive_amount CHECK(amount > 0)
  );

  CREATE TABLE IF NOT EXISTS profit_history (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month   INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
    year    INTEGER NOT NULL,
    value   REAL NOT NULL DEFAULT 0,
    UNIQUE(user_id, month, year)
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
    subject    TEXT NOT NULL,
    body       TEXT NOT NULL,
    sent_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    status     TEXT NOT NULL DEFAULT 'sent'
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_transactions_user_id   ON transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_created   ON transactions(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_profit_history_user    ON profit_history(user_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user    ON refresh_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user     ON notifications(user_id);
`);

module.exports = db;
