/**
 * Noble Handybusiness — standalone server entry point.
 *
 * Boots an Express app, opens a SQLite database, wires a stub mailer,
 * and mounts the Handybusiness router at /handy/*.
 *
 * All configuration is env-driven. See .env.example.
 */

const path = require("path");
const fs = require("fs");
const express = require("express");
const Database = require("better-sqlite3");

// ── config ─────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3000", 10);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "handy.db");
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET === "change-me-in-production") {
  console.error("[fatal] SESSION_SECRET env var is required (and must not be the default). Copy .env.example → .env and set a strong value.");
  process.exit(1);
}

// ── db ─────────────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── mailer stub (swap for nodemailer/postmark/resend in production) ────
const mailer = {
  sendMail: async (opts) => {
    if (process.env.NODE_ENV !== "test") {
      console.log(`[mailer stub] to=${opts.to} subject=${opts.subject || ""}`);
    }
    return { messageId: "stub-" + Date.now() };
  },
};

// ── outer app ──────────────────────────────────────────────────────────
const app = express();
app.disable("x-powered-by");

// requireAuth is only used by outer host-app routes. In standalone we
// have no host app, so a permissive no-op is safe.
const requireAuth = (_req, _res, next) => next();

// Root → handy landing
app.get("/", (_req, res) => res.redirect("/handy/"));
app.get("/handy", (_req, res) => res.redirect("/handy/"));

// Mount the handy router — this attaches ~80 routes + 20 tables + cron jobs.
require("./handy-router.js")(app, db, mailer, requireAuth);

// 404
app.use((req, res) => {
  res.status(404).type("text/plain").send("Not found: " + req.method + " " + req.url);
});

app.listen(PORT, () => {
  console.log(`Noble Handybusiness ready → http://localhost:${PORT}/handy/`);
  console.log(`DB: ${DB_PATH}`);
});
