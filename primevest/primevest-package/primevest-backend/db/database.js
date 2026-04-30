// db/database.js – Postgres connection (Neon/Supabase)
"use strict";

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Optional helper (keeps your code style similar to SQLite)
const db = {
  query: (text, params) => pool.query(text, params),

  // optional helpers to mimic sqlite style a bit
  get: async (text, params) => {
    const res = await pool.query(text, params);
    return res.rows[0];
  },

  all: async (text, params) => {
    const res = await pool.query(text, params);
    return res.rows;
  },
};

module.exports = db;