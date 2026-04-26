// scripts/seed.js – Seed demo data
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

// Load DB after env is set
const db = require("../db/database");

async function seed() {
  console.log("🌱 Seeding PrimeVest Capital database...\n");

  // Check if already seeded
  const existing = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'user'").get();
  if (existing.count > 0) {
    console.log(`⚠️  Database already has ${existing.count} user(s). Skipping seed.`);
    console.log("   To re-seed, delete the database file and run again.\n");
    process.exit(0);
  }

  const [passwordHash, pinHash] = await Promise.all([
    bcrypt.hash("Demo@1234", 12),
    bcrypt.hash("1234", 10),
  ]);

  const userId = "demo001";
  const now = Date.now();
  const joinDate = now - 86400000 * 45; // 45 days ago

  const doSeed = db.transaction(() => {
    // Insert demo user
    db.prepare(`
      INSERT INTO users (id, name, email, password_hash, pin_hash, role, plan, balance, profit, join_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'user', 'Growth', 25000, 3240.50, ?, ?, ?)
    `).run(userId, "Alex Johnson", "alex@example.com", passwordHash, pinHash, joinDate, joinDate, now);

    // Seed transactions
    const txs = [
      { id: uuidv4(), type: "deposit", amount: 25000, note: "Initial deposit", date: joinDate },
      { id: uuidv4(), type: "profit", amount: 3240.50, note: "Monthly profit credit", date: now - 86400000 * 5 },
    ];

    const insertTx = db.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, status, note, created_at)
      VALUES (?, ?, ?, ?, 'confirmed', ?, ?)
    `);

    for (const tx of txs) {
      insertTx.run(tx.id, userId, tx.type, tx.amount, tx.note, tx.date);
    }

    // Seed profit history (12 months, growing trend)
    const currentYear = new Date().getFullYear();
    const insertHistory = db.prepare(`
      INSERT OR REPLACE INTO profit_history (user_id, month, year, value) VALUES (?, ?, ?, ?)
    `);

    for (let m = 1; m <= 12; m++) {
      const value = Math.round(1200 + (m - 1) * 170 + Math.random() * 200);
      insertHistory.run(userId, m, currentYear, value);
    }
  });

  doSeed();

  console.log("✅ Seed complete!\n");
  console.log("Demo User:");
  console.log("  Email    : alex@example.com");
  console.log("  Password : Demo@1234");
  console.log("  PIN      : 1234");
  console.log("\nAdmin:");
  console.log(`  Email    : ${process.env.ADMIN_EMAIL || "admin@primevest.com"}`);
  console.log(`  Password : ${process.env.ADMIN_PASSWORD || "Admin@2024"}`);
  console.log("\n");

  process.exit(0);
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
