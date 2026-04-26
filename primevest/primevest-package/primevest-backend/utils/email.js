// utils/email.js – Nodemailer email service with HTML templates
"use strict";

const nodemailer = require("nodemailer");

// ─── Transporter ─────────────────────────────────────────────────
let transporter;

function getTransporter() {
  if (transporter) return transporter;

  if (process.env.NODE_ENV === "production") {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT) || 587,
      secure: process.env.EMAIL_SECURE === "true",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  } else {
    // In development/test, log emails to console instead of sending
    transporter = {
      sendMail: async (opts) => {
        console.log("\n📧 ─── EMAIL (dev mode – not sent) ─────────────────");
        console.log(`   TO:      ${opts.to}`);
        console.log(`   SUBJECT: ${opts.subject}`);
        console.log(`   BODY:    ${opts.text || "[HTML email]"}`);
        console.log("────────────────────────────────────────────────────\n");
        return { messageId: `dev-${Date.now()}` };
      },
    };
  }

  return transporter;
}

// ─── Base HTML Wrapper ────────────────────────────────────────────
function baseTemplate(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background: #f0f2f5; font-family: 'Helvetica Neue', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #0d1e33, #1a2e4a); padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; font-size: 26px; color: #fff; font-weight: 800; letter-spacing: -0.5px; }
    .header h1 span { color: #d4a853; }
    .header p { margin: 6px 0 0; color: rgba(255,255,255,0.5); font-size: 12px; letter-spacing: 3px; text-transform: uppercase; }
    .body { padding: 36px 40px; }
    .body p { margin: 0 0 16px; color: #444; font-size: 15px; line-height: 1.6; }
    .amount-box { background: linear-gradient(135deg, #1a2e4a, #2a4a70); border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0; }
    .amount-box .label { font-size: 12px; color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .amount-box .value { font-size: 36px; font-weight: 800; color: #fff; }
    .info-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
    .info-row .key { font-size: 13px; color: #999; }
    .info-row .val { font-size: 13px; font-weight: 700; color: #1a2e4a; }
    .badge { display: inline-block; background: #e8f5e9; color: #27ae60; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; }
    .cta { background: linear-gradient(135deg, #b8933f, #d4a853); color: #fff; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 15px; display: inline-block; margin: 8px 0; }
    .footer { background: #f8f9fa; padding: 24px 40px; text-align: center; border-top: 1px solid #eee; }
    .footer p { margin: 0; font-size: 12px; color: #bbb; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Prime<span>Vest</span></h1>
      <p>Capital Investment Platform</p>
    </div>
    <div class="body">${bodyHtml}</div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} PrimeVest Capital. All rights reserved.<br/>
      This email was sent to you because you have an account with PrimeVest Capital.<br/>
      If you did not request this, please contact support immediately.</p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Email Templates ──────────────────────────────────────────────

function welcomeEmail(user) {
  const html = baseTemplate("Welcome to PrimeVest Capital", `
    <p>Dear <strong>${user.name}</strong>,</p>
    <p>Welcome to <strong>PrimeVest Capital</strong>! Your investment account has been successfully created.</p>
    <div class="info-row"><span class="key">Account Email</span><span class="val">${user.email}</span></div>
    <div class="info-row"><span class="key">Investment Plan</span><span class="val">${user.plan}</span></div>
    <div class="info-row"><span class="key">Account Status</span><span class="val"><span class="badge">✓ Active</span></span></div>
    <p style="margin-top:24px;">You can now log in to your dashboard to view your portfolio, track profits, and manage your investments.</p>
    <p style="color:#888;font-size:13px;">If you have any questions, our support team is here to help.</p>
  `);
  return { subject: "Welcome to PrimeVest Capital – Account Activated", html, text: `Welcome to PrimeVest Capital, ${user.name}! Your account is now active.` };
}

function depositEmail(user, amount, txId) {
  const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const html = baseTemplate("Deposit Confirmed", `
    <p>Dear <strong>${user.name}</strong>,</p>
    <p>Your deposit has been successfully processed and credited to your account.</p>
    <div class="amount-box"><div class="label">Amount Deposited</div><div class="value">$${fmt(amount)}</div></div>
    <div class="info-row"><span class="key">Transaction ID</span><span class="val">${txId}</span></div>
    <div class="info-row"><span class="key">New Balance</span><span class="val">$${fmt(user.balance)}</span></div>
    <div class="info-row"><span class="key">Status</span><span class="val"><span class="badge">✓ Confirmed</span></span></div>
    <p style="margin-top:20px;color:#888;font-size:13px;">Your funds are now invested and will begin generating returns according to your <strong>${user.plan}</strong> plan.</p>
  `);
  return { subject: "Deposit Confirmed – PrimeVest Capital", html, text: `Your deposit of $${fmt(amount)} has been confirmed.` };
}

function withdrawalEmail(user, amount, txId) {
  const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const html = baseTemplate("Withdrawal Processed", `
    <p>Dear <strong>${user.name}</strong>,</p>
    <p>Your withdrawal request has been approved and is being processed.</p>
    <div class="amount-box"><div class="label">Amount Withdrawn</div><div class="value">$${fmt(amount)}</div></div>
    <div class="info-row"><span class="key">Transaction ID</span><span class="val">${txId}</span></div>
    <div class="info-row"><span class="key">Status</span><span class="val"><span class="badge">✓ Processing</span></span></div>
    <div class="info-row"><span class="key">Expected Arrival</span><span class="val">1–3 Business Days</span></div>
    <p style="margin-top:20px;color:#888;font-size:13px;">Funds will be transferred to your registered bank account within 1–3 business days.</p>
  `);
  return { subject: "Withdrawal Confirmed – PrimeVest Capital", html, text: `Your withdrawal of $${fmt(amount)} has been processed.` };
}

function portfolioUpdateEmail(user, changes) {
  const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const html = baseTemplate("Portfolio Updated", `
    <p>Dear <strong>${user.name}</strong>,</p>
    <p>Your investment portfolio has been updated by our portfolio management team.</p>
    <div class="info-row"><span class="key">New Balance</span><span class="val">$${fmt(changes.balance)}</span></div>
    <div class="info-row"><span class="key">Total Profit</span><span class="val" style="color:#27ae60">$${fmt(changes.profit)}</span></div>
    <div class="info-row"><span class="key">Investment Plan</span><span class="val">${changes.plan}</span></div>
    <p style="margin-top:20px;color:#888;font-size:13px;">Log in to your dashboard to view your updated portfolio details.</p>
  `);
  return { subject: "Portfolio Updated – PrimeVest Capital", html, text: `Your portfolio has been updated. Balance: $${fmt(changes.balance)}, Profit: $${fmt(changes.profit)}.` };
}

function customEmail(user, subject, body) {
  const html = baseTemplate(subject, `
    <p>Dear <strong>${user.name}</strong>,</p>
    ${body.split("\n").map(line => `<p>${line}</p>`).join("")}
  `);
  return { subject, html, text: body };
}

// ─── Send Helper ─────────────────────────────────────────────────
async function sendEmail(to, { subject, html, text }) {
  try {
    const transport = getTransporter();
    const result = await transport.sendMail({
      from: process.env.EMAIL_FROM || "PrimeVest Capital <noreply@primevest.com>",
      to,
      subject,
      html,
      text,
    });
    console.log(`📧 Email sent to ${to}: ${subject} (id: ${result.messageId})`);
    return { success: true, messageId: result.messageId };
  } catch (err) {
    console.error(`❌ Email failed to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendEmail,
  templates: { welcomeEmail, depositEmail, withdrawalEmail, portfolioUpdateEmail, customEmail },
};
