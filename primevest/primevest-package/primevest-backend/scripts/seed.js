"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const db = require("../db/database");

async function seed() {
  console.log("🌱 Seeding PrimeVest database (Postgres)...\n");

  // Check if user already exists
  const existing = await db.query(
    "SELECT COUNT(*) FROM users WHERE role = $1",
    ["user"]
  );

  if (parseInt(existing.rows[0].count) > 0) {
    console.log(`⚠️ Database already has users. Skipping seed.`);
    process.exit(0);
  }

  const [passwordHash, pinHash] = await Promise.all([
    bcrypt.hash("Demo@1234", 12),
    bcrypt.hash("1234", 10),
  ]);

  const userId = "demo001";
  const now = Date.now();
  const joinDate = now - 86400000 * 45;

  // ─────────────────────────────
  // Insert demo user
  // ─────────────────────────────
  await db.query(
    `
    INSERT INTO users (
      id, name, email, password_hash, pin_hash,
      role, plan, balance, profit, join_date,
      created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `,
    [
      userId,
      "Alex Johnson",
      "alex@example.com",
      passwordHash,
      pinHash,
      "user",
      "Growth",
      25000,
      3240.5,
      joinDate,
      joinDate,
      now,
    ]
  );

  // ─────────────────────────────
  // Transactions
  // ─────────────────────────────
  const txs = [
    {
      id: uuidv4(),
      type: "deposit",
      amount: 25000,
      note: "Initial deposit",
      date: joinDate,
    },
    {
      id: uuidv4(),
      type: "profit",
      amount: 3240.5,
      note: "Monthly profit credit",
      date: now - 86400000 * 5,
    },
  ];

  for (const tx of txs) {
    await db.query(
      `
      INSERT INTO transactions (
        id, user_id, type, amount, status, note, created_at
      )
      VALUES ($1,$2,$3,$4,'confirmed',$5,$6)
      `,
      [tx.id, userId, tx.type, tx.amount, tx.note, tx.date]
    );
  }

  // ─────────────────────────────
  // Profit history
  // ─────────────────────────────
  const currentYear = new Date().getFullYear();

  for (let m = 1; m <= 12; m++) {
    const value = Math.round(1200 + (m - 1) * 170 + Math.random() * 200);

    await db.query(
      `
      INSERT INTO profit_history (user_id, month, year, value)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (user_id, month, year)
      DO UPDATE SET value = EXCLUDED.value
      `,
      [userId, m, currentYear, value]
    );
  }

  console.log("✅ Seed complete!\n");

  console.log("Demo User:");
  console.log("  Email    : alex@example.com");
  console.log("  Password : Demo@1234");
  console.log("  PIN      : 1234\n");

  console.log("Admin:");
  console.log(
    `  Email    : ${process.env.ADMIN_EMAIL || "admin@primevest.com"}`
  );
  console.log(
    `  Password : ${process.env.ADMIN_PASSWORD || "Admin@2024"}\n`
  );

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});