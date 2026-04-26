// middleware/errorHandler.js – Centralised error handling
"use strict";

/**
 * Not Found handler – catches unmatched routes
 */
function notFound(req, res, next) {
  const err = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  err.statusCode = 404;
  next(err);
}

/**
 * Global error handler
 */
function errorHandler(err, req, res, next) {
  const isDev = process.env.NODE_ENV !== "production";
  const statusCode = err.statusCode || err.status || 500;

  // Log errors (don't log 4xx in production to reduce noise)
  if (statusCode >= 500 || isDev) {
    console.error(`[ERROR] ${req.method} ${req.originalUrl} → ${statusCode}:`, err.message);
    if (isDev) console.error(err.stack);
  }

  const response = {
    success: false,
    message: err.message || "An unexpected error occurred.",
  };

  if (isDev) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

/**
 * Validation error formatter (express-validator)
 */
function formatValidationErrors(errors) {
  return errors.array().map(e => ({ field: e.path, message: e.msg }));
}

module.exports = { notFound, errorHandler, formatValidationErrors };
