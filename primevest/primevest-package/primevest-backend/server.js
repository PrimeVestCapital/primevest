// server.js – PrimeVest Capital API Server
"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

// ─── Routes ────────────────────────────────────────────────────────
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const adminRoutes = require("./routes/admin");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();
const PORT = process.env.PORT || 5000;
const isDev = process.env.NODE_ENV !== "production";

// ─── Security Middleware ────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: isDev ? false : undefined,
  })
);

// ─── CORS ───────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://localhost:4173",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS policy: origin ${origin} not allowed`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ─── Body Parsers ───────────────────────────────────────────────────
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// ─── Logging ────────────────────────────────────────────────────────
app.use(morgan(isDev ? "dev" : "combined"));

// ─── Global Rate Limiter ────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please slow down.",
  },
});
app.use("/api", limiter);

// ─── Health Check ───────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "PrimeVest Capital API",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    database: process.env.DATABASE_URL ? "postgres (neon/supabase)" : "not configured",
  });
});

// ─── API Routes ─────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);

// ─── API Info ───────────────────────────────────────────────────────
app.get("/api", (req, res) => {
  res.json({
    name: "PrimeVest Capital API",
    version: "1.0.0",
    database: "PostgreSQL (Neon/Supabase)",
    endpoints: {
      auth: "/api/auth",
      users: "/api/users",
      admin: "/api/admin",
      health: "/health",
    },
  });
});

// ─── 404 Handler ─────────────────────────────────────────────────────
app.use(notFound);

// ─── Global Error Handler ───────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ───────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║       PrimeVest Capital – API Server           ║
╠════════════════════════════════════════════════╣
║  Status   : Running                            ║
║  Port     : ${String(PORT).padEnd(34)}║
║  Mode     : ${(process.env.NODE_ENV || "development").padEnd(34)}║
║  Database : PostgreSQL (Neon / Supabase)       ║
╚════════════════════════════════════════════════╝

Admin login: ${process.env.ADMIN_EMAIL || "admin@primevest.com"}
  `);
});

// ─── Graceful Shutdown ──────────────────────────────────────────────
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Closing server...");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("\nSIGINT received. Closing server...");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});

module.exports = app;