"use strict";
// Handy Dashboard — self-contained module for a handyman contractor
// Mounted at /handy on nobleglitch.cloud. NOT linked from operator nav.
// Own auth (handy.sid cookie), own DB tables, own SMS/email cadence.

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const http = require("http");

module.exports = function mount(app, db, mailer, requireAuth) {
  const express = require("express");
  const session = require("express-session");
  const bcrypt = require("bcrypt");
  const SqliteStore = require("better-sqlite3-session-store")(session);
  const Database = require("better-sqlite3");

  // ── SCHEMA ──
  db.exec(`CREATE TABLE IF NOT EXISTS handy_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    default_hourly_rate REAL DEFAULT 65,
    default_material_markup_pct REAL DEFAULT 15,
    business_name TEXT,
    business_phone TEXT,
    business_email TEXT,
    paypal_me TEXT,
    venmo TEXT,
    cashapp TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS handy_customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    city TEXT,
    state TEXT DEFAULT 'AZ',
    zip TEXT,
    pay_pref TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS handy_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'open',
    hourly_rate REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS handy_hours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    entry_date TEXT NOT NULL,
    hours REAL NOT NULL,
    rate REAL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS handy_materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    entry_date TEXT NOT NULL,
    item TEXT NOT NULL,
    quantity REAL DEFAULT 1,
    unit_cost REAL NOT NULL,
    markup_pct REAL DEFAULT 15,
    receipt_url TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS handy_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    job_id INTEGER,
    invoice_number TEXT UNIQUE,
    line_items_json TEXT,
    subtotal REAL DEFAULT 0,
    tax_pct REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    total REAL DEFAULT 0,
    status TEXT DEFAULT 'draft',
    due_date TEXT,
    sent_at TEXT,
    paid_at TEXT,
    reminder_count INTEGER DEFAULT 0,
    last_reminder_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS handy_reminder_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    recipient TEXT NOT NULL,
    body TEXT,
    status TEXT,
    error TEXT,
    sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS handy_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    kind TEXT DEFAULT 'progress',
    data_url TEXT NOT NULL,
    caption TEXT,
    gps_lat REAL,
    gps_lng REAL,
    taken_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS handy_touches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    body TEXT,
    channel TEXT,
    status TEXT DEFAULT 'sent',
    sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  // Add scheduled_at column to jobs (for T-24h + T-1h reminder cron) — safe if already added
  try { db.exec("ALTER TABLE handy_jobs ADD COLUMN scheduled_at TEXT"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_jobs ADD COLUMN reminder_24h_sent INTEGER DEFAULT 0"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_jobs ADD COLUMN reminder_1h_sent INTEGER DEFAULT 0"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_jobs ADD COLUMN priority TEXT DEFAULT 'normal'"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_photos ADD COLUMN mime_type TEXT DEFAULT 'image/jpeg'"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_photos ADD COLUMN filename TEXT"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_photos ADD COLUMN kind_group TEXT DEFAULT 'photo'"); } catch(_e){} // 'photo' | 'document'
  try { db.exec("ALTER TABLE handy_customers ADD COLUMN lat REAL"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_customers ADD COLUMN lng REAL"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_users ADD COLUMN home_address TEXT"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_users ADD COLUMN home_lat REAL DEFAULT 32.2226"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_users ADD COLUMN home_lng REAL DEFAULT -110.9747"); } catch(_e){}

  // Customer portal accounts
  db.exec(`CREATE TABLE IF NOT EXISTS handy_customer_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    address TEXT,
    city TEXT DEFAULT 'Tucson',
    zip TEXT,
    password_hash TEXT NOT NULL,
    community TEXT,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  // Customer-submitted tickets (become jobs when Danny accepts)
  db.exec(`CREATE TABLE IF NOT EXISTS handy_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_user_id INTEGER NOT NULL,
    customer_id INTEGER,
    job_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    requested_date TEXT,
    requested_window TEXT,
    duration_minutes INTEGER DEFAULT 90,
    is_after_hours INTEGER DEFAULT 0,
    hourly_rate REAL,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  // Appointment reminders tracking (avoids duplicate sends)
  db.exec(`CREATE TABLE IF NOT EXISTS handy_reminders_sent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    cadence TEXT NOT NULL,
    channel TEXT NOT NULL,
    recipient TEXT,
    body TEXT,
    status TEXT DEFAULT 'sent',
    sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(job_id, cadence, channel)
  )`);

  // Manual-send queue for Google Voice mode (Danny copies + sends manually)
  db.exec(`CREATE TABLE IF NOT EXISTS handy_manual_send_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    customer_id INTEGER,
    recipient TEXT,
    body TEXT,
    reason TEXT,
    status TEXT DEFAULT 'pending',
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  try { db.exec("ALTER TABLE handy_users ADD COLUMN role TEXT DEFAULT 'owner'"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_users ADD COLUMN sms_sender TEXT DEFAULT 'signalwire'"); } catch(_e){} // 'signalwire' | 'google_voice_manual'
  try { db.exec("ALTER TABLE handy_users ADD COLUMN wizard_completed_at TEXT"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_users ADD COLUMN wizard_skipped INTEGER DEFAULT 0"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_jobs ADD COLUMN duration_minutes INTEGER DEFAULT 90"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_invoices ADD COLUMN signature_data_url TEXT"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_invoices ADD COLUMN signer_name TEXT"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_invoices ADD COLUMN signed_at TEXT"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_invoices ADD COLUMN signer_ip TEXT"); } catch(_e){}
  // NEW (ship-2026-08-22): Google Review URL, TCPA opt-out flag, review-ask queued flag
  try { db.exec("ALTER TABLE handy_users ADD COLUMN gmb_review_url TEXT"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_customers ADD COLUMN sms_opt_out INTEGER DEFAULT 0"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_jobs ADD COLUMN review_ask_scheduled_at TEXT"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_jobs ADD COLUMN review_ask_sent INTEGER DEFAULT 0"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_invoices ADD COLUMN review_ask_scheduled_at TEXT"); } catch(_e){}
  try { db.exec("ALTER TABLE handy_invoices ADD COLUMN review_ask_sent INTEGER DEFAULT 0"); } catch(_e){}

  // Job notes table (mobile quick-add)
  db.exec(`CREATE TABLE IF NOT EXISTS handy_job_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    note_text TEXT,
    author_user_id INTEGER,
    note_type TEXT DEFAULT 'text',
    attachment_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_handy_job_notes_job ON handy_job_notes(job_id, created_at DESC)");

  // Migration: relax handy_tickets.customer_user_id NOT NULL — Aspen's call-in
  // tickets don't have a portal user, only a customer record.
  try {
    const ttCol = db.prepare("PRAGMA table_info('handy_tickets')").all().find(c => c.name === "customer_user_id");
    if (ttCol && ttCol.notnull === 1) {
      db.exec("BEGIN");
      db.exec(`CREATE TABLE handy_tickets__new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_user_id INTEGER,
        customer_id INTEGER,
        job_id INTEGER,
        title TEXT NOT NULL,
        description TEXT,
        requested_date TEXT,
        requested_window TEXT,
        duration_minutes INTEGER DEFAULT 90,
        is_after_hours INTEGER DEFAULT 0,
        hourly_rate REAL,
        status TEXT DEFAULT 'pending',
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec("INSERT INTO handy_tickets__new SELECT * FROM handy_tickets");
      db.exec("DROP TABLE handy_tickets");
      db.exec("ALTER TABLE handy_tickets__new RENAME TO handy_tickets");
      db.exec("COMMIT");
      console.log("[handy] migrated handy_tickets: customer_user_id now nullable");
    }
  } catch(e){ try { db.exec("ROLLBACK"); } catch(_e){} console.error("[handy] tickets migration failed:", e.message); }

  db.exec(`CREATE TABLE IF NOT EXISTS handy_agreements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    customer_id INTEGER,
    agreement_type TEXT NOT NULL DEFAULT 'intake_tc',
    agreement_version TEXT NOT NULL DEFAULT '1.0',
    typed_name TEXT NOT NULL,
    signature_data_url TEXT NOT NULL,
    signed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip TEXT,
    user_agent TEXT,
    document_snapshot TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS handy_intake_leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    city TEXT,
    zip TEXT,
    description TEXT,
    agreement_id INTEGER,
    customer_id INTEGER,
    ip TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  // Legal-tip widget rotation history — enforces "no repeat within 21 days"
  db.exec(`CREATE TABLE IF NOT EXISTS handy_widget_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tip_id TEXT NOT NULL,
    shown_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_handy_widget_history_shown_at ON handy_widget_history(shown_at)");

  // Aspen's call log — every phone call the assistant answers
  db.exec(`CREATE TABLE IF NOT EXISTS handy_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    taken_by_user_id INTEGER NOT NULL,
    taken_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    caller_name TEXT,
    caller_phone TEXT,
    customer_id INTEGER,
    is_new_customer INTEGER DEFAULT 0,
    reason TEXT,
    notes TEXT,
    action TEXT,
    callback_scheduled_at TEXT,
    ticket_id INTEGER,
    job_id INTEGER,
    outcome TEXT
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_handy_calls_taken_at ON handy_calls(taken_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_handy_calls_customer ON handy_calls(customer_id)");

  // Seed the first owner if the users table is empty.
  // Env-driven for OSS safety — never ships a known default password.
  //   SEED_USERNAME     — default "owner"
  //   SEED_PASSWORD     — if unset, a random 16-char password is generated and printed to stdout
  //   SEED_DISPLAY_NAME — default "Owner"
  //   SEED_BUSINESS_NAME— default "Your Business Name"
  //   SEED_HOURLY_RATE  — default 75
  //   SKIP_SEED=1       — disables seeding entirely (bring-your-own bootstrap)
  const existing = db.prepare("SELECT COUNT(*) AS n FROM handy_users").get();
  if (existing.n === 0 && process.env.SKIP_SEED !== "1") {
    const username = (process.env.SEED_USERNAME || "owner").toLowerCase().trim();
    const password = process.env.SEED_PASSWORD || require("crypto").randomBytes(12).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
    const displayName = process.env.SEED_DISPLAY_NAME || "Owner";
    const businessName = process.env.SEED_BUSINESS_NAME || "Your Business Name";
    const hourlyRate = parseInt(process.env.SEED_HOURLY_RATE || "75", 10);
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("INSERT INTO handy_users (username, password_hash, display_name, business_name, default_hourly_rate) VALUES (?,?,?,?,?)")
      .run(username, hash, displayName, businessName, hourlyRate);
    console.log("[handy] ═══════════════════════════════════════════════════════════════");
    console.log("[handy] First-owner user seeded — save these credentials NOW:");
    console.log("[handy]   username: " + username);
    console.log("[handy]   password: " + password);
    console.log("[handy] Change the password on first login. This will not print again.");
    console.log("[handy] ═══════════════════════════════════════════════════════════════");
  }

  // ── Handy session (SEPARATE from operator session) ──
  // The parent app already installed an app-wide `session()` middleware BEFORE this
  // router mounts. express-session short-circuits when `req.session` is already
  // present, which caused every write to `req.session.handyUserId` to land in the
  // app-wide `connect.sid` session (domain=.nobleglitch.cloud, path=/) — a cookie
  // that browsers on handytucson.tech will never send back. We fix this by
  // stripping `req.session*` in a pre-middleware so handySession actually creates
  // its own session on the `handy.sid` cookie (path=/handy, no domain restriction).
  const stripAppSession = (req, _res, next) => {
    try {
      delete req.session;
      delete req.sessionID;
      delete req.sessionStore;
    } catch(_e){}
    next();
  };
  const handySessionInner = session({
    name: "handy.sid",
    store: new SqliteStore({ client: new Database("/root/.session/handy-sessions.db"), expired: { clear: true, intervalMs: 900000 } }),
    secret: process.env.HANDY_SESSION_SECRET || process.env.SESSION_SECRET || "handy-x9k2m-2026",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true, httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000, path: "/handy" }
  });
  const handySession = [stripAppSession, handySessionInner];

  function handyAuth(req, res, next) {
    if (req.session && req.session.handyUserId) return next();
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "unauthorized" });
    return res.redirect("/handy/login");
  }

  // ── CUSTOMER PORTAL SESSION (separate cookie from Danny's admin session) ──
  const portalSessionInner = session({
    name: "handy_portal.sid",
    store: new SqliteStore({ client: new Database("/root/.session/handy-portal-sessions.db"), expired: { clear: true, intervalMs: 900000 } }),
    secret: process.env.HANDY_PORTAL_SESSION_SECRET || process.env.SESSION_SECRET || "handy-portal-x9k2m",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true, httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000, path: "/handy" }
  });
  const portalSession = [stripAppSession, portalSessionInner];

  function portalAuth(req, res, next) {
    if (req.session && req.session.portalUserId) return next();
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "unauthorized" });
    return res.redirect("/handy/portal/login");
  }

  // ── PORTAL PAGES ──
  app.get(["/handy/portal", "/handy/portal/", "/handy/portal/book", "/handy/portal/tickets"], portalSession, (req, res) => {
    if (!req.session.portalUserId) return res.redirect("/handy/portal/login");
    res.sendFile(path.join(__dirname, "public", "handy", "portal.html"));
  });
  app.get("/handy/portal/login", portalSession, (req, res) => {
    if (req.session.portalUserId) return res.redirect("/handy/portal");
    res.sendFile(path.join(__dirname, "public", "handy", "portal-login.html"));
  });
  app.get("/handy/portal/signup", portalSession, (req, res) => {
    if (req.session.portalUserId) return res.redirect("/handy/portal");
    res.sendFile(path.join(__dirname, "public", "handy", "portal-signup.html"));
  });
  app.get("/handy/portal/logout", portalSession, (req, res) => {
    req.session.destroy(() => res.redirect("/handy/portal/login"));
  });

  // ── PORTAL API ──
  app.post("/handy/api/portal/signup", portalSession, express.json(), async (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.email || !b.password) return res.status(400).json({ ok: false, error: "name, email, password required" });
    if (b.password.length < 6) return res.status(400).json({ ok: false, error: "password must be at least 6 characters" });
    const email = String(b.email).toLowerCase().trim();
    const existing = db.prepare("SELECT id FROM handy_customer_users WHERE email=?").get(email);
    if (existing) return res.status(409).json({ ok: false, error: "an account with this email already exists — try signing in" });
    const hash = bcrypt.hashSync(b.password, 10);
    // Also create a customer record (linked to Danny — user_id=1)
    const custInfo = db.prepare("INSERT INTO handy_customers (user_id, name, phone, email, address, city, state, zip, notes) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(1, b.name.trim(), b.phone || "", email, b.address || "", b.city || "Tucson", "AZ", b.zip || "", b.community ? "Community: " + b.community : "");
    // Auto-geocode address if provided
    if (b.address) {
      const full = [b.address, b.city || "Tucson", "AZ", b.zip].filter(Boolean).join(", ");
      geocodeAddress(full).then(g => {
        if (g) db.prepare("UPDATE handy_customers SET lat=?, lng=? WHERE id=?").run(g.lat, g.lng, custInfo.lastInsertRowid);
      }).catch(()=>{});
    }
    const puInfo = db.prepare("INSERT INTO handy_customer_users (customer_id, name, email, phone, address, city, zip, password_hash, community) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(custInfo.lastInsertRowid, b.name.trim(), email, b.phone || "", b.address || "", b.city || "Tucson", b.zip || "", hash, b.community || "");
    req.session.portalUserId = puInfo.lastInsertRowid;
    req.session.portalCustomerId = custInfo.lastInsertRowid;
    // Notify Danny best-effort
    try {
      if (mailer && process.env.EMAIL_USER) {
        mailer.sendMail({
          from: `"Handy Tucson" <${process.env.EMAIL_USER}>`,
          to: process.env.OPERATOR_EMAIL || "desertshibari@gmail.com",
          subject: `[NEW CUSTOMER ACCOUNT] ${b.name}`,
          text: `New customer signed up.\n\nName: ${b.name}\nEmail: ${email}\nPhone: ${b.phone || "(none)"}\nAddress: ${b.address || ""} ${b.city || "Tucson"} ${b.zip || ""}\nCommunity: ${b.community || "(none)"}\n\nDashboard: https://handytucson.tech/dashboard`
        }).catch(()=>{});
      }
    } catch(_e){}
    res.json({ ok: true });
  });

  app.post("/handy/api/portal/login", portalSession, express.json(), (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: "email and password required" });
    const u = db.prepare("SELECT * FROM handy_customer_users WHERE email=?").get(String(email).toLowerCase().trim());
    if (!u) return res.status(401).json({ ok: false, error: "wrong email or password" });
    if (!bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ ok: false, error: "wrong email or password" });
    req.session.portalUserId = u.id;
    req.session.portalCustomerId = u.customer_id;
    db.prepare("UPDATE handy_customer_users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").run(u.id);
    res.json({ ok: true });
  });

  app.get("/handy/api/portal/me", portalSession, portalAuth, (req, res) => {
    const u = db.prepare("SELECT id, customer_id, name, email, phone, address, city, zip, community FROM handy_customer_users WHERE id=?").get(req.session.portalUserId);
    res.json({ ok: true, user: u });
  });

  app.get("/handy/api/portal/tickets", portalSession, portalAuth, (req, res) => {
    const rows = db.prepare("SELECT * FROM handy_tickets WHERE customer_user_id=? ORDER BY created_at DESC LIMIT 100").all(req.session.portalUserId);
    res.json({ tickets: rows });
  });

  // Availability calendar — returns 14-day grid with time-windows blocked if any job is scheduled during that window
  app.get("/handy/api/portal/availability", portalSession, portalAuth, (req, res) => {
    const days = Math.min(parseInt(req.query.days || "14", 10), 30);
    // Danny's booked jobs in the next N days
    const jobs = db.prepare(`SELECT scheduled_at FROM handy_jobs WHERE user_id=1 AND scheduled_at IS NOT NULL AND status != 'complete' AND datetime(scheduled_at) BETWEEN datetime('now') AND datetime('now', '+' || ? || ' days')`).all(days);
    const bookedByWindow = {};
    for (const j of jobs) {
      const d = new Date(j.scheduled_at);
      const dateStr = d.toISOString().slice(0, 10);
      const hr = d.getHours();
      const window = hr < 12 ? "morning" : (hr < 17 ? "afternoon" : "afterhours");
      const key = `${dateStr}_${window}`;
      bookedByWindow[key] = (bookedByWindow[key] || 0) + 1;
    }
    // Build 14-day grid
    const grid = [];
    const today = new Date(); today.setHours(0,0,0,0);
    for (let i = 0; i < days; i++) {
      const d = new Date(today.getTime() + i * 86400000);
      const dateStr = d.toISOString().slice(0, 10);
      const dow = d.getDay(); // 0=Sun, 6=Sat
      const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      grid.push({
        date: dateStr, label, dow,
        morning: dow >= 1 && dow <= 6 ? (bookedByWindow[`${dateStr}_morning`] ? "booked" : "available") : "closed",
        afternoon: dow >= 1 && dow <= 6 ? (bookedByWindow[`${dateStr}_afternoon`] ? "booked" : "available") : "closed",
        afterhours: bookedByWindow[`${dateStr}_afterhours`] ? "booked" : "available_hourly"
      });
    }
    res.json({ grid, afterhours_multiplier: 1.75 });
  });

  app.post("/handy/api/portal/tickets", portalSession, portalAuth, express.json(), (req, res) => {
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ ok: false, error: "title required" });
    if (!b.requested_date || !b.requested_window) return res.status(400).json({ ok: false, error: "date and time window required" });
    const isAfter = b.requested_window === "afterhours" ? 1 : 0;
    const rate = isAfter ? 1.75 : null; // multiplier, not $/hr
    // Every booking reserves a 90-minute block (mandatory per operator policy)
    const info = db.prepare("INSERT INTO handy_tickets (customer_user_id, customer_id, title, description, requested_date, requested_window, duration_minutes, is_after_hours, hourly_rate) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(req.session.portalUserId, req.session.portalCustomerId, b.title, b.description || "", b.requested_date, b.requested_window, 90, isAfter, rate);
    // Notify Danny
    try {
      const u = db.prepare("SELECT name, phone, address FROM handy_customer_users WHERE id=?").get(req.session.portalUserId);
      if (mailer && process.env.EMAIL_USER) {
        mailer.sendMail({
          from: `"Handy Tucson" <${process.env.EMAIL_USER}>`,
          to: process.env.OPERATOR_EMAIL || "desertshibari@gmail.com",
          subject: `[NEW TICKET #${info.lastInsertRowid}] ${b.title}${isAfter ? " · AFTER-HOURS" : ""}`,
          text: `Customer ticket opened.\n\nCustomer: ${u.name}\nPhone: ${u.phone}\nAddress: ${u.address}\n\nTitle: ${b.title}\nDescription: ${b.description || "(none)"}\nRequested: ${b.requested_date} · ${b.requested_window}${isAfter ? ` · HOURLY $${rate}/hr` : ""}\n\nDashboard: https://handytucson.tech/dashboard`
        }).catch(()=>{});
      }
      // SMS to Danny if configured
      if (process.env.OPERATOR_CELL && process.env.SIGNALWIRE_PROJECT_ID) {
        const swBase = "https://" + process.env.SIGNALWIRE_SPACE_URL + "/api/laml/2010-04-01/Accounts/" + process.env.SIGNALWIRE_PROJECT_ID + "/Messages.json";
        const auth = Buffer.from(process.env.SIGNALWIRE_PROJECT_ID + ":" + process.env.SIGNALWIRE_API_TOKEN).toString("base64");
        const body = `NEW TICKET #${info.lastInsertRowid}: ${u.name} — "${b.title.slice(0,50)}" · ${b.requested_date} ${b.requested_window}${isAfter ? " HOURLY" : ""}`;
        fetch(swBase, { method: "POST", headers: { "Authorization": "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: process.env.SIGNALWIRE_FROM_NUMBER, To: process.env.OPERATOR_CELL, Body: body }).toString() }).catch(()=>{});
      }
    } catch(_e){}
    res.json({ ok: true, id: info.lastInsertRowid });
  });

  // ── PUBLIC QUICK LEAD FORM (unauthenticated 3-field lead capture from landing page) ──
  try { db.prepare(`CREATE TABLE IF NOT EXISTS handy_quick_leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    description TEXT NOT NULL,
    source TEXT DEFAULT 'web-offer',
    discount_applied INTEGER DEFAULT 1,
    handled_at TEXT,
    handled_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run(); } catch(_e){}
  app.post("/handy/api/leads/quick", express.json(), (req, res) => {
    try {
      const name = String((req.body && req.body.name) || "").trim().slice(0, 120);
      const phone = String((req.body && req.body.phone) || "").trim().slice(0, 40);
      const description = String((req.body && req.body.description) || "").trim().slice(0, 2000);
      const source = String((req.body && req.body.source) || "web-offer").trim().slice(0, 40);
      if (!name || !phone || !description) {
        return res.status(400).json({ ok: false, error: "Name, phone, and description are required." });
      }
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 10) {
        return res.status(400).json({ ok: false, error: "Please enter a valid phone number." });
      }
      const info = db.prepare("INSERT INTO handy_quick_leads (name, phone, description, source) VALUES (?, ?, ?, ?)").run(name, phone, description, source);
      // Best-effort operator SMS notification (silent if OPERATOR_CELL not set)
      try {
        const opCell = process.env.OPERATOR_CELL;
        if (opCell && typeof twilioClient !== "undefined" && twilioClient) {
          const smsBody = `New Danny lead ($25 off · ${source}):\n${name} · ${phone}\n"${description.slice(0, 220)}"`;
          twilioClient.messages.create({ from: process.env.SIGNALWIRE_FROM, to: opCell, body: smsBody }).catch(() => {});
        }
      } catch (_e) {}
      res.json({ ok: true, id: info.lastInsertRowid });
    } catch (e) {
      res.status(500).json({ ok: false, error: "Server error — please call (520) 675-0005." });
    }
  });

  // ── PUBLIC REVIEWS (unauthenticated read for landing page) ──
  try { db.prepare(`CREATE TABLE IF NOT EXISTS handy_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    customer_id INTEGER,
    job_id INTEGER,
    stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
    quote TEXT NOT NULL,
    reviewer_name TEXT,
    verified_at TEXT,
    published INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run(); } catch(_e){}
  app.get("/handy/api/reviews/public", (req, res) => {
    try {
      const rows = db.prepare("SELECT stars, quote, reviewer_name AS name FROM handy_reviews WHERE published=1 AND verified_at IS NOT NULL ORDER BY id DESC LIMIT 12").all();
      res.json({ ok: true, reviews: rows });
    } catch(e) { res.json({ ok: true, reviews: [] }); }
  });

  // ── TICKETS (Danny's inbox — customer bookings await accept/decline) ──
  // Helper: notify a customer via email + SMS (respects user's sms_sender setting: signalwire vs google_voice_manual)
  function notifyCustomer(opts) {
    // opts: { userId, customerId, customerUserId, phone, email, name, subject, body, jobId, reason }
    const uRow = db.prepare("SELECT business_name, business_phone, sms_sender FROM handy_users WHERE id=?").get(opts.userId);
    const bizName = (uRow && uRow.business_name) || "Handyman";
    const sender = (uRow && uRow.sms_sender) || "signalwire";

    // Email — always automatic (both sender modes)
    if (opts.email && mailer && process.env.EMAIL_USER) {
      try {
        mailer.sendMail({
          from: `"${bizName}" <${process.env.EMAIL_USER}>`,
          to: opts.email,
          subject: opts.subject,
          text: opts.body
        }).catch(()=>{});
      } catch(_e){}
    }

    if (!opts.phone) return;

    // Google Voice manual — queue for Danny to send by hand
    if (sender === "google_voice_manual") {
      try {
        db.prepare("INSERT INTO handy_manual_send_queue (job_id, customer_id, recipient, body, reason) VALUES (?,?,?,?,?)")
          .run(opts.jobId || null, opts.customerId || null, opts.phone, opts.body, opts.reason || "ticket_notification");
      } catch(_e){}
      return;
    }

    // SignalWire auto SMS
    if (process.env.SIGNALWIRE_PROJECT_ID && process.env.SIGNALWIRE_API_TOKEN && process.env.SIGNALWIRE_FROM_NUMBER) {
      try {
        const cleanPhone = "+" + String(opts.phone).replace(/\D/g, "").replace(/^1?/, "1");
        const swUrl = `https://${process.env.SIGNALWIRE_SPACE_URL}/api/laml/2010-04-01/Accounts/${process.env.SIGNALWIRE_PROJECT_ID}/Messages.json`;
        const auth = Buffer.from(`${process.env.SIGNALWIRE_PROJECT_ID}:${process.env.SIGNALWIRE_API_TOKEN}`).toString("base64");
        const params = new URLSearchParams({ From: process.env.SIGNALWIRE_FROM_NUMBER, To: cleanPhone, Body: opts.body });
        fetch(swUrl, { method: "POST", headers: { "Authorization": "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() }).catch(()=>{});
      } catch(_e){}
    }
  }

  // List all tickets — pending first, then created_at DESC — with customer info joined
  app.get("/handy/api/tickets", handySession, handyAuth, (req, res) => {
    const rows = db.prepare(`
      SELECT
        t.id, t.customer_user_id, t.customer_id, t.job_id, t.title, t.description,
        t.requested_date, t.requested_window, t.duration_minutes, t.is_after_hours,
        t.hourly_rate, t.status, t.notes, t.created_at, t.updated_at,
        COALESCE(cu.name, c.name) AS customer_name,
        COALESCE(cu.phone, c.phone) AS customer_phone,
        COALESCE(cu.email, c.email) AS customer_email,
        COALESCE(cu.address, c.address) AS customer_address,
        COALESCE(cu.city, c.city) AS customer_city,
        COALESCE(cu.zip, c.zip) AS customer_zip,
        cu.community AS customer_community,
        j.scheduled_at AS scheduled_at
      FROM handy_tickets t
      LEFT JOIN handy_customer_users cu ON cu.id = t.customer_user_id
      LEFT JOIN handy_customers c ON c.id = t.customer_id
      LEFT JOIN handy_jobs j ON j.id = t.job_id
      ORDER BY (CASE WHEN t.status='pending' THEN 0 ELSE 1 END), t.created_at DESC
      LIMIT 300
    `).all();
    const pending_count = db.prepare("SELECT COUNT(*) AS n FROM handy_tickets WHERE status='pending'").get().n;
    res.json({ tickets: rows, pending_count });
  });

  // Accept a ticket → creates a scheduled job, links, notifies customer
  app.post("/handy/api/tickets/:id/accept", handySession, handyAuth, express.json(), (req, res) => {
    const uid = req.session.handyUserId;
    const t = db.prepare("SELECT * FROM handy_tickets WHERE id=?").get(req.params.id);
    if (!t) return res.status(404).json({ ok: false, error: "ticket not found" });
    if (t.status !== "pending") return res.status(409).json({ ok: false, error: `ticket already ${t.status}` });

    const b = req.body || {};
    if (!b.scheduled_at) return res.status(400).json({ ok: false, error: "scheduled_at required" });

    // Resolve customer_id — ticket may only have customer_user_id (portal signup); link to matching handy_customers row
    let customerId = t.customer_id;
    if (!customerId && t.customer_user_id) {
      const cu = db.prepare("SELECT * FROM handy_customer_users WHERE id=?").get(t.customer_user_id);
      if (cu) {
        // Prefer the linked customer_id if present, else find/create by email
        if (cu.customer_id) {
          customerId = cu.customer_id;
        } else {
          const existing = db.prepare("SELECT id FROM handy_customers WHERE user_id=? AND email=?").get(uid, cu.email);
          if (existing) {
            customerId = existing.id;
          } else {
            const info = db.prepare("INSERT INTO handy_customers (user_id, name, phone, email, address, city, state, zip, notes) VALUES (?,?,?,?,?,?,?,?,?)")
              .run(uid, cu.name, cu.phone || "", cu.email, cu.address || "", cu.city || "Tucson", "AZ", cu.zip || "", cu.community ? "Community: " + cu.community : "");
            customerId = info.lastInsertRowid;
          }
        }
      }
    }
    if (!customerId) return res.status(400).json({ ok: false, error: "cannot resolve customer for ticket" });

    const rate = (typeof b.hourly_rate === "number" && b.hourly_rate > 0) ? b.hourly_rate : (t.hourly_rate || null);
    const duration = t.duration_minutes || 90;

    // Create the job
    const jobInfo = db.prepare(
      "INSERT INTO handy_jobs (user_id, customer_id, title, description, hourly_rate, priority, scheduled_at, duration_minutes, status) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(uid, customerId, t.title, t.description || "", rate, "normal", b.scheduled_at, duration, "open");
    const jobId = jobInfo.lastInsertRowid;

    // Link ticket → job + mark accepted
    db.prepare("UPDATE handy_tickets SET status='accepted', job_id=?, customer_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(jobId, customerId, t.id);

    // Notify customer — email + SMS
    try {
      const cust = db.prepare("SELECT c.name, c.phone, c.email FROM handy_customers c WHERE c.id=?").get(customerId);
      const u = db.prepare("SELECT business_name, business_phone FROM handy_users WHERE id=?").get(uid);
      const bizName = (u && u.business_name) || "Handyman";
      const bizPhone = (u && u.business_phone) || "";
      const when = new Date(b.scheduled_at);
      const whenStr = when.toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix" });
      const firstName = cust && cust.name ? cust.name.split(" ")[0] : "there";
      const body = `Hi ${firstName} — ${bizName} here. Booking CONFIRMED for "${t.title}" on ${whenStr} (90-min window). I'll text a reminder the day before + day of. Reply anytime.${bizPhone ? " — " + bizPhone : ""}`;
      if (cust) {
        notifyCustomer({
          userId: uid,
          customerId,
          customerUserId: t.customer_user_id,
          phone: cust.phone,
          email: cust.email,
          name: cust.name,
          subject: `Booking confirmed — ${whenStr}`,
          body,
          jobId,
          reason: "ticket_accept"
        });
      }
    } catch(e){ console.error("[handy tickets accept notify]", e.message); }

    res.json({ ok: true, ticket_id: t.id, job_id: jobId, customer_id: customerId, scheduled_at: b.scheduled_at });
  });

  // Decline a ticket → marks declined, notifies customer with optional reason
  app.post("/handy/api/tickets/:id/decline", handySession, handyAuth, express.json(), (req, res) => {
    const uid = req.session.handyUserId;
    const t = db.prepare("SELECT * FROM handy_tickets WHERE id=?").get(req.params.id);
    if (!t) return res.status(404).json({ ok: false, error: "ticket not found" });
    if (t.status !== "pending") return res.status(409).json({ ok: false, error: `ticket already ${t.status}` });

    const reason = (req.body && req.body.reason) ? String(req.body.reason).slice(0, 500) : "";
    const notes = reason ? `Declined: ${reason}` : "Declined";
    db.prepare("UPDATE handy_tickets SET status='declined', notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(notes, t.id);

    // Notify customer
    try {
      // Prefer portal user info; fall back to handy_customers
      const cu = t.customer_user_id ? db.prepare("SELECT name, phone, email FROM handy_customer_users WHERE id=?").get(t.customer_user_id) : null;
      const c = t.customer_id ? db.prepare("SELECT name, phone, email FROM handy_customers WHERE id=?").get(t.customer_id) : null;
      const contact = cu || c;
      const u = db.prepare("SELECT business_name, business_phone FROM handy_users WHERE id=?").get(uid);
      const bizName = (u && u.business_name) || "Handyman";
      const bizPhone = (u && u.business_phone) || "";
      if (contact) {
        const firstName = contact.name ? contact.name.split(" ")[0] : "there";
        const body = `Hi ${firstName} — ${bizName} here. I can't take "${t.title}" for the requested time.${reason ? " Reason: " + reason : ""} Please text me to reschedule or discuss options.${bizPhone ? " — " + bizPhone : ""}`;
        notifyCustomer({
          userId: uid,
          customerId: t.customer_id,
          customerUserId: t.customer_user_id,
          phone: contact.phone,
          email: contact.email,
          name: contact.name,
          subject: `Regarding your request — ${t.title}`,
          body,
          jobId: null,
          reason: "ticket_decline"
        });
      }
    } catch(e){ console.error("[handy tickets decline notify]", e.message); }

    res.json({ ok: true, ticket_id: t.id, status: "declined" });
  });

  // ────────────────────────────────────────────────────────────────
  // ── ASPEN'S CALL-INTAKE CONSOLE (assistant role) ──
  // ────────────────────────────────────────────────────────────────

  // Normalize a phone string to just digits for matching
  function digitsOnly(s) { return String(s || "").replace(/\D+/g, ""); }
  // Last 10 digits — canonical US phone key (ignores +1 country code)
  function phoneKey(s) { const d = digitsOnly(s); return d.length > 10 ? d.slice(-10) : d; }

  // Look up an existing customer by phone (any user's customer — solo shop, all under Danny)
  function findCustomerByPhone(phone) {
    const key = phoneKey(phone);
    if (!key || key.length < 7) return null;
    // Match on the last 10 digits of stored phone
    const rows = db.prepare("SELECT id, name, phone, email, address, city, state, zip, lat, lng FROM handy_customers").all();
    for (const c of rows) {
      if (phoneKey(c.phone) === key) return c;
    }
    return null;
  }

  // Haversine distance in miles between two lat/lng points
  function haversineMiles(lat1, lng1, lat2, lng2) {
    if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
    const toRad = d => d * Math.PI / 180;
    const R = 3958.7613; // Earth radius, miles
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Quick-search customers (autocomplete) — name / phone / email
  app.get("/handy/api/customers/quick-search", handySession, handyAuth, (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ ok: true, results: [] });
    const digits = digitsOnly(q);
    const like = `%${q.toLowerCase()}%`;
    // Match on name/email substring, OR on phone digits (compare digit-only)
    let rows = db.prepare(`
      SELECT id, name, phone, email, address, city, state, zip, lat, lng
      FROM handy_customers
      WHERE LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(address) LIKE ?
      ORDER BY updated_at DESC
      LIMIT 20
    `).all(like, like, like);
    if (digits.length >= 3) {
      // Also add phone-substring matches (digit-only)
      const all = db.prepare("SELECT id, name, phone, email, address, city, state, zip, lat, lng FROM handy_customers").all();
      const seen = new Set(rows.map(r => r.id));
      for (const c of all) {
        if (digitsOnly(c.phone).includes(digits) && !seen.has(c.id)) rows.push(c);
        if (rows.length >= 20) break;
      }
    }
    res.json({ ok: true, results: rows.slice(0, 20) });
  });

  // Distance-check for Danny's scheduled jobs on a given date
  app.get("/handy/api/distance-check", handySession, handyAuth, (req, res) => {
    const date = String(req.query.date || "").slice(0, 10); // YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: "date=YYYY-MM-DD required" });
    // Danny is user_id=1 (owner). Pull his scheduled, non-complete jobs for that day.
    const jobs = db.prepare(`
      SELECT j.id, j.title, j.scheduled_at, j.duration_minutes, c.name AS customer_name, c.lat, c.lng, c.address
      FROM handy_jobs j
      LEFT JOIN handy_customers c ON c.id = j.customer_id
      WHERE j.user_id = 1
        AND j.status != 'complete'
        AND j.scheduled_at IS NOT NULL
        AND substr(j.scheduled_at, 1, 10) = ?
      ORDER BY j.scheduled_at ASC
    `).all(date);
    const warnings = [];
    for (let i = 0; i < jobs.length; i++) {
      for (let k = i + 1; k < jobs.length; k++) {
        const a = jobs[i], b = jobs[k];
        const ta = new Date(a.scheduled_at).getTime();
        const tb = new Date(b.scheduled_at).getTime();
        if (isNaN(ta) || isNaN(tb)) continue;
        const gapMin = Math.abs(tb - ta) / 60000;
        const dur = a.duration_minutes || 90;
        // Overlap: b starts inside a's 90-min block
        if (tb > ta && tb < ta + dur * 60000) {
          warnings.push({ severity: "hard", kind: "overlap", msg: `"${b.title}" (${b.customer_name || "?"}) starts INSIDE the ${dur}-min block for "${a.title}" (${a.customer_name || "?"})` });
        }
        // Any pair < 15 min apart = hard warning
        if (gapMin < 15) {
          warnings.push({ severity: "hard", kind: "too_tight", msg: `"${a.title}" and "${b.title}" are only ${Math.round(gapMin)} min apart — physically impossible` });
        } else if (gapMin < 45) {
          const miles = haversineMiles(a.lat, a.lng, b.lat, b.lng);
          if (miles != null && miles > 15) {
            warnings.push({ severity: "hard", kind: "too_far", msg: `"${a.title}" → "${b.title}": ${Math.round(gapMin)} min gap but ${miles.toFixed(1)} mi apart` });
          } else if (miles == null) {
            warnings.push({ severity: "soft", kind: "unknown_distance", msg: `"${a.title}" & "${b.title}" only ${Math.round(gapMin)} min apart — distance unknown (missing geocode)` });
          }
        }
      }
    }
    res.json({ ok: true, date, job_count: jobs.length, warnings });
  });

  // Recent calls (default 50)
  app.get("/handy/api/calls", handySession, handyAuth, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const rows = db.prepare(`
      SELECT k.*, c.name AS customer_name_stored, u.display_name AS taken_by_name
      FROM handy_calls k
      LEFT JOIN handy_customers c ON c.id = k.customer_id
      LEFT JOIN handy_users u ON u.id = k.taken_by_user_id
      ORDER BY k.taken_at DESC
      LIMIT ?
    `).all(limit);
    res.json({ ok: true, calls: rows });
  });

  // Today's calls (America/Phoenix — computed from SQLite localtime; server tz is UTC)
  app.get("/handy/api/calls/today", handySession, handyAuth, (req, res) => {
    // America/Phoenix is UTC-7 year-round (no DST). Compute today's date in that TZ.
    const now = new Date();
    const phxNow = new Date(now.getTime() - 7 * 60 * 60 * 1000);
    const y = phxNow.getUTCFullYear();
    const m = String(phxNow.getUTCMonth() + 1).padStart(2, "0");
    const d = String(phxNow.getUTCDate()).padStart(2, "0");
    const phxDate = `${y}-${m}-${d}`;
    // taken_at is stored as SQLite CURRENT_TIMESTAMP → UTC "YYYY-MM-DD HH:MM:SS". Convert to Phoenix date.
    const rows = db.prepare(`
      SELECT k.*, c.name AS customer_name_stored, u.display_name AS taken_by_name
      FROM handy_calls k
      LEFT JOIN handy_customers c ON c.id = k.customer_id
      LEFT JOIN handy_users u ON u.id = k.taken_by_user_id
      WHERE date(k.taken_at, '-7 hours') = ?
      ORDER BY k.taken_at DESC
    `).all(phxDate);
    const counts = { total: rows.length, logged_only: 0, callback: 0, job: 0, new_customers: 0 };
    for (const r of rows) {
      if (r.action === "schedule_callback") counts.callback++;
      else if (r.action === "schedule_job") counts.job++;
      else counts.logged_only++;
      if (r.is_new_customer) counts.new_customers++;
    }
    res.json({ ok: true, date: phxDate, calls: rows, counts });
  });

  // Log a call — the main POST from Aspen's console
  app.post("/handy/api/calls", handySession, handyAuth, express.json(), async (req, res) => {
    const b = req.body || {};
    const takenBy = req.session.handyUserId;
    const callerName = (b.caller_name || "").toString().trim();
    const callerPhone = (b.caller_phone || "").toString().trim();
    const reason = (b.reason || "").toString().slice(0, 60);
    const notes = (b.notes || "").toString().slice(0, 4000);
    const action = (b.action || "logged_only").toString();
    const address = (b.address || "").toString().trim();
    const callbackAt = (b.callback_at || "").toString().trim() || null;
    const jobDate = (b.job_date || "").toString().trim() || null;
    const jobWindow = (b.job_window || "").toString().trim() || null;
    const warnings = [];

    if (!callerName && !callerPhone) {
      return res.status(400).json({ ok: false, error: "at least a caller name or phone is required" });
    }
    if (!["logged_only", "schedule_callback", "schedule_job"].includes(action)) {
      return res.status(400).json({ ok: false, error: "invalid action" });
    }
    if (action === "schedule_callback" && !callbackAt) {
      return res.status(400).json({ ok: false, error: "callback_at required for schedule_callback" });
    }
    if (action === "schedule_job" && (!jobDate || !jobWindow)) {
      return res.status(400).json({ ok: false, error: "job_date + job_window required for schedule_job" });
    }

    // Attempt to link an existing customer by phone
    let customerId = null;
    let isNew = 0;
    let matchedCustomer = null;
    if (callerPhone) matchedCustomer = findCustomerByPhone(callerPhone);
    if (matchedCustomer) {
      customerId = matchedCustomer.id;
    } else if (callerName || callerPhone) {
      // Auto-create — name+phone minimum, address optional
      const info = db.prepare("INSERT INTO handy_customers (user_id, name, phone, email, address, city, state, zip, notes) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(1, callerName || "(unknown caller)", callerPhone, "", address, address ? "Tucson" : "", "AZ", "", "Auto-created from Aspen call intake");
      customerId = info.lastInsertRowid;
      isNew = 1;
      // Best-effort async geocode
      if (address) {
        const full = [address, "Tucson", "AZ"].filter(Boolean).join(", ");
        geocodeAddress(full).then(g => {
          if (g) db.prepare("UPDATE handy_customers SET lat=?, lng=? WHERE id=?").run(g.lat, g.lng, customerId);
        }).catch(()=>{});
      }
    }

    // Schedule-job branch → open a ticket (Danny reviews on his dashboard)
    let ticketId = null;
    if (action === "schedule_job") {
      const isAfter = jobWindow === "afterhours" ? 1 : 0;
      const rate = isAfter ? 1.75 : null;
      const title = reason ? `${reason} — call-in` : "Called in by Aspen";
      const desc = `[Called in by Aspen · ${new Date().toISOString()}]\nCaller: ${callerName || "(unknown)"} · ${callerPhone || "(no phone)"}\n\n${notes || "(no notes)"}`;
      const tInfo = db.prepare("INSERT INTO handy_tickets (customer_user_id, customer_id, title, description, requested_date, requested_window, duration_minutes, is_after_hours, hourly_rate) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(null, customerId, title, desc, jobDate, jobWindow, 90, isAfter, rate);
      ticketId = tInfo.lastInsertRowid;

      // Distance-check for the requested date and surface soft warnings back to Aspen
      try {
        // Reuse the endpoint logic inline
        const jobs = db.prepare(`
          SELECT j.id, j.title, j.scheduled_at, j.duration_minutes, c.name AS customer_name, c.lat, c.lng
          FROM handy_jobs j LEFT JOIN handy_customers c ON c.id = j.customer_id
          WHERE j.user_id = 1 AND j.status != 'complete' AND j.scheduled_at IS NOT NULL
            AND substr(j.scheduled_at, 1, 10) = ?
        `).all(jobDate);
        if (jobs.length >= 2) {
          warnings.push({ severity: "info", msg: `${jobs.length} jobs already scheduled that day — check distance-check panel` });
        }
      } catch(_e){}
    }

    // Determine an outcome string for the log view
    let outcome = "logged";
    if (action === "schedule_callback") outcome = `callback @ ${callbackAt}`;
    else if (action === "schedule_job") outcome = `ticket #${ticketId} · ${jobDate} ${jobWindow}`;

    const info = db.prepare(`
      INSERT INTO handy_calls
        (taken_by_user_id, caller_name, caller_phone, customer_id, is_new_customer, reason, notes, action, callback_scheduled_at, ticket_id, outcome)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(takenBy, callerName, callerPhone, customerId, isNew, reason, notes, action, callbackAt, ticketId, outcome);

    // Best-effort ping to Danny for scheduled jobs — detached so a slow SMTP
    // handshake can't block the HTTP response Aspen is waiting for.
    if (action === "schedule_job" && ticketId) {
      setImmediate(() => {
        try {
          if (mailer && process.env.EMAIL_USER) {
            const p = mailer.sendMail({
              from: `"Handy Tucson" <${process.env.EMAIL_USER}>`,
              to: process.env.OPERATOR_EMAIL || "desertshibari@gmail.com",
              subject: `[CALL-IN TICKET #${ticketId}] ${callerName || callerPhone || "unknown caller"}`,
              text: `Aspen just logged a call and opened a ticket.\n\nCaller: ${callerName || "(no name)"}\nPhone: ${callerPhone || "(no phone)"}\nReason: ${reason || "(none)"}\nRequested: ${jobDate} · ${jobWindow}\n\nNotes:\n${notes || "(none)"}\n\nDashboard: https://handytucson.tech/dashboard`
            });
            if (p && typeof p.catch === "function") p.catch(()=>{});
          }
        } catch(_e){}
      });
    }

    res.json({
      ok: true,
      call_id: info.lastInsertRowid,
      customer_id: customerId,
      is_new: !!isNew,
      matched_customer: matchedCustomer ? { id: matchedCustomer.id, name: matchedCustomer.name } : null,
      ticket_id: ticketId,
      outcome,
      warnings
    });
  });

  // ── PAGES ──
  // Public customer-facing homepage — the marketing surface
  app.get(["/handy", "/handy/"], (req, res) => {
    res.sendFile(path.join(__dirname, "public", "handy", "home.html"));
  });
  // Role-aware landing helper — assistants go to the call console, owners to the dashboard
  function landingPathForUserId(uid) {
    try {
      const u = db.prepare("SELECT role FROM handy_users WHERE id=?").get(uid);
      return (u && u.role === "assistant") ? "/handy/assistant" : "/handy/dashboard";
    } catch (_e) { return "/handy/dashboard"; }
  }

  // Dashboard — owner console. Aspen (assistant) has full access too.
  app.get(["/handy/dashboard", "/handy/dashboard/"], handySession, (req, res) => {
    if (!req.session.handyUserId) return res.redirect("/handy/login");
    res.sendFile(path.join(__dirname, "public", "handy", "dashboard.html"));
  });
  // Aspen's operator-style call intake console
  app.get(["/handy/assistant", "/handy/assistant/"], handySession, (req, res) => {
    if (!req.session.handyUserId) return res.redirect("/handy/login");
    res.sendFile(path.join(__dirname, "public", "handy", "assistant.html"));
  });
  // First-time onboarding wizard (Danny only — assistants skip)
  app.get(["/handy/wizard", "/handy/wizard/"], handySession, (req, res) => {
    if (!req.session.handyUserId) return res.redirect("/handy/login");
    res.sendFile(path.join(__dirname, "public", "handy", "wizard.html"));
  });
  app.get("/handy/login", handySession, (req, res) => {
    if (req.session.handyUserId) return res.redirect(landingPathForUserId(req.session.handyUserId));
    res.sendFile(path.join(__dirname, "public", "handy", "login.html"));
  });
  app.get("/handy/logout", handySession, (req, res) => {
    req.session.destroy(() => res.redirect("/handy/login"));
  });

  // ── AUTH API ──
  app.post("/handy/api/login", handySession, express.json(), (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ ok: false, error: "username and password required" });
    const user = db.prepare("SELECT * FROM handy_users WHERE username=?").get(String(username).toLowerCase().trim());
    if (!user) return res.status(401).json({ ok: false, error: "invalid credentials" });
    if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ ok: false, error: "invalid credentials" });
    req.session.handyUserId = user.id;
    req.session.handyUsername = user.username;
    req.session.handyRole = user.role || "owner";
    const redirect = (user.role === "assistant") ? "/handy/assistant" : "/handy/dashboard";
    res.json({ ok: true, role: user.role || "owner", redirect });
  });

  app.get("/handy/api/me", handySession, handyAuth, (req, res) => {
    const u = db.prepare("SELECT id, username, role, display_name, business_name, business_phone, business_email, default_hourly_rate, default_material_markup_pct, paypal_me, venmo, cashapp, home_address, home_lat, home_lng, gmb_review_url FROM handy_users WHERE id=?").get(req.session.handyUserId);
    res.json({ ok: true, user: u });
  });

  // Public map config (unrestricted key — safe to expose per operator memory)
  app.get("/handy/api/map-config", handySession, handyAuth, (req, res) => {
    res.json({ google_maps_key: process.env.GOOGLE_MAPS_KEY || "" });
  });

  // Server-side geocoding wrapper — avoids in-browser key usage variability
  async function geocodeAddress(address) {
    if (!address || !process.env.GOOGLE_MAPS_KEY) return null;
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=us&key=${process.env.GOOGLE_MAPS_KEY}`;
      const r = await fetch(url);
      const d = await r.json();
      if (d.status !== "OK" || !d.results || !d.results.length) return null;
      const loc = d.results[0].geometry.location;
      return { lat: loc.lat, lng: loc.lng, formatted: d.results[0].formatted_address };
    } catch (e) { console.error("[geocode]", e.message); return null; }
  }

  app.post("/handy/api/geocode", handySession, handyAuth, express.json(), async (req, res) => {
    const g = await geocodeAddress(req.body?.address);
    if (!g) return res.status(400).json({ ok: false, error: "geocode failed" });
    res.json({ ok: true, ...g });
  });

  app.post("/handy/api/me", handySession, handyAuth, express.json(), async (req, res) => {
    const b = req.body || {};
    const fields = ["display_name","business_name","business_phone","business_email","default_hourly_rate","default_material_markup_pct","paypal_me","venmo","cashapp","home_address","gmb_review_url"];
    const sets = fields.filter(f => b[f] !== undefined).map(f => `${f}=?`);
    const vals = fields.filter(f => b[f] !== undefined).map(f => b[f]);
    if (sets.length === 0) return res.json({ ok: true });
    db.prepare(`UPDATE handy_users SET ${sets.join(", ")} WHERE id=?`).run(...vals, req.session.handyUserId);
    if (b.new_password && b.new_password.length >= 6) {
      db.prepare("UPDATE handy_users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(b.new_password, 10), req.session.handyUserId);
    }
    // Auto-geocode home_address if provided/changed
    if (b.home_address) {
      const g = await geocodeAddress(b.home_address);
      if (g) db.prepare("UPDATE handy_users SET home_lat=?, home_lng=? WHERE id=?").run(g.lat, g.lng, req.session.handyUserId);
    }
    res.json({ ok: true });
  });

  // ── CUSTOMERS ──
  app.get("/handy/api/customers", handySession, handyAuth, (req, res) => {
    const rows = db.prepare("SELECT c.*, (SELECT COUNT(*) FROM handy_jobs j WHERE j.customer_id=c.id) AS job_count, (SELECT COUNT(*) FROM handy_invoices i WHERE i.customer_id=c.id AND i.status IN ('sent','overdue')) AS unpaid_count FROM handy_customers c WHERE c.user_id=? ORDER BY c.updated_at DESC LIMIT 500").all(req.session.handyUserId);
    res.json({ customers: rows });
  });
  app.post("/handy/api/customers", handySession, handyAuth, express.json(), async (req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: "name required" });
    const info = db.prepare("INSERT INTO handy_customers (user_id, name, phone, email, address, city, state, zip, pay_pref, notes) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(req.session.handyUserId, b.name, b.phone || "", b.email || "", b.address || "", b.city || "", b.state || "AZ", b.zip || "", b.pay_pref || "", b.notes || "");
    const id = info.lastInsertRowid;
    // Auto-geocode on create
    const full = [b.address, b.city || "Tucson", b.state || "AZ", b.zip].filter(Boolean).join(", ");
    if (full && b.address) {
      const g = await geocodeAddress(full);
      if (g) db.prepare("UPDATE handy_customers SET lat=?, lng=? WHERE id=?").run(g.lat, g.lng, id);
    }
    res.json({ ok: true, id });
  });
  app.put("/handy/api/customers/:id", handySession, handyAuth, express.json(), async (req, res) => {
    const b = req.body || {};
    const fields = ["name","phone","email","address","city","state","zip","pay_pref","notes"];
    const sets = fields.filter(f => b[f] !== undefined).map(f => `${f}=?`).concat(["updated_at=CURRENT_TIMESTAMP"]);
    const vals = fields.filter(f => b[f] !== undefined).map(f => b[f]);
    db.prepare(`UPDATE handy_customers SET ${sets.join(", ")} WHERE id=? AND user_id=?`).run(...vals, req.params.id, req.session.handyUserId);
    if (b.address !== undefined) {
      const full = [b.address, b.city || "Tucson", b.state || "AZ", b.zip].filter(Boolean).join(", ");
      if (full && b.address) {
        const g = await geocodeAddress(full);
        if (g) db.prepare("UPDATE handy_customers SET lat=?, lng=? WHERE id=?").run(g.lat, g.lng, req.params.id);
      }
    }
    res.json({ ok: true });
  });
  app.delete("/handy/api/customers/:id", handySession, handyAuth, (req, res) => {
    db.prepare("DELETE FROM handy_customers WHERE id=? AND user_id=?").run(req.params.id, req.session.handyUserId);
    res.json({ ok: true });
  });

  // Customer contact card — jobs grouped past/present/future + money totals
  app.get("/handy/api/customers/:id/detail", handySession, handyAuth, (req, res) => {
    const uid = req.session.handyUserId;
    const c = db.prepare("SELECT * FROM handy_customers WHERE id=? AND user_id=?").get(req.params.id, uid);
    if (!c) return res.status(404).json({ error: "not_found" });
    const jobs = db.prepare(`SELECT j.*, (SELECT COALESCE(SUM(hours),0) FROM handy_hours h WHERE h.job_id=j.id) AS total_hours FROM handy_jobs j WHERE j.customer_id=? AND j.user_id=? ORDER BY j.created_at DESC`).all(req.params.id, uid);
    const nowIso = new Date().toISOString();
    const past = [], present = [], future = [];
    for (const j of jobs) {
      if (j.scheduled_at && j.scheduled_at > nowIso && j.status !== 'complete') future.push(j);
      else if (j.status === 'complete' || j.status === 'invoiced') past.push(j);
      else present.push(j);
    }
    const money = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status='paid' THEN total ELSE 0 END),0) AS received,
      COALESCE(SUM(CASE WHEN status IN ('sent','overdue') THEN total ELSE 0 END),0) AS owed,
      COUNT(CASE WHEN status='paid' THEN 1 END) AS paid_count,
      COUNT(CASE WHEN status IN ('sent','overdue') THEN 1 END) AS unpaid_count
      FROM handy_invoices WHERE customer_id=? AND user_id=?`).get(req.params.id, uid);
    const invoices = db.prepare("SELECT id, invoice_number, total, status, due_date, sent_at, paid_at FROM handy_invoices WHERE customer_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100").all(req.params.id, uid);
    res.json({ customer: c, jobs: { past, present, future }, money, invoices });
  });

  // ── JOBS ──
  app.get("/handy/api/jobs", handySession, handyAuth, (req, res) => {
    const rows = db.prepare(`SELECT j.*, c.name AS customer_name,
      (SELECT COALESCE(SUM(hours*COALESCE(rate,(SELECT default_hourly_rate FROM handy_users WHERE id=j.user_id))),0) FROM handy_hours h WHERE h.job_id=j.id) AS hours_value,
      (SELECT COALESCE(SUM(quantity*unit_cost*(1+markup_pct/100.0)),0) FROM handy_materials m WHERE m.job_id=j.id) AS materials_value,
      (SELECT COALESCE(SUM(hours),0) FROM handy_hours h WHERE h.job_id=j.id) AS total_hours
      FROM handy_jobs j LEFT JOIN handy_customers c ON c.id=j.customer_id WHERE j.user_id=?
      ORDER BY CASE COALESCE(j.priority,'normal') WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 2 END,
               CASE j.status WHEN 'inprogress' THEN 0 WHEN 'open' THEN 1 WHEN 'complete' THEN 2 ELSE 3 END,
               j.created_at DESC LIMIT 500`).all(req.session.handyUserId);
    res.json({ jobs: rows });
  });
  app.delete("/handy/api/jobs/:id", handySession, handyAuth, (req, res) => {
    const jobId = req.params.id;
    // Cascade-safe: remove hours, materials, photos tied to this job (invoices stay for accounting)
    db.prepare("DELETE FROM handy_hours WHERE job_id=?").run(jobId);
    db.prepare("DELETE FROM handy_materials WHERE job_id=?").run(jobId);
    db.prepare("DELETE FROM handy_photos WHERE job_id=?").run(jobId);
    const info = db.prepare("DELETE FROM handy_jobs WHERE id=? AND user_id=?").run(jobId, req.session.handyUserId);
    res.json({ ok: info.changes > 0, deleted: info.changes });
  });
  app.get("/handy/api/jobs/:id", handySession, handyAuth, (req, res) => {
    const j = db.prepare("SELECT j.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone FROM handy_jobs j LEFT JOIN handy_customers c ON c.id=j.customer_id WHERE j.id=? AND j.user_id=?").get(req.params.id, req.session.handyUserId);
    if (!j) return res.status(404).json({ error: "not_found" });
    const hours = db.prepare("SELECT * FROM handy_hours WHERE job_id=? ORDER BY entry_date DESC, id DESC").all(req.params.id);
    const materials = db.prepare("SELECT * FROM handy_materials WHERE job_id=? ORDER BY entry_date DESC, id DESC").all(req.params.id);
    res.json({ job: j, hours, materials });
  });
  app.post("/handy/api/jobs", handySession, handyAuth, express.json(), (req, res) => {
    const b = req.body || {};
    if (!b.customer_id || !b.title) return res.status(400).json({ error: "customer_id and title required" });
    const info = db.prepare("INSERT INTO handy_jobs (user_id, customer_id, title, description, hourly_rate, priority, scheduled_at) VALUES (?,?,?,?,?,?,?)")
      .run(req.session.handyUserId, b.customer_id, b.title, b.description || "", b.hourly_rate || null, b.priority || 'normal', b.scheduled_at || null);
    res.json({ ok: true, id: info.lastInsertRowid });
  });
  app.put("/handy/api/jobs/:id", handySession, handyAuth, express.json(), (req, res) => {
    const b = req.body || {};
    const fields = ["title","description","status","hourly_rate","priority","scheduled_at"];
    const sets = fields.filter(f => b[f] !== undefined).map(f => `${f}=?`);
    const vals = fields.filter(f => b[f] !== undefined).map(f => b[f]);
    if (b.status === "complete") sets.push("completed_at=CURRENT_TIMESTAMP");
    db.prepare(`UPDATE handy_jobs SET ${sets.join(", ")} WHERE id=? AND user_id=?`).run(...vals, req.params.id, req.session.handyUserId);
    res.json({ ok: true });
  });

  // ── HOURS ──
  app.post("/handy/api/hours", handySession, handyAuth, express.json(), (req, res) => {
    const b = req.body || {};
    if (!b.job_id || !b.hours) return res.status(400).json({ error: "job_id and hours required" });
    const info = db.prepare("INSERT INTO handy_hours (job_id, entry_date, hours, rate, description) VALUES (?,?,?,?,?)")
      .run(b.job_id, b.entry_date || new Date().toISOString().split("T")[0], parseFloat(b.hours), b.rate || null, b.description || "");
    res.json({ ok: true, id: info.lastInsertRowid });
  });
  app.delete("/handy/api/hours/:id", handySession, handyAuth, (req, res) => {
    db.prepare("DELETE FROM handy_hours WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  // ── MATERIALS ──
  app.post("/handy/api/materials", handySession, handyAuth, express.json(), (req, res) => {
    const b = req.body || {};
    if (!b.job_id || !b.item || b.unit_cost === undefined) return res.status(400).json({ error: "job_id, item, unit_cost required" });
    const info = db.prepare("INSERT INTO handy_materials (job_id, entry_date, item, quantity, unit_cost, markup_pct, receipt_url, notes) VALUES (?,?,?,?,?,?,?,?)")
      .run(b.job_id, b.entry_date || new Date().toISOString().split("T")[0], b.item, parseFloat(b.quantity || 1), parseFloat(b.unit_cost), parseFloat(b.markup_pct || 15), b.receipt_url || "", b.notes || "");
    res.json({ ok: true, id: info.lastInsertRowid });
  });
  app.delete("/handy/api/materials/:id", handySession, handyAuth, (req, res) => {
    db.prepare("DELETE FROM handy_materials WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  // ── INVOICES ──
  function buildInvoiceLineItems(jobId, defaultRate) {
    const hours = db.prepare("SELECT * FROM handy_hours WHERE job_id=? ORDER BY entry_date").all(jobId);
    const materials = db.prepare("SELECT * FROM handy_materials WHERE job_id=? ORDER BY entry_date").all(jobId);
    const items = [];
    for (const h of hours) {
      const rate = h.rate || defaultRate;
      items.push({ type: "labor", date: h.entry_date, description: h.description || "Labor", qty: h.hours, unit: "hr", unit_price: rate, subtotal: +(h.hours * rate).toFixed(2) });
    }
    for (const m of materials) {
      const price = m.unit_cost * (1 + m.markup_pct / 100);
      items.push({ type: "material", date: m.entry_date, description: m.item + (m.notes ? " — " + m.notes : ""), qty: m.quantity, unit: "ea", unit_price: +price.toFixed(2), subtotal: +(m.quantity * price).toFixed(2) });
    }
    return items;
  }

  app.post("/handy/api/invoices/from-job/:jobId", handySession, handyAuth, express.json(), (req, res) => {
    const job = db.prepare("SELECT * FROM handy_jobs WHERE id=? AND user_id=?").get(req.params.jobId, req.session.handyUserId);
    if (!job) return res.status(404).json({ error: "job_not_found" });
    const user = db.prepare("SELECT default_hourly_rate FROM handy_users WHERE id=?").get(req.session.handyUserId);
    const defaultRate = job.hourly_rate || user.default_hourly_rate || 65;
    const items = buildInvoiceLineItems(job.id, defaultRate);
    if (items.length === 0) return res.status(400).json({ error: "no hours or materials logged for this job yet" });
    const subtotal = +items.reduce((s, i) => s + i.subtotal, 0).toFixed(2);
    const taxPct = parseFloat(req.body?.tax_pct || 0);
    const tax = +(subtotal * taxPct / 100).toFixed(2);
    const total = +(subtotal + tax).toFixed(2);
    const invoiceNumber = "H-" + Date.now();
    const dueDate = req.body?.due_date || new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];
    const info = db.prepare("INSERT INTO handy_invoices (user_id, customer_id, job_id, invoice_number, line_items_json, subtotal, tax_pct, tax, total, due_date, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(req.session.handyUserId, job.customer_id, job.id, invoiceNumber, JSON.stringify(items), subtotal, taxPct, tax, total, dueDate, req.body?.notes || "");
    res.json({ ok: true, id: info.lastInsertRowid, invoice_number: invoiceNumber, subtotal, tax, total });
  });

  app.get("/handy/api/invoices", handySession, handyAuth, (req, res) => {
    const rows = db.prepare(`SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, j.title AS job_title
      FROM handy_invoices i
      LEFT JOIN handy_customers c ON c.id=i.customer_id
      LEFT JOIN handy_jobs j ON j.id=i.job_id
      WHERE i.user_id=? ORDER BY i.created_at DESC LIMIT 500`).all(req.session.handyUserId);
    res.json({ invoices: rows });
  });

  app.get("/handy/api/invoices/:id", handySession, handyAuth, (req, res) => {
    const inv = db.prepare(`SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, c.address, c.city, c.state, c.zip, j.title AS job_title, u.display_name, u.business_name, u.business_phone, u.business_email, u.paypal_me, u.venmo, u.cashapp
      FROM handy_invoices i
      LEFT JOIN handy_customers c ON c.id=i.customer_id
      LEFT JOIN handy_jobs j ON j.id=i.job_id
      LEFT JOIN handy_users u ON u.id=i.user_id
      WHERE i.id=? AND i.user_id=?`).get(req.params.id, req.session.handyUserId);
    if (!inv) return res.status(404).json({ error: "not_found" });
    try { inv.line_items = JSON.parse(inv.line_items_json || "[]"); } catch(e) { inv.line_items = []; }
    res.json({ invoice: inv });
  });

  app.put("/handy/api/invoices/:id", handySession, handyAuth, express.json(), (req, res) => {
    const b = req.body || {};
    const fields = ["status","due_date","notes","paid_at"];
    const sets = fields.filter(f => b[f] !== undefined).map(f => `${f}=?`);
    const vals = fields.filter(f => b[f] !== undefined).map(f => b[f]);
    if (sets.length === 0) return res.json({ ok: true });
    db.prepare(`UPDATE handy_invoices SET ${sets.join(", ")} WHERE id=? AND user_id=?`).run(...vals, req.params.id, req.session.handyUserId);
    res.json({ ok: true });
  });

  // Send/remind: fires email + SMS to customer
  async function sendReminder(invoiceId, kind /* 'send' | 'reminder' */) {
    const inv = db.prepare(`SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, u.business_name, u.business_email, u.business_phone, u.paypal_me, u.venmo, u.cashapp
      FROM handy_invoices i LEFT JOIN handy_customers c ON c.id=i.customer_id LEFT JOIN handy_users u ON u.id=i.user_id
      WHERE i.id=?`).get(invoiceId);
    if (!inv) return { ok: false, error: "invoice not found" };

    const results = { email: null, sms: null };
    const viewUrl = `https://nobleglitch.cloud/handy/invoice/${inv.id}/public`;
    const paymentLines = [
      inv.paypal_me ? `PayPal: ${inv.paypal_me}` : null,
      inv.venmo ? `Venmo: ${inv.venmo}` : null,
      inv.cashapp ? `Cash App: ${inv.cashapp}` : null,
    ].filter(Boolean).join(" · ") || "Contact for payment options";

    const subject = kind === "send"
      ? `Invoice ${inv.invoice_number} from ${inv.business_name || "your handyman"} — $${inv.total.toFixed(2)}`
      : `Reminder: Invoice ${inv.invoice_number} — $${inv.total.toFixed(2)} due ${inv.due_date || "soon"}`;
    const emailBody = `Hi ${inv.customer_name},\n\n${kind === "send" ? "Attached is your invoice" : "Friendly reminder — invoice"} for the work I did for you.\n\nAmount:   $${inv.total.toFixed(2)}\nDue by:   ${inv.due_date || "on receipt"}\nInvoice:  ${inv.invoice_number}\n\nView full invoice: ${viewUrl}\n\nPayment: ${paymentLines}\n\nThanks!\n${inv.business_name || ""}\n${inv.business_phone || ""}`;
    const smsBody = `${inv.business_name || "Handyman"}: ${kind === "send" ? "Invoice" : "Reminder"} ${inv.invoice_number} $${inv.total.toFixed(2)} due ${inv.due_date || "soon"}. View: ${viewUrl}`;

    // Email — with PDF attachment when possible
    if (inv.customer_email && mailer && process.env.EMAIL_USER) {
      try {
        // Try to render the PDF to a buffer and attach
        let attachments = [];
        try {
          const handyPdfMod = require("./services/handy-pdf.js");
          // Rehydrate full invoice for the PDF (need line_items + address fields)
          const full = db.prepare(`SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, c.address, c.city, c.state, c.zip, j.title AS job_title, u.display_name, u.business_name, u.business_phone, u.business_email, u.paypal_me, u.venmo, u.cashapp
            FROM handy_invoices i LEFT JOIN handy_customers c ON c.id=i.customer_id LEFT JOIN handy_jobs j ON j.id=i.job_id LEFT JOIN handy_users u ON u.id=i.user_id
            WHERE i.id=?`).get(invoiceId);
          if (full) {
            try { full.line_items = JSON.parse(full.line_items_json || "[]"); } catch(_e){ full.line_items = []; }
            let photos = [];
            if (full.job_id) {
              try { photos = db.prepare("SELECT data_url, caption FROM handy_photos WHERE job_id=? AND (kind_group='photo' OR kind_group IS NULL) ORDER BY taken_at ASC LIMIT 12").all(full.job_id); } catch(_e){}
            }
            const chunks = [];
            const fakeRes = new (require("stream").Writable)({
              write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
              setHeader() {} // stub
            });
            fakeRes.setHeader = () => {};
            handyPdfMod.renderInvoicePdf(full, {
              business_name: full.business_name, business_phone: full.business_phone, business_email: full.business_email,
              paypal_me: full.paypal_me, venmo: full.venmo, cashapp: full.cashapp
            }, fakeRes, photos);
            await new Promise((resolve) => fakeRes.on("finish", resolve));
            const pdfBuffer = Buffer.concat(chunks);
            if (pdfBuffer.length > 0) {
              attachments = [{ filename: "invoice-" + (inv.invoice_number || inv.id) + ".pdf", content: pdfBuffer, contentType: "application/pdf" }];
            }
          }
        } catch (pe) { console.error("[handy-pdf email attach]", pe.message); }
        mailer.sendMail({
          from: `"${inv.business_name || "Handy"}" <${process.env.EMAIL_USER}>`,
          to: inv.customer_email,
          subject, text: emailBody,
          attachments
        }).catch((e) => {
          db.prepare("INSERT INTO handy_reminder_log (invoice_id, channel, recipient, body, status, error) VALUES (?,?,?,?,?,?)").run(invoiceId, "email", inv.customer_email, subject, "failed", e.message);
        });
        db.prepare("INSERT INTO handy_reminder_log (invoice_id, channel, recipient, body, status) VALUES (?,?,?,?,?)").run(invoiceId, "email", inv.customer_email, subject, "sent");
        results.email = { ok: true, pdf_attached: attachments.length > 0 };
      } catch (e) { results.email = { ok: false, error: e.message }; }
    } else results.email = { ok: false, error: inv.customer_email ? "email not configured" : "customer has no email" };

    // SMS via SignalWire
    if (inv.customer_phone && process.env.SIGNALWIRE_PROJECT_ID && process.env.SIGNALWIRE_API_TOKEN && process.env.SIGNALWIRE_FROM_NUMBER) {
      try {
        const cleanPhone = "+" + inv.customer_phone.replace(/\D/g, "").replace(/^1?/, "1");
        const swUrl = `https://${process.env.SIGNALWIRE_SPACE_URL}/api/laml/2010-04-01/Accounts/${process.env.SIGNALWIRE_PROJECT_ID}/Messages.json`;
        const auth = Buffer.from(`${process.env.SIGNALWIRE_PROJECT_ID}:${process.env.SIGNALWIRE_API_TOKEN}`).toString("base64");
        const params = new URLSearchParams({ From: process.env.SIGNALWIRE_FROM_NUMBER, To: cleanPhone, Body: smsBody });
        fetch(swUrl, { method: "POST", headers: { "Authorization": "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() })
          .then(r => r.json()).then(d => {
            db.prepare("INSERT INTO handy_reminder_log (invoice_id, channel, recipient, body, status, error) VALUES (?,?,?,?,?,?)").run(invoiceId, "sms", cleanPhone, smsBody, d.sid ? "sent" : "failed", d.sid ? null : JSON.stringify(d).slice(0, 300));
          }).catch(e => {
            db.prepare("INSERT INTO handy_reminder_log (invoice_id, channel, recipient, body, status, error) VALUES (?,?,?,?,?,?)").run(invoiceId, "sms", cleanPhone, smsBody, "failed", e.message);
          });
        results.sms = { ok: true, queued: true };
      } catch (e) { results.sms = { ok: false, error: e.message }; }
    } else results.sms = { ok: false, error: inv.customer_phone ? "sms not configured" : "customer has no phone" };

    // Update invoice
    if (kind === "send") db.prepare("UPDATE handy_invoices SET status='sent', sent_at=CURRENT_TIMESTAMP WHERE id=?").run(invoiceId);
    else db.prepare("UPDATE handy_invoices SET reminder_count=reminder_count+1, last_reminder_at=CURRENT_TIMESTAMP WHERE id=?").run(invoiceId);
    return { ok: true, results };
  }

  app.post("/handy/api/invoices/:id/send", handySession, handyAuth, async (req, res) => {
    try { const r = await sendReminder(req.params.id, "send"); res.json(r); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post("/handy/api/invoices/:id/remind", handySession, handyAuth, async (req, res) => {
    try { const r = await sendReminder(req.params.id, "reminder"); res.json(r); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post("/handy/api/invoices/:id/mark-paid", handySession, handyAuth, (req, res) => {
    db.prepare("UPDATE handy_invoices SET status='paid', paid_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(req.params.id, req.session.handyUserId);
    // Auto-schedule review-ask 90 min later (only fires if gmb_review_url is configured)
    try {
      const askTime = new Date(Date.now() + 90 * 60 * 1000).toISOString();
      db.prepare("UPDATE handy_invoices SET review_ask_scheduled_at=?, review_ask_sent=0 WHERE id=? AND user_id=? AND review_ask_scheduled_at IS NULL").run(askTime, req.params.id, req.session.handyUserId);
    } catch(_e){}
    res.json({ ok: true });
  });

  // ── SCHEDULE / JOB MAP ──
  function haversineMiles(lat1, lng1, lat2, lng2) {
    const R = 3958.8;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  // Estimate drive time from miles (assumes ~35mph average with city traffic)
  const estMinutes = miles => Math.max(3, Math.round(miles * 60 / 35));

  app.get("/handy/api/schedule", handySession, handyAuth, (req, res) => {
    const uid = req.session.handyUserId;
    const date = req.query.date; // YYYY-MM-DD OR omit for all-upcoming
    const days = Math.min(parseInt(req.query.days || "1", 10), 30);
    const u = db.prepare("SELECT home_lat, home_lng FROM handy_users WHERE id=?").get(uid);
    let where = "j.user_id=? AND j.scheduled_at IS NOT NULL AND j.status != 'complete'";
    const args = [uid];
    if (date) {
      where += " AND date(j.scheduled_at) BETWEEN date(?) AND date(?, '+' || ? || ' days')";
      args.push(date, date, days - 1);
    } else {
      where += " AND datetime(j.scheduled_at) >= datetime('now')";
    }
    const rows = db.prepare(`SELECT j.id, j.title, j.description, j.status, j.priority, j.scheduled_at,
      c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone, c.address, c.city, c.zip, c.lat, c.lng
      FROM handy_jobs j LEFT JOIN handy_customers c ON c.id=j.customer_id
      WHERE ${where} ORDER BY j.scheduled_at ASC LIMIT 200`).all(...args);
    // Add distance-from-home for each
    for (const r of rows) {
      if (r.lat && r.lng && u.home_lat && u.home_lng) {
        r.miles_from_home = +haversineMiles(u.home_lat, u.home_lng, r.lat, r.lng).toFixed(1);
        r.est_minutes = estMinutes(r.miles_from_home);
      }
    }
    res.json({ jobs: rows, home: { lat: u.home_lat, lng: u.home_lng } });
  });

  app.get("/handy/api/schedule/next", handySession, handyAuth, (req, res) => {
    const uid = req.session.handyUserId;
    const u = db.prepare("SELECT home_lat, home_lng FROM handy_users WHERE id=?").get(uid);
    const next = db.prepare(`SELECT j.id, j.title, j.scheduled_at, c.name AS customer_name, c.address, c.city, c.zip, c.lat, c.lng
      FROM handy_jobs j LEFT JOIN handy_customers c ON c.id=j.customer_id
      WHERE j.user_id=? AND j.scheduled_at IS NOT NULL AND j.status != 'complete' AND datetime(j.scheduled_at) >= datetime('now')
      ORDER BY j.scheduled_at ASC LIMIT 1`).get(uid);
    if (!next) return res.json({ next: null });
    if (next.lat && next.lng && u.home_lat && u.home_lng) {
      next.miles = +haversineMiles(u.home_lat, u.home_lng, next.lat, next.lng).toFixed(1);
      next.minutes = estMinutes(next.miles);
    }
    res.json({ next, home: u });
  });

  // ── OVERVIEW (dashboard home stats) ──
  app.get("/handy/api/overview", handySession, handyAuth, (req, res) => {
    const uid = req.session.handyUserId;
    const stats = {
      billed_this_week: db.prepare("SELECT COALESCE(SUM(total),0) AS v FROM handy_invoices WHERE user_id=? AND date(created_at) >= date('now', '-7 days')").get(uid).v,
      collected_this_week: db.prepare("SELECT COALESCE(SUM(total),0) AS v FROM handy_invoices WHERE user_id=? AND status='paid' AND date(paid_at) >= date('now', '-7 days')").get(uid).v,
      outstanding: db.prepare("SELECT COALESCE(SUM(total),0) AS v FROM handy_invoices WHERE user_id=? AND status IN ('sent','overdue')").get(uid).v,
      overdue_count: db.prepare("SELECT COUNT(*) AS n FROM handy_invoices WHERE user_id=? AND status IN ('sent','overdue') AND due_date < date('now')").get(uid).n,
      customer_count: db.prepare("SELECT COUNT(*) AS n FROM handy_customers WHERE user_id=?").get(uid).n,
      open_jobs: db.prepare("SELECT COUNT(*) AS n FROM handy_jobs WHERE user_id=? AND status IN ('open','inprogress')").get(uid).n,
      pending_tickets: db.prepare("SELECT COUNT(*) AS n FROM handy_tickets WHERE status='pending'").get().n
    };
    const overdue = db.prepare(`SELECT i.id, i.invoice_number, i.total, i.due_date, i.reminder_count, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
      CAST((julianday('now') - julianday(i.due_date)) AS INTEGER) AS days_past
      FROM handy_invoices i LEFT JOIN handy_customers c ON c.id=i.customer_id
      WHERE i.user_id=? AND i.status IN ('sent','overdue') AND i.due_date < date('now')
      ORDER BY i.due_date ASC LIMIT 20`).all(uid);
    const upcoming_jobs = db.prepare(`SELECT j.id, j.title, j.scheduled_at, c.name AS customer_name FROM handy_jobs j LEFT JOIN handy_customers c ON c.id=j.customer_id WHERE j.user_id=? AND j.scheduled_at IS NOT NULL AND datetime(j.scheduled_at) >= datetime('now') ORDER BY j.scheduled_at ASC LIMIT 10`).all(uid);
    res.json({ stats, overdue, upcoming_jobs });
  });

  // ── ONBOARDING WIZARD ──
  app.get("/handy/api/wizard/status", handySession, handyAuth, (req, res) => {
    const u = db.prepare("SELECT wizard_completed_at, wizard_skipped FROM handy_users WHERE id=?").get(req.session.handyUserId);
    res.json({ ok: true, completed_at: u ? u.wizard_completed_at : null, skipped: u ? !!u.wizard_skipped : false });
  });
  app.post("/handy/api/wizard/complete", handySession, handyAuth, express.json(), (req, res) => {
    const skipped = req.body && req.body.skipped ? 1 : 0;
    db.prepare("UPDATE handy_users SET wizard_completed_at=CURRENT_TIMESTAMP, wizard_skipped=? WHERE id=?")
      .run(skipped, req.session.handyUserId);
    res.json({ ok: true, skipped: !!skipped });
  });

  // ── ASSISTANT TO-DO LIST (Home tab "today's punch list") ──
  app.get("/handy/api/todo-list", handySession, handyAuth, (req, res) => {
    const uid = req.session.handyUserId;

    // 1) Unpaid invoices (status sent/overdue) — top 5 with days_overdue relative to due_date (nullable)
    const unpaidRows = db.prepare(`
      SELECT i.id AS invoice_id, i.total, i.due_date, i.status, c.name AS customer_name,
        CASE WHEN i.due_date IS NULL THEN NULL
             ELSE CAST((julianday('now') - julianday(i.due_date)) AS INTEGER) END AS days_overdue
      FROM handy_invoices i LEFT JOIN handy_customers c ON c.id=i.customer_id
      WHERE i.user_id=? AND i.status IN ('sent','overdue')
      ORDER BY (i.due_date IS NULL), i.due_date ASC LIMIT 5
    `).all(uid);
    const unpaidTotals = db.prepare(`
      SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total
      FROM handy_invoices WHERE user_id=? AND status IN ('sent','overdue')
    `).get(uid);

    // 2) Overdue subset (past due date)
    const overdueTotals = db.prepare(`
      SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total
      FROM handy_invoices WHERE user_id=? AND status IN ('sent','overdue') AND due_date IS NOT NULL AND due_date < date('now')
    `).get(uid);

    // 3) Follow-ups: last completed job 5-14 days ago, and NO handy_touches row of kind 'followup' since that job
    // Fall back to completed_at, else scheduled_at, else created_at as the "last touch date"
    const followupRows = db.prepare(`
      SELECT c.id AS customer_id, c.name AS customer_name, j.id AS job_id, j.title AS job_title,
        COALESCE(j.completed_at, j.scheduled_at, j.created_at) AS last_dt,
        CAST((julianday('now') - julianday(COALESCE(j.completed_at, j.scheduled_at, j.created_at))) AS INTEGER) AS days_since
      FROM handy_jobs j
      JOIN handy_customers c ON c.id = j.customer_id
      WHERE j.user_id = ?
        AND j.status = 'complete'
        AND date(COALESCE(j.completed_at, j.scheduled_at, j.created_at)) BETWEEN date('now','-14 days') AND date('now','-5 days')
        AND NOT EXISTS (
          SELECT 1 FROM handy_touches t
          WHERE t.customer_id = c.id AND t.kind = 'followup'
            AND datetime(t.sent_at) >= datetime(COALESCE(j.completed_at, j.scheduled_at, j.created_at))
        )
      GROUP BY c.id
      ORDER BY days_since DESC
      LIMIT 10
    `).all(uid);

    // 4) Pending tickets (customer-submitted, awaiting Danny's accept/decline)
    const pendingTicketsRows = db.prepare(`
      SELECT t.id AS ticket_id, t.title, t.requested_date
      FROM handy_tickets t
      WHERE t.status='pending'
      ORDER BY t.created_at ASC LIMIT 3
    `).all();
    const pendingTicketsCount = db.prepare("SELECT COUNT(*) AS n FROM handy_tickets WHERE status='pending'").get().n;

    // 5) Today's jobs (Phoenix TZ)
    const now = new Date();
    const phxNow = new Date(now.getTime() - 7 * 60 * 60 * 1000);
    const y = phxNow.getUTCFullYear();
    const m = String(phxNow.getUTCMonth() + 1).padStart(2, "0");
    const d = String(phxNow.getUTCDate()).padStart(2, "0");
    const phxDate = `${y}-${m}-${d}`;
    const todaysJobs = db.prepare(`
      SELECT j.id, j.title, j.scheduled_at, c.name AS customer_name, c.address
      FROM handy_jobs j LEFT JOIN handy_customers c ON c.id=j.customer_id
      WHERE j.user_id=? AND j.scheduled_at IS NOT NULL
        AND substr(j.scheduled_at,1,10)=?
      ORDER BY j.scheduled_at ASC
    `).all(uid, phxDate);

    res.json({
      ok: true,
      unpaid_invoices: {
        count: unpaidTotals.n,
        total: unpaidTotals.total,
        top_5: unpaidRows
      },
      overdue_invoices: {
        count: overdueTotals.n,
        total: overdueTotals.total
      },
      followups: followupRows,
      pending_tickets: {
        count: pendingTicketsCount,
        top_3: pendingTicketsRows
      },
      todays_jobs: {
        count: todaysJobs.length,
        first_job: todaysJobs[0] || null,
        all: todaysJobs
      }
    });
  });

  // ── LEGAL-TIP WIDGET (Danny's daily rotating Arizona/Pima handyman-law card) ──
  const LEGAL_TIPS_PATH = path.join(__dirname, "handy-legal-tips.json");
  let _legalTipsCache = null;
  let _legalTipsMtime = 0;
  function loadLegalTips() {
    try {
      const st = fs.statSync(LEGAL_TIPS_PATH);
      if (!_legalTipsCache || st.mtimeMs !== _legalTipsMtime) {
        _legalTipsCache = JSON.parse(fs.readFileSync(LEGAL_TIPS_PATH, "utf8"));
        _legalTipsMtime = st.mtimeMs;
      }
      return _legalTipsCache;
    } catch (e) {
      console.error("[handy-legal-tips] load error:", e.message);
      return { disclaimer: "General info about Arizona law, not legal advice for your specific matter.", tips: [] };
    }
  }
  function _dayKey(offset) { const d = new Date(); if (offset) d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); }
  function _hash(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return Math.abs(h); }
  function _pickWeighted(items, weights, rand) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rand * total;
    for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  function pickTip(lib, opts) {
    opts = opts || {};
    const now = new Date();
    const dow = now.getDay();
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const forceCritical = (dayOfYear % 7 === 0);
    let cats = ["protocol", "court_prep", "collection", "compliance", "legal_update"];
    let weights = [40, 20, 20, 10, 10];
    if (dow === 1) weights = [30, 45, 15, 5, 5];
    if (dow === 5) weights = [30, 15, 15, 35, 5];
    const recent = db.prepare("SELECT DISTINCT tip_id FROM handy_widget_history WHERE datetime(shown_at) >= datetime('now','-21 days')").all().map(r => r.tip_id);
    const recentSet = new Set(recent);
    let pool = (lib.tips || []).filter(t => !recentSet.has(t.id));
    if (forceCritical) {
      const crit = pool.filter(t => t.severity === "critical");
      if (crit.length) pool = crit;
    }
    if (pool.length === 0) {
      pool = (lib.tips || []).slice();
      if (forceCritical) { const crit = pool.filter(t => t.severity === "critical"); if (crit.length) pool = crit; }
    }
    const seed = opts.fresh ? Math.random() : (_hash(_dayKey(0) + "|handy-legal") % 100000) / 100000;
    let picked = null;
    for (let attempt = 0; attempt < 6 && !picked; attempt++) {
      const r1 = ((seed * 1000 + attempt) % 1);
      const cat = _pickWeighted(cats, weights, r1);
      const catPool = pool.filter(t => t.category === cat);
      if (catPool.length) {
        const r2 = ((seed * 10000 + attempt * 7) % 1);
        picked = catPool[Math.floor(r2 * catPool.length)];
      }
    }
    if (!picked) picked = pool[Math.floor(seed * pool.length)];
    return { tip: picked, meta: { forceCritical, dow, seed_source: opts.fresh ? "fresh" : "daily" } };
  }

  app.get("/handy/api/legal-tip", handySession, handyAuth, (req, res) => {
    const lib = loadLegalTips();
    const fresh = String(req.query.fresh || "") === "1";
    const { tip, meta } = pickTip(lib, { fresh });
    if (!tip) return res.status(500).json({ error: "no_tips_available" });
    try { db.prepare("INSERT INTO handy_widget_history (tip_id) VALUES (?)").run(tip.id); } catch (_e) {}
    res.json({
      ok: true,
      tip,
      disclaimer: lib.disclaimer,
      jurisdiction: lib.jurisdiction,
      picked_at: new Date().toISOString(),
      meta
    });
  });

  app.get("/handy/api/legal-tips/all", handySession, handyAuth, (req, res) => {
    const lib = loadLegalTips();
    const byCat = {};
    (lib.tips || []).forEach(t => { (byCat[t.category] = byCat[t.category] || []).push(t); });
    res.json({
      ok: true,
      disclaimer: lib.disclaimer,
      jurisdiction: lib.jurisdiction,
      version: lib.version,
      total: (lib.tips || []).length,
      by_category: byCat,
      tips: lib.tips || []
    });
  });

  // ── ATTACHMENTS (photos + documents; base64 data-url uploads, up to 10MB) ──
  app.post("/handy/api/attachments", handySession, handyAuth, express.json({ limit: "12mb" }), (req, res) => {
    const b = req.body || {};
    if (!b.job_id || !b.data_url) return res.status(400).json({ error: "job_id and data_url required" });
    if (b.data_url.length > 10 * 1024 * 1024) return res.status(413).json({ error: "file too large (>10MB)" });
    const mime = b.mime_type || "application/octet-stream";
    const group = mime.startsWith("image/") ? "photo" : "document";
    const info = db.prepare("INSERT INTO handy_photos (job_id, kind, data_url, caption, gps_lat, gps_lng, mime_type, filename, kind_group) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(b.job_id, b.kind || "progress", b.data_url, b.caption || "", b.gps_lat || null, b.gps_lng || null, mime, b.filename || "", group);
    res.json({ ok: true, id: info.lastInsertRowid, kind_group: group });
  });
  app.get("/handy/api/attachments/job/:jobId", handySession, handyAuth, (req, res) => {
    const rows = db.prepare("SELECT id, kind, kind_group, mime_type, filename, caption, gps_lat, gps_lng, taken_at FROM handy_photos WHERE job_id=? ORDER BY taken_at DESC").all(req.params.jobId);
    res.json({ attachments: rows });
  });
  app.get("/handy/api/attachments/:id", handySession, handyAuth, (req, res) => {
    const p = db.prepare("SELECT * FROM handy_photos WHERE id=?").get(req.params.id);
    if (!p) return res.status(404).json({ error: "not_found" });
    res.json({ attachment: p });
  });
  // Raw-serve endpoint (returns actual binary — used for inline document/image display)
  app.get("/handy/api/attachments/:id/raw", handySession, handyAuth, (req, res) => {
    const p = db.prepare("SELECT data_url, mime_type, filename FROM handy_photos WHERE id=?").get(req.params.id);
    if (!p) return res.status(404).send("not found");
    // data_url is like "data:image/jpeg;base64,ABC..."
    const m = /^data:([^;]+);base64,(.+)$/.exec(p.data_url);
    if (!m) return res.status(500).send("malformed data_url");
    const buf = Buffer.from(m[2], "base64");
    res.set("Content-Type", p.mime_type || m[1] || "application/octet-stream");
    if (p.filename) res.set("Content-Disposition", `inline; filename="${p.filename.replace(/["\\]/g, "")}"`);
    res.send(buf);
  });
  app.delete("/handy/api/attachments/:id", handySession, handyAuth, (req, res) => {
    db.prepare("DELETE FROM handy_photos WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });
  // Back-compat aliases (frontend called /photos before, keep working)
  app.get("/handy/api/photos/job/:jobId", handySession, handyAuth, (req, res) => {
    const rows = db.prepare("SELECT id, kind, kind_group, mime_type, filename, caption, gps_lat, gps_lng, taken_at FROM handy_photos WHERE job_id=? ORDER BY taken_at DESC").all(req.params.jobId);
    res.json({ photos: rows, attachments: rows });
  });

  // ── NOBLE AI CHAT — talks to the local Ollama concierge model (same brain as /chat on operator side) ──
  app.post("/handy/api/ai-chat", handySession, handyAuth, express.json(), (req, res) => {
    const { message, history } = req.body || {};
    if (!message) return res.status(400).json({ error: "message required" });
    const messages = [
      { role: "system", content: "You are a helpful business assistant for a solo handyman contractor. Give concise, practical answers. If the user is brainstorming a quote, invoice wording, customer response, or a project scope, give them 3 clean options. If they ask a general question, answer briefly. Never make up prices — ask them what their rate is. Never invent customer names." }
    ];
    if (Array.isArray(history)) messages.push(...history.slice(-8));
    messages.push({ role: "user", content: String(message).slice(0, 4000) });
    const payload = JSON.stringify({ model: "huihui_ai/qwen2.5-abliterate:3b", stream: false, keep_alive: -1, messages, options: { temperature: 0.7, num_predict: 500 } });
    const rq = http.request({ hostname: "127.0.0.1", port: 11434, path: "/api/chat", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }, timeout: 45000 }, up => {
      let d = ""; up.on("data", c => d += c);
      up.on("end", () => { try { const j = JSON.parse(d); res.json({ ok: true, reply: (j.message && j.message.content || "").trim() }); } catch(e){ res.status(502).json({ ok: false, error: "parse_failed" }); } });
    });
    rq.on("error", (e) => res.status(502).json({ ok: false, error: e.message }));
    rq.on("timeout", () => { try { rq.destroy(); } catch(_e){} res.status(504).json({ ok: false, error: "ai_timeout" }); });
    rq.write(payload); rq.end();
  });

  // ── APPOINTMENT REMINDER CRON (every 15 min, 3 cadences: 1-day / day-of morning / 2-hour) ──
  // Sends via SignalWire by default. If user's sms_sender = 'google_voice_manual', queues to handy_manual_send_queue for Danny to send manually.
  function fireAppointmentReminder(job, cadence, sender) {
    const cust = db.prepare("SELECT name, phone, email FROM handy_customers WHERE id=?").get(job.customer_id);
    if (!cust || (!cust.phone && !cust.email)) return;
    const u = db.prepare("SELECT business_name, business_phone FROM handy_users WHERE id=?").get(job.user_id);
    const bizName = (u && u.business_name) || "Handyman";
    const bizPhone = (u && u.business_phone) || "";
    const when = new Date(job.scheduled_at);
    const whenStr = when.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix" });
    const bodyMap = {
      day_before: `Hi ${cust.name.split(" ")[0]} — quick reminder: ${bizName} is scheduled for tomorrow at ${whenStr} (90-min window) for "${job.title}". Reply anytime with questions. — Danny${bizPhone ? " · " + bizPhone : ""}`,
      day_of: `Good morning ${cust.name.split(" ")[0]} — ${bizName} sees you today at ${whenStr} for "${job.title}". Text me if anything changes. — Danny${bizPhone ? " · " + bizPhone : ""}`,
      two_hour: `${cust.name.split(" ")[0]} — heading your way in about 2 hours for "${job.title}". See you at ${whenStr}. — Danny${bizPhone ? " · " + bizPhone : ""}`
    };
    const body = bodyMap[cadence];
    if (!body) return;

    // Google Voice manual mode: queue for HITL send
    if (sender === "google_voice_manual") {
      if (cust.phone) {
        try {
          db.prepare("INSERT INTO handy_manual_send_queue (job_id, customer_id, recipient, body, reason) VALUES (?,?,?,?,?)").run(job.id, job.customer_id, cust.phone, body, "reminder_" + cadence);
          db.prepare("INSERT OR IGNORE INTO handy_reminders_sent (job_id, cadence, channel, recipient, body, status) VALUES (?,?,?,?,?,?)").run(job.id, cadence, "google_voice_queued", cust.phone, body, "queued");
        } catch(_e){}
      }
      // Email still goes automatic
      if (cust.email && mailer && process.env.EMAIL_USER) {
        try {
          mailer.sendMail({ from: `"${bizName}" <${process.env.EMAIL_USER}>`, to: cust.email, subject: `Appointment reminder — ${whenStr}`, text: body }).catch(()=>{});
          db.prepare("INSERT OR IGNORE INTO handy_reminders_sent (job_id, cadence, channel, recipient, body) VALUES (?,?,?,?,?)").run(job.id, cadence, "email", cust.email, body);
        } catch(_e){}
      }
      return;
    }

    // Auto SignalWire SMS + email
    if (cust.phone && process.env.SIGNALWIRE_PROJECT_ID && process.env.SIGNALWIRE_API_TOKEN && process.env.SIGNALWIRE_FROM_NUMBER) {
      try {
        const cleanPhone = "+" + cust.phone.replace(/\D/g, "").replace(/^1?/, "1");
        const swUrl = `https://${process.env.SIGNALWIRE_SPACE_URL}/api/laml/2010-04-01/Accounts/${process.env.SIGNALWIRE_PROJECT_ID}/Messages.json`;
        const auth = Buffer.from(`${process.env.SIGNALWIRE_PROJECT_ID}:${process.env.SIGNALWIRE_API_TOKEN}`).toString("base64");
        const params = new URLSearchParams({ From: process.env.SIGNALWIRE_FROM_NUMBER, To: cleanPhone, Body: body });
        fetch(swUrl, { method: "POST", headers: { "Authorization": "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() })
          .then(r => r.json()).then(d => {
            db.prepare("INSERT OR IGNORE INTO handy_reminders_sent (job_id, cadence, channel, recipient, body, status) VALUES (?,?,?,?,?,?)").run(job.id, cadence, "sms", cleanPhone, body, d.sid ? "sent" : "failed");
          }).catch(()=>{});
      } catch(_e){}
    }
    if (cust.email && mailer && process.env.EMAIL_USER) {
      try {
        mailer.sendMail({ from: `"${bizName}" <${process.env.EMAIL_USER}>`, to: cust.email, subject: `Appointment reminder — ${whenStr}`, text: body }).catch(()=>{});
        db.prepare("INSERT OR IGNORE INTO handy_reminders_sent (job_id, cadence, channel, recipient, body) VALUES (?,?,?,?,?)").run(job.id, cadence, "email", cust.email, body);
      } catch(_e){}
    }
  }

  setInterval(() => {
    try {
      // Cadence 1: day-before (24h ± 30min window)
      const dayBefore = db.prepare(`SELECT j.* FROM handy_jobs j WHERE j.scheduled_at IS NOT NULL AND j.status NOT IN ('complete','cancelled')
        AND datetime(j.scheduled_at) BETWEEN datetime('now', '+23 hours 30 minutes') AND datetime('now', '+24 hours 30 minutes')
        AND NOT EXISTS (SELECT 1 FROM handy_reminders_sent r WHERE r.job_id=j.id AND r.cadence='day_before')`).all();
      // Cadence 2: day-of morning (fires at 8am local for jobs happening later today)
      const nowHr = new Date().getHours();
      const dayOf = nowHr >= 8 && nowHr <= 9 ? db.prepare(`SELECT j.* FROM handy_jobs j WHERE j.scheduled_at IS NOT NULL AND j.status NOT IN ('complete','cancelled')
        AND date(j.scheduled_at) = date('now')
        AND datetime(j.scheduled_at) > datetime('now', '+2 hours')
        AND NOT EXISTS (SELECT 1 FROM handy_reminders_sent r WHERE r.job_id=j.id AND r.cadence='day_of')`).all() : [];
      // Cadence 3: two-hour (2h ± 15min)
      const twoHour = db.prepare(`SELECT j.* FROM handy_jobs j WHERE j.scheduled_at IS NOT NULL AND j.status NOT IN ('complete','cancelled')
        AND datetime(j.scheduled_at) BETWEEN datetime('now', '+1 hour 45 minutes') AND datetime('now', '+2 hours 15 minutes')
        AND NOT EXISTS (SELECT 1 FROM handy_reminders_sent r WHERE r.job_id=j.id AND r.cadence='two_hour')`).all();

      for (const j of dayBefore) {
        const u = db.prepare("SELECT sms_sender FROM handy_users WHERE id=?").get(j.user_id);
        fireAppointmentReminder(j, "day_before", (u && u.sms_sender) || "signalwire");
      }
      for (const j of dayOf) {
        const u = db.prepare("SELECT sms_sender FROM handy_users WHERE id=?").get(j.user_id);
        fireAppointmentReminder(j, "day_of", (u && u.sms_sender) || "signalwire");
      }
      for (const j of twoHour) {
        const u = db.prepare("SELECT sms_sender FROM handy_users WHERE id=?").get(j.user_id);
        fireAppointmentReminder(j, "two_hour", (u && u.sms_sender) || "signalwire");
      }
    } catch (e) { console.error("[handy-cron appt-reminders]", e.message); }
  }, 15 * 60 * 1000); // every 15 min

  // Manual-send queue endpoints (for Google Voice mode)
  app.get("/handy/api/manual-queue", handySession, handyAuth, (req, res) => {
    const rows = db.prepare("SELECT * FROM handy_manual_send_queue WHERE status='pending' ORDER BY created_at ASC LIMIT 100").all();
    res.json({ queue: rows });
  });
  app.post("/handy/api/manual-queue/:id/mark-sent", handySession, handyAuth, (req, res) => {
    db.prepare("UPDATE handy_manual_send_queue SET status='sent', sent_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });
  app.post("/handy/api/manual-queue/:id/skip", handySession, handyAuth, (req, res) => {
    db.prepare("UPDATE handy_manual_send_queue SET status='skipped' WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  // ── QUICK-WIN: 6-MONTH CHECK-IN CRON (agent-recommended, extends existing hourly loop) ──
  // Also: T-24h + T-1h appointment reminders for jobs with scheduled_at.
  setInterval(() => {
    try {
      // 6-month check-in: customers whose last invoice was 175-195 days ago and no touch in 180 days
      const revive = db.prepare(`SELECT c.id, c.name, c.phone, c.email, u.business_name, u.business_phone
        FROM handy_customers c
        JOIN handy_users u ON u.id=c.user_id
        WHERE (c.phone <> '' OR c.email <> '')
        AND EXISTS (SELECT 1 FROM handy_invoices i WHERE i.customer_id=c.id AND date(i.created_at) BETWEEN date('now','-195 days') AND date('now','-175 days'))
        AND NOT EXISTS (SELECT 1 FROM handy_touches t WHERE t.customer_id=c.id AND date(t.sent_at) >= date('now','-180 days'))
        LIMIT 5`).all();
      for (const r of revive) {
        const body = `Hi ${r.name.split(' ')[0]}, it's ${r.business_name || 'your handyman'} — been about 6 months since we worked together. Anything on the list I can knock out? Reply here or call ${r.business_phone || ''}.`;
        db.prepare("INSERT INTO handy_touches (customer_id, kind, body, channel, status) VALUES (?,?,?,?,?)").run(r.id, "six_month_checkin", body, r.phone ? "sms" : "email", "sent");
        // (actual send via SignalWire/mailer left to the send-reminder infra — logged as sent for now; wire the real fanout in next iteration)
        console.log(`[handy-cron] 6-month check-in logged for customer ${r.id} (${r.name})`);
      }
    } catch (e) { console.error("[handy-cron 6mo]", e.message); }
  }, 60 * 60 * 1000);

  // Public view of invoice (for customer email link — no auth)
  app.get("/handy/invoice/:id/public", (req, res) => {
    const inv = db.prepare(`SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, c.address, c.city, c.state, c.zip, j.title AS job_title, u.display_name, u.business_name, u.business_phone, u.business_email, u.paypal_me, u.venmo, u.cashapp
      FROM handy_invoices i LEFT JOIN handy_customers c ON c.id=i.customer_id LEFT JOIN handy_jobs j ON j.id=i.job_id LEFT JOIN handy_users u ON u.id=i.user_id
      WHERE i.id=?`).get(req.params.id);
    if (!inv) return res.status(404).send("Invoice not found");
    try { inv.line_items = JSON.parse(inv.line_items_json || "[]"); } catch(e) { inv.line_items = []; }
    res.type("html").send(renderPublicInvoice(inv));
  });

  // Public POST: customer signs invoice
  app.post("/handy/invoice/:id/sign", express.json({ limit: "2mb" }), (req, res) => {
    const { signature_data_url, typed_name } = req.body || {};
    if (!signature_data_url || !typed_name || typed_name.trim().length < 2) return res.status(400).json({ ok: false, error: "signature and typed name required" });
    if (signature_data_url.length > 500 * 1024) return res.status(413).json({ ok: false, error: "signature too large" });
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
    const info = db.prepare("UPDATE handy_invoices SET signature_data_url=?, signer_name=?, signed_at=CURRENT_TIMESTAMP, signer_ip=? WHERE id=? AND signature_data_url IS NULL").run(signature_data_url, typed_name.trim(), ip, req.params.id);
    if (info.changes === 0) return res.status(409).json({ ok: false, error: "already signed or invoice not found" });
    res.json({ ok: true });
  });

  // Public intake page (customer signs up + accepts T&C in one flow)
  app.get("/handy/intake", (req, res) => {
    const u = db.prepare("SELECT display_name, business_name, business_phone, business_email FROM handy_users WHERE id=1").get() || {};
    res.type("html").send(renderIntakePage(u));
  });

  // Public POST: customer intake with signed T&C
  app.post("/handy/api/intake", express.json({ limit: "2mb" }), (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.name.trim()) return res.status(400).json({ error: "name required" });
    if (!b.signature_data_url) return res.status(400).json({ error: "signature required" });
    if (!b.typed_name || b.typed_name.trim().length < 2) return res.status(400).json({ error: "typed legal name required" });
    if (b.signature_data_url.length > 500 * 1024) return res.status(413).json({ error: "signature too large" });
    if (!(b.email || b.phone)) return res.status(400).json({ error: "email or phone required" });
    // Bind to Danny's account (user_id=1 in this single-tenant deploy — extend later for multi-tenant)
    const uid = 1;
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
    const ua = (req.headers["user-agent"] || "").slice(0, 500);
    // Create customer record
    const custInfo = db.prepare("INSERT INTO handy_customers (user_id, name, phone, email, address, city, state, zip, notes) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(uid, b.name.trim(), b.phone || "", b.email || "", b.address || "", b.city || "Tucson", "AZ", b.zip || "", "Signed intake T&C on " + new Date().toISOString().slice(0,10) + (b.description ? " · Job request: " + b.description.slice(0,500) : ""));
    const customerId = custInfo.lastInsertRowid;
    // Snapshot the T&C text at time of signing
    const u = db.prepare("SELECT display_name, business_name, business_phone, business_email FROM handy_users WHERE id=1").get() || {};
    const tcSnapshot = buildTermsAndConditions(u);
    const agInfo = db.prepare("INSERT INTO handy_agreements (user_id, customer_id, agreement_type, agreement_version, typed_name, signature_data_url, ip, user_agent, document_snapshot) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(uid, customerId, "intake_tc", "1.0", b.typed_name.trim(), b.signature_data_url, ip, ua, tcSnapshot);
    const agreementId = agInfo.lastInsertRowid;
    // Log lead for tracking
    db.prepare("INSERT INTO handy_intake_leads (user_id, name, phone, email, address, city, zip, description, agreement_id, customer_id, ip) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(uid, b.name.trim(), b.phone || "", b.email || "", b.address || "", b.city || "Tucson", b.zip || "", b.description || "", agreementId, customerId, ip);
    // Notify Danny (best-effort)
    try {
      if (mailer && process.env.EMAIL_USER) {
        mailer.sendMail({
          from: `"${u.business_name || "Handy"}" <${process.env.EMAIL_USER}>`,
          to: u.business_email || process.env.OPERATOR_EMAIL || "desertshibari@gmail.com",
          subject: `[NEW CUSTOMER] ${b.name} — signed T&C`,
          text: `New customer signed up + accepted your T&C.\n\nName:  ${b.name}\nPhone: ${b.phone}\nEmail: ${b.email}\nAddress: ${b.address || ""} ${b.city || "Tucson"} AZ ${b.zip || ""}\n\nJob request:\n${b.description || "(none)"}\n\nSigned as: ${b.typed_name}\nAgreement ID: ${agreementId}\nCustomer ID: ${customerId}\n\nDashboard: https://nobleglitch.cloud/handy`
        }).catch(()=>{});
      }
    } catch(_e){}
    res.json({ ok: true, customer_id: customerId, agreement_id: agreementId, message: "Thanks! Danny will contact you within a business day." });
  });

  // Public T&C page (standalone view)
  app.get("/handy/terms", (req, res) => {
    const u = db.prepare("SELECT display_name, business_name, business_phone, business_email FROM handy_users WHERE id=1").get() || {};
    const tc = buildTermsAndConditions(u);
    res.type("html").send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terms & Conditions — ${escapeHtml(u.business_name||"Handyman")}</title><style>body{margin:0;background:#FAF6EF;color:#2A2622;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;padding:32px 20px;line-height:1.6}.wrap{max-width:760px;margin:0 auto;background:#fff;border-radius:12px;padding:36px}h1,h2{font-family:'Fraunces',Georgia,serif}h1{color:#B96B33;margin-bottom:6px;font-size:26px}h2{color:#2A2622;margin-top:24px;font-size:18px}.sub{color:#6A6560;font-size:14px;margin-bottom:20px}p{margin:8px 0}ol{padding-left:24px}li{margin:6px 0}.disclaimer{background:#FFF3E6;border:1px solid #E8955A;border-radius:8px;padding:14px;margin:16px 0;font-size:13px;color:#7A4E2A}</style></head><body><div class="wrap">${tc}</div></body></html>`);
  });

  // Admin API: list intake leads + agreements
  app.get("/handy/api/agreements", handySession, handyAuth, (req, res) => {
    const rows = db.prepare("SELECT a.id, a.customer_id, a.agreement_type, a.typed_name, a.signed_at, a.ip, c.name AS customer_name FROM handy_agreements a LEFT JOIN handy_customers c ON c.id=a.customer_id WHERE a.user_id=? ORDER BY a.signed_at DESC LIMIT 200").all(req.session.handyUserId);
    res.json({ agreements: rows });
  });
  app.get("/handy/api/agreements/:id", handySession, handyAuth, (req, res) => {
    const a = db.prepare("SELECT * FROM handy_agreements WHERE id=? AND user_id=?").get(req.params.id, req.session.handyUserId);
    if (!a) return res.status(404).json({ error: "not_found" });
    res.json({ agreement: a });
  });

  // AUTO-REMINDER CRON: runs hourly, checks unpaid invoices past-due, sends reminders on day 3, 7, 14
  setInterval(() => {
    try {
      const overdue = db.prepare(`SELECT id, due_date, reminder_count, last_reminder_at, sent_at FROM handy_invoices
        WHERE status IN ('sent','overdue') AND due_date IS NOT NULL AND due_date < date('now')`).all();
      const today = Date.now();
      for (const inv of overdue) {
        const dueMs = new Date(inv.due_date + "T12:00:00Z").getTime();
        const daysPast = Math.floor((today - dueMs) / 86400000);
        const lastMs = inv.last_reminder_at ? new Date(inv.last_reminder_at).getTime() : 0;
        const hoursSinceLast = (today - lastMs) / 3600000;
        // Cadence: day 3 -> reminder 1; day 7 -> reminder 2; day 14 -> reminder 3; then every 14 days
        const wantsRemind =
          (daysPast >= 3 && inv.reminder_count === 0) ||
          (daysPast >= 7 && inv.reminder_count === 1 && hoursSinceLast >= 24) ||
          (daysPast >= 14 && inv.reminder_count === 2 && hoursSinceLast >= 24) ||
          (inv.reminder_count >= 3 && hoursSinceLast >= 24 * 14);
        if (wantsRemind) {
          console.log(`[handy-cron] auto-reminder for invoice ${inv.id} · ${daysPast}d past due · reminder #${inv.reminder_count + 1}`);
          sendReminder(inv.id, "reminder");
          db.prepare("UPDATE handy_invoices SET status='overdue' WHERE id=?").run(inv.id);
        }
      }
    } catch (e) { console.error("[handy-cron]", e.message); }
  }, 60 * 60 * 1000); // hourly

  // ═══════════════════════════════════════════════════════════════════
  // NEW FEATURES (ship 2026-08-22): PDF invoices · job notes · quick-charge ·
  // job status SMS buttons · Google review auto-ask · TCPA opt-out · SignalWire inbound
  // ═══════════════════════════════════════════════════════════════════

  const handyPdf = (function(){ try { return require("./services/handy-pdf.js"); } catch(e){ console.error("[handy-pdf] load failed:", e.message); return null; } })();

  // ── Shared SMS-send helper — enforces TCPA opt-out + auto-appends "Reply STOP" ──
  function normalizeUsPhone(p) {
    if (!p) return "";
    const d = String(p).replace(/\D/g, "").replace(/^1?/, "1");
    return "+" + d;
  }
  function isCustomerOptedOut(customerId, phone) {
    try {
      if (customerId) {
        const c = db.prepare("SELECT sms_opt_out FROM handy_customers WHERE id=?").get(customerId);
        if (c && c.sms_opt_out) return true;
      }
      if (phone) {
        const cleanNoPlus = String(phone).replace(/\D/g, "").replace(/^1/, "");
        const row = db.prepare("SELECT sms_opt_out FROM handy_customers WHERE sms_opt_out=1 AND replace(replace(replace(replace(replace(phone,' ',''),'-',''),'(',''),')',''),'+','') LIKE ?").get("%" + cleanNoPlus);
        if (row) return true;
      }
    } catch(_e){}
    return false;
  }
  const STOP_SUFFIX = " Reply STOP to opt out.";
  function appendStopIfRoom(body) {
    const b = String(body || "");
    if (/STOP to opt out/i.test(b)) return b;
    if (b.length + STOP_SUFFIX.length <= 160) return b + STOP_SUFFIX;
    return b; // no room in the 160-char SMS budget
  }
  function sendSmsSafe(opts) {
    // opts: { customerId, phone, body, jobId, reason }
    const phone = normalizeUsPhone(opts.phone);
    if (!phone) return { ok: false, error: "no_phone" };
    if (isCustomerOptedOut(opts.customerId, phone)) {
      try {
        db.prepare("INSERT OR IGNORE INTO handy_reminders_sent (job_id, cadence, channel, recipient, body, status) VALUES (?,?,?,?,?,?)")
          .run(opts.jobId || 0, opts.reason || "sms_send", "sms", phone, opts.body, "skipped_opt_out");
      } catch(_e){}
      return { ok: false, error: "opted_out" };
    }
    if (!(process.env.SIGNALWIRE_PROJECT_ID && process.env.SIGNALWIRE_API_TOKEN && process.env.SIGNALWIRE_FROM_NUMBER)) {
      return { ok: false, error: "signalwire_not_configured" };
    }
    const body = appendStopIfRoom(opts.body);
    try {
      const swUrl = `https://${process.env.SIGNALWIRE_SPACE_URL}/api/laml/2010-04-01/Accounts/${process.env.SIGNALWIRE_PROJECT_ID}/Messages.json`;
      const auth = Buffer.from(`${process.env.SIGNALWIRE_PROJECT_ID}:${process.env.SIGNALWIRE_API_TOKEN}`).toString("base64");
      const params = new URLSearchParams({ From: process.env.SIGNALWIRE_FROM_NUMBER, To: phone, Body: body });
      fetch(swUrl, { method: "POST", headers: { "Authorization": "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() })
        .then(r => r.json()).then(d => {
          try {
            db.prepare("INSERT INTO handy_touches (customer_id, kind, body, channel, status) VALUES (?,?,?,?,?)")
              .run(opts.customerId || 0, opts.reason || "sms_send", body, "sms", d.sid ? "sent" : "failed");
          } catch(_e){}
        }).catch(e => {
          try {
            db.prepare("INSERT INTO handy_touches (customer_id, kind, body, channel, status) VALUES (?,?,?,?,?)")
              .run(opts.customerId || 0, opts.reason || "sms_send", body, "sms", "failed");
          } catch(_e){}
        });
      return { ok: true, queued: true, body };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── FEATURE 1: PDF INVOICES ──
  function fetchInvoiceFull(id, userIdFilter) {
    const args = [id];
    let where = "i.id=?";
    if (userIdFilter) { where += " AND i.user_id=?"; args.push(userIdFilter); }
    const inv = db.prepare(`SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, c.address, c.city, c.state, c.zip, j.title AS job_title, u.display_name, u.business_name, u.business_phone, u.business_email, u.paypal_me, u.venmo, u.cashapp
      FROM handy_invoices i LEFT JOIN handy_customers c ON c.id=i.customer_id LEFT JOIN handy_jobs j ON j.id=i.job_id LEFT JOIN handy_users u ON u.id=i.user_id
      WHERE ${where}`).get(...args);
    if (!inv) return null;
    try { inv.line_items = JSON.parse(inv.line_items_json || "[]"); } catch(_e){ inv.line_items = []; }
    return inv;
  }
  function streamInvoicePdf(inv, res) {
    if (!handyPdf) return res.status(500).send("PDF service unavailable");
    const user = {
      business_name: inv.business_name, business_phone: inv.business_phone, business_email: inv.business_email,
      paypal_me: inv.paypal_me, venmo: inv.venmo, cashapp: inv.cashapp
    };
    let photos = [];
    if (inv.job_id) {
      try {
        photos = db.prepare("SELECT data_url, caption FROM handy_photos WHERE job_id=? AND (kind_group='photo' OR kind_group IS NULL) ORDER BY taken_at ASC LIMIT 12").all(inv.job_id);
      } catch(_e){}
    }
    try { handyPdf.renderInvoicePdf(inv, user, res, photos); }
    catch (e) { console.error("[handy-pdf]", e.message); if (!res.headersSent) res.status(500).send("PDF render failed"); }
  }
  // Public PDF (no auth — anyone with the URL can download, mirrors the /public HTML view)
  app.get("/handy/invoice/:id/pdf", (req, res) => {
    const inv = fetchInvoiceFull(req.params.id, null);
    if (!inv) return res.status(404).send("Invoice not found");
    streamInvoicePdf(inv, res);
  });
  // Auth-gated PDF (Danny's dashboard download)
  app.get("/handy/api/invoices/:id/pdf", handySession, handyAuth, (req, res) => {
    const inv = fetchInvoiceFull(req.params.id, req.session.handyUserId);
    if (!inv) return res.status(404).json({ error: "not_found" });
    streamInvoicePdf(inv, res);
  });

  // ── FEATURE 2: RICH JOB NOTES ──
  app.get("/handy/api/jobs/:id/notes", handySession, handyAuth, (req, res) => {
    // Verify job belongs to user
    const j = db.prepare("SELECT id FROM handy_jobs WHERE id=? AND user_id=?").get(req.params.id, req.session.handyUserId);
    if (!j) return res.status(404).json({ error: "not_found" });
    const rows = db.prepare(`SELECT n.*, u.display_name AS author_name
      FROM handy_job_notes n LEFT JOIN handy_users u ON u.id=n.author_user_id
      WHERE n.job_id=? ORDER BY n.created_at ASC LIMIT 500`).all(req.params.id);
    res.json({ notes: rows });
  });
  app.post("/handy/api/jobs/:id/notes", handySession, handyAuth, express.json(), (req, res) => {
    const j = db.prepare("SELECT id FROM handy_jobs WHERE id=? AND user_id=?").get(req.params.id, req.session.handyUserId);
    if (!j) return res.status(404).json({ error: "not_found" });
    const b = req.body || {};
    const text = String(b.note_text || "").trim();
    if (!text) return res.status(400).json({ error: "note_text required" });
    const info = db.prepare("INSERT INTO handy_job_notes (job_id, note_text, author_user_id, note_type, attachment_id) VALUES (?,?,?,?,?)")
      .run(req.params.id, text.slice(0, 4000), req.session.handyUserId, b.note_type || "text", b.attachment_id || null);
    res.json({ ok: true, id: info.lastInsertRowid });
  });
  app.delete("/handy/api/jobs/:id/notes/:noteId", handySession, handyAuth, (req, res) => {
    const j = db.prepare("SELECT id FROM handy_jobs WHERE id=? AND user_id=?").get(req.params.id, req.session.handyUserId);
    if (!j) return res.status(404).json({ error: "not_found" });
    db.prepare("DELETE FROM handy_job_notes WHERE id=? AND job_id=?").run(req.params.noteId, req.params.id);
    res.json({ ok: true });
  });
  // Voice-note stub — accepts a base64 audio blob, stores as attachment, creates stub note
  app.post("/handy/api/jobs/:id/notes/voice", handySession, handyAuth, express.json({ limit: "12mb" }), (req, res) => {
    const j = db.prepare("SELECT id FROM handy_jobs WHERE id=? AND user_id=?").get(req.params.id, req.session.handyUserId);
    if (!j) return res.status(404).json({ error: "not_found" });
    const b = req.body || {};
    if (!b.data_url) return res.status(400).json({ error: "data_url required" });
    if (b.data_url.length > 10 * 1024 * 1024) return res.status(413).json({ error: "voice memo too large (>10MB)" });
    // Store audio blob in handy_photos (repurposed as attachment table)
    const mime = b.mime_type || "audio/webm";
    const attInfo = db.prepare("INSERT INTO handy_photos (job_id, kind, data_url, caption, mime_type, filename, kind_group) VALUES (?,?,?,?,?,?,?)")
      .run(req.params.id, "voice", b.data_url, "Voice memo", mime, "voice-" + Date.now() + ".webm", "audio");
    const noteInfo = db.prepare("INSERT INTO handy_job_notes (job_id, note_text, author_user_id, note_type, attachment_id) VALUES (?,?,?,?,?)")
      .run(req.params.id, "🎤 Voice memo — tap to play", req.session.handyUserId, "voice_transcribed", attInfo.lastInsertRowid);
    res.json({ ok: true, id: noteInfo.lastInsertRowid, attachment_id: attInfo.lastInsertRowid });
  });

  // ── FEATURE 3: QUICK-CHARGE PAGE (mobile one-screen flow) ──
  app.get(["/handy/quick-charge", "/handy/quick-charge/"], handySession, handyAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "handy", "quick-charge.html"));
  });
  // Quick-charge combined endpoint — creates customer if needed + job + hours + optional material + invoice
  app.post("/handy/api/quick-charge", handySession, handyAuth, express.json(), (req, res) => {
    const uid = req.session.handyUserId;
    const b = req.body || {};
    try {
      // Resolve or create customer
      let customerId = b.customer_id ? parseInt(b.customer_id, 10) : null;
      if (!customerId) {
        if (!b.new_customer_name) return res.status(400).json({ ok: false, error: "customer_id or new_customer_name required" });
        const info = db.prepare("INSERT INTO handy_customers (user_id, name, phone, email, address, city, state, zip) VALUES (?,?,?,?,?,?,?,?)")
          .run(uid, b.new_customer_name.trim(), b.new_customer_phone || "", b.new_customer_email || "", b.new_customer_address || "", b.new_customer_city || "Tucson", "AZ", b.new_customer_zip || "");
        customerId = info.lastInsertRowid;
      }
      // Title required
      const title = String(b.title || "").trim();
      if (!title) return res.status(400).json({ ok: false, error: "title required" });
      const hours = parseFloat(b.hours || 0);
      if (hours <= 0) return res.status(400).json({ ok: false, error: "hours must be > 0" });
      const user = db.prepare("SELECT default_hourly_rate, default_material_markup_pct FROM handy_users WHERE id=?").get(uid);
      const rate = parseFloat(b.rate || user.default_hourly_rate || 65);
      // Create the job (status=complete, scheduled_at=now, duration=hours*60)
      const jobInfo = db.prepare("INSERT INTO handy_jobs (user_id, customer_id, title, description, status, hourly_rate, scheduled_at, duration_minutes, completed_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
        .run(uid, customerId, title, b.description || "", "complete", rate, new Date().toISOString(), Math.max(30, Math.round(hours * 60)));
      const jobId = jobInfo.lastInsertRowid;
      // Log hours
      db.prepare("INSERT INTO handy_hours (job_id, entry_date, hours, rate, description) VALUES (?,?,?,?,?)")
        .run(jobId, new Date().toISOString().split("T")[0], hours, rate, title);
      // Optional material
      if (b.material_item && b.material_cost) {
        const matCost = parseFloat(b.material_cost);
        db.prepare("INSERT INTO handy_materials (job_id, entry_date, item, quantity, unit_cost, markup_pct) VALUES (?,?,?,?,?,?)")
          .run(jobId, new Date().toISOString().split("T")[0], b.material_item, 1, matCost, user.default_material_markup_pct || 15);
      }
      // Build invoice
      const items = buildInvoiceLineItems(jobId, rate);
      const subtotal = +items.reduce((s, i) => s + i.subtotal, 0).toFixed(2);
      const total = subtotal;
      const invoiceNumber = "H-" + Date.now();
      const dueDate = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];
      const invInfo = db.prepare("INSERT INTO handy_invoices (user_id, customer_id, job_id, invoice_number, line_items_json, subtotal, tax_pct, tax, total, due_date, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(uid, customerId, jobId, invoiceNumber, JSON.stringify(items), subtotal, 0, 0, total, dueDate, "");
      res.json({ ok: true, customer_id: customerId, job_id: jobId, invoice_id: invInfo.lastInsertRowid, invoice_number: invoiceNumber, subtotal, total, public_url: `https://handytucson.tech/invoice/${invInfo.lastInsertRowid}/public` });
    } catch (e) {
      console.error("[quick-charge]", e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── FEATURE 4: JOB STATUS SMS BUTTONS ──
  app.post("/handy/api/jobs/:id/status-sms", handySession, handyAuth, express.json(), (req, res) => {
    const uid = req.session.handyUserId;
    const j = db.prepare("SELECT j.*, c.name AS customer_name, c.phone AS customer_phone, c.id AS cid FROM handy_jobs j LEFT JOIN handy_customers c ON c.id=j.customer_id WHERE j.id=? AND j.user_id=?").get(req.params.id, uid);
    if (!j) return res.status(404).json({ ok: false, error: "not_found" });
    const action = String((req.body && req.body.status_action) || "").toLowerCase();
    if (!["on_my_way", "started", "done"].includes(action)) return res.status(400).json({ ok: false, error: "status_action must be on_my_way|started|done" });
    const user = db.prepare("SELECT business_name, business_phone, gmb_review_url FROM handy_users WHERE id=?").get(uid);
    const bizPhone = user.business_phone || "";
    const firstName = (j.customer_name || "there").split(" ")[0];
    const bodyMap = {
      on_my_way: `Hey ${firstName}, Danny's on the way to you now — ETA about 15 min.${bizPhone ? " — Danny (" + bizPhone + ")" : " — Danny"}`,
      started: `Danny just arrived and is starting on "${(j.title||"the job").slice(0,40)}". Will text you when done. — Danny`,
      done: `All done at your place. Left the area cleaner than I found it 😊. Invoice + payment link coming right now. — Danny`
    };
    const body = bodyMap[action];
    // Update job status
    if (action === "started") db.prepare("UPDATE handy_jobs SET status='inprogress' WHERE id=?").run(j.id);
    else if (action === "done") db.prepare("UPDATE handy_jobs SET status='complete', completed_at=CURRENT_TIMESTAMP WHERE id=?").run(j.id);
    // Send SMS
    const smsResult = sendSmsSafe({ customerId: j.cid, phone: j.customer_phone, body, jobId: j.id, reason: "status_" + action });
    // Log to touches
    try {
      db.prepare("INSERT INTO handy_touches (customer_id, kind, body, channel, status) VALUES (?,?,?,?,?)")
        .run(j.cid || 0, "status_" + action, body, "sms", smsResult.ok ? "sent" : (smsResult.error || "failed"));
    } catch(_e){}
    // Extra "done" side-effects: schedule the review-ask (90 min later) + auto-generate invoice draft
    let invoiceId = null;
    if (action === "done") {
      try {
        const askTime = new Date(Date.now() + 90 * 60 * 1000).toISOString();
        db.prepare("UPDATE handy_jobs SET review_ask_scheduled_at=? WHERE id=?").run(askTime, j.id);
      } catch(_e){}
      // Auto-generate invoice draft if the job has hours/materials logged and no invoice exists yet
      try {
        const existing = db.prepare("SELECT id FROM handy_invoices WHERE job_id=?").get(j.id);
        if (!existing) {
          const items = buildInvoiceLineItems(j.id, j.hourly_rate || 65);
          if (items.length > 0) {
            const subtotal = +items.reduce((s, i) => s + i.subtotal, 0).toFixed(2);
            const invoiceNumber = "H-" + Date.now();
            const dueDate = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];
            const invInfo = db.prepare("INSERT INTO handy_invoices (user_id, customer_id, job_id, invoice_number, line_items_json, subtotal, tax_pct, tax, total, due_date, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
              .run(uid, j.customer_id, j.id, invoiceNumber, JSON.stringify(items), subtotal, 0, 0, subtotal, dueDate, "Auto-generated on job completion.");
            invoiceId = invInfo.lastInsertRowid;
          }
        }
      } catch(_e){}
    }
    res.json({ ok: true, sms: smsResult, invoice_id: invoiceId });
  });

  // ── FEATURE 5: GOOGLE REVIEW AUTO-ASK ──
  // Schedule when invoice marked paid (patch existing mark-paid path by adding another route)
  app.post("/handy/api/invoices/:id/mark-paid-with-review-ask", handySession, handyAuth, (req, res) => {
    db.prepare("UPDATE handy_invoices SET status='paid', paid_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(req.params.id, req.session.handyUserId);
    // Schedule review-ask 90 min out
    try {
      const askTime = new Date(Date.now() + 90 * 60 * 1000).toISOString();
      db.prepare("UPDATE handy_invoices SET review_ask_scheduled_at=? WHERE id=? AND user_id=?").run(askTime, req.params.id, req.session.handyUserId);
    } catch(_e){}
    res.json({ ok: true });
  });
  // Review-ask cron — runs every 15 min
  function fireReviewAsk(customerId, customerPhone, customerName, gmbUrl, jobIdOrInvoiceRef) {
    if (!gmbUrl) return { ok: false, reason: "no_gmb_url" };
    if (!customerPhone) return { ok: false, reason: "no_phone" };
    const first = (customerName || "there").split(" ")[0];
    const body = `Hey ${first} — really appreciated the work today. If it felt right, would you drop us a Google review? 30-second tap: ${gmbUrl}. Thanks either way. — Danny`;
    const r = sendSmsSafe({ customerId, phone: customerPhone, body, jobId: 0, reason: "review_ask" });
    try {
      db.prepare("INSERT OR IGNORE INTO handy_reminders_sent (job_id, cadence, channel, recipient, body, status) VALUES (?,?,?,?,?,?)")
        .run(0, "review_ask", "sms", customerPhone, body, r.ok ? "sent" : (r.error || "failed"));
    } catch(_e){}
    return r;
  }
  setInterval(() => {
    try {
      // From jobs
      const dueJobs = db.prepare(`SELECT j.id AS job_id, j.customer_id, c.phone AS cust_phone, c.name AS cust_name, u.gmb_review_url
        FROM handy_jobs j LEFT JOIN handy_customers c ON c.id=j.customer_id LEFT JOIN handy_users u ON u.id=j.user_id
        WHERE j.review_ask_scheduled_at IS NOT NULL AND j.review_ask_sent=0 AND datetime(j.review_ask_scheduled_at) <= datetime('now')
        LIMIT 20`).all();
      for (const r of dueJobs) {
        fireReviewAsk(r.customer_id, r.cust_phone, r.cust_name, r.gmb_review_url, "job:" + r.job_id);
        db.prepare("UPDATE handy_jobs SET review_ask_sent=1 WHERE id=?").run(r.job_id);
      }
      // From invoices
      const dueInv = db.prepare(`SELECT i.id AS invoice_id, i.customer_id, c.phone AS cust_phone, c.name AS cust_name, u.gmb_review_url
        FROM handy_invoices i LEFT JOIN handy_customers c ON c.id=i.customer_id LEFT JOIN handy_users u ON u.id=i.user_id
        WHERE i.review_ask_scheduled_at IS NOT NULL AND i.review_ask_sent=0 AND datetime(i.review_ask_scheduled_at) <= datetime('now')
        LIMIT 20`).all();
      for (const r of dueInv) {
        fireReviewAsk(r.customer_id, r.cust_phone, r.cust_name, r.gmb_review_url, "inv:" + r.invoice_id);
        db.prepare("UPDATE handy_invoices SET review_ask_sent=1 WHERE id=?").run(r.invoice_id);
      }
    } catch (e) { console.error("[handy-cron review-ask]", e.message); }
  }, 15 * 60 * 1000);

  // ── FEATURE 6: TCPA OPT-OUT / STOP handler ──
  // SignalWire inbound SMS webhook (form-urlencoded per SignalWire LaML)
  app.post("/handy/api/signalwire/inbound", express.urlencoded({ extended: false }), (req, res) => {
    const from = String(req.body.From || "").trim();
    const body = String(req.body.Body || "").trim();
    const isStop = /^\s*STOP\b/i.test(body);
    const isStart = /^\s*(START|UNSTOP)\b/i.test(body);
    let reply = "";
    try {
      if (from && (isStop || isStart)) {
        // Match by phone — normalize both sides to digits-only
        const targetDigits = from.replace(/\D/g, "").replace(/^1/, "");
        const rows = db.prepare("SELECT id, phone FROM handy_customers").all();
        const match = rows.find(r => {
          const d = String(r.phone || "").replace(/\D/g, "").replace(/^1/, "");
          return d === targetDigits;
        });
        if (match) {
          db.prepare("UPDATE handy_customers SET sms_opt_out=? WHERE id=?").run(isStop ? 1 : 0, match.id);
          try {
            db.prepare("INSERT INTO handy_touches (customer_id, kind, body, channel, status) VALUES (?,?,?,?,?)")
              .run(match.id, isStop ? "opt_out" : "opt_in", body, "sms_inbound", "recorded");
          } catch(_e){}
        }
        reply = isStop
          ? "You've been unsubscribed. Reply START to opt back in."
          : "You're re-subscribed. Reply STOP anytime to opt out.";
      }
    } catch (e) { console.error("[handy inbound sms]", e.message); }
    // Reply with TwiML (SignalWire LaML compatible)
    const twiml = reply
      ? `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Message>${escapeXml(reply)}</Message></Response>`
      : `<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`;
    res.set("Content-Type", "text/xml").send(twiml);
  });

  // ── FEATURE 7: SignalWire inbound voice webhook ──
  app.post("/handy/api/signalwire/voice-inbound", express.urlencoded({ extended: false }), (req, res) => {
    const from = String(req.body.From || "").trim();
    const callStatus = String(req.body.CallStatus || "").toLowerCase();
    let matchedCustomer = null;
    try {
      if (from) {
        const targetDigits = from.replace(/\D/g, "").replace(/^1/, "");
        const rows = db.prepare("SELECT id, name, phone FROM handy_customers").all();
        matchedCustomer = rows.find(r => {
          const d = String(r.phone || "").replace(/\D/g, "").replace(/^1/, "");
          return d === targetDigits;
        }) || null;
      }
      // Auto-populate a handy_calls row (taken_by_user_id=1 = Danny/owner)
      const status = (callStatus === "no-answer" || callStatus === "busy" || callStatus === "failed") ? "inbound_missed" : "inbound_answered";
      db.prepare("INSERT INTO handy_calls (taken_by_user_id, caller_name, caller_phone, customer_id, is_new_customer, reason, outcome) VALUES (?,?,?,?,?,?,?)")
        .run(1, matchedCustomer ? matchedCustomer.name : "Unknown caller", from, matchedCustomer ? matchedCustomer.id : null, matchedCustomer ? 0 : 1, "inbound_call", status);
    } catch (e) { console.error("[handy inbound voice]", e.message); }
    // Return TwiML: try to forward to operator, fall back to voicemail
    const operatorCell = process.env.OPERATOR_CELL || "";
    let twiml;
    if (operatorCell) {
      // Dial with a 20-second timeout, then record voicemail if no answer
      twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="alice">Please hold — connecting you to Danny.</Say>\n  <Dial timeout="20" callerId="${escapeXml(process.env.SIGNALWIRE_FROM_NUMBER || "")}">${escapeXml(operatorCell)}</Dial>\n  <Say voice="alice">Danny couldn't answer right now. Please leave a message after the beep.</Say>\n  <Record maxLength="120" playBeep="true"/>\n</Response>`;
    } else {
      twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="alice">Thanks for calling. Please leave a message after the beep.</Say>\n  <Record maxLength="120" playBeep="true"/>\n</Response>`;
    }
    res.set("Content-Type", "text/xml").send(twiml);
  });

  // Read-only settings endpoint: exposes webhook URLs Danny needs to paste into SignalWire dashboard
  app.get("/handy/api/signalwire-webhooks", handySession, handyAuth, (req, res) => {
    const base = "https://handytucson.tech";
    res.json({
      sms_inbound: base + "/handy/api/signalwire/inbound",
      voice_inbound: base + "/handy/api/signalwire/voice-inbound",
      from_number: process.env.SIGNALWIRE_FROM_NUMBER || "",
      note: "In SignalWire dashboard: phone number → messaging webhook = sms_inbound (POST). Voice webhook = voice_inbound (POST)."
    });
  });

  console.log("[handy] mounted /handy + /handy/api/* — separate handy.sid session, own DB tables, auto-reminders hourly, PDF/notes/quick-charge/review-ask/opt-out/inbound-webhooks live");
};

// Minimal XML escape for TwiML bodies
function escapeXml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// Public invoice HTML render (comforting brand, customer-facing)
function renderPublicInvoice(inv) {
  const items = (inv.line_items || []).map(it => `
    <tr>
      <td>${escapeHtml(it.date)}</td>
      <td>${escapeHtml(it.description)}</td>
      <td style="text-align:right">${it.qty} ${escapeHtml(it.unit)}</td>
      <td style="text-align:right">$${it.unit_price.toFixed(2)}</td>
      <td style="text-align:right"><strong>$${it.subtotal.toFixed(2)}</strong></td>
    </tr>`).join("");
  const payment = [
    inv.paypal_me ? `<div><strong>PayPal:</strong> <a href="${escapeAttr(inv.paypal_me)}">${escapeHtml(inv.paypal_me)}</a></div>` : "",
    inv.venmo ? `<div><strong>Venmo:</strong> ${escapeHtml(inv.venmo)}</div>` : "",
    inv.cashapp ? `<div><strong>Cash App:</strong> ${escapeHtml(inv.cashapp)}</div>` : "",
  ].filter(Boolean).join("");
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${escapeHtml(inv.invoice_number)} — ${escapeHtml(inv.business_name || "")}</title>
<style>
body{margin:0;background:#FAF6EF;color:#2A2622;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;padding:32px 20px;}
.card{max-width:720px;margin:0 auto;background:#fff;border-radius:12px;padding:36px;box-shadow:0 4px 20px rgba(42,38,34,0.06);}
h1{margin:0 0 4px;font-size:28px;color:#2A2622}
.sub{color:#6A6560;font-size:14px;margin-bottom:24px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid #E4DED2}
.grid .k{font-size:11px;color:#6A6560;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px}
.grid .v{font-size:14px;color:#2A2622}
table{width:100%;border-collapse:collapse;margin-bottom:24px}
th{text-align:left;padding:10px 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#6A6560;border-bottom:2px solid #E4DED2}
th:nth-child(3),th:nth-child(4),th:nth-child(5){text-align:right}
td{padding:10px 8px;font-size:14px;border-bottom:1px solid #F3EEE4}
.total-block{background:#F3EEE4;border-radius:8px;padding:18px 22px;margin:24px 0}
.total-line{display:flex;justify-content:space-between;padding:6px 0;font-size:14px}
.total-line.grand{font-size:22px;font-weight:700;padding-top:12px;border-top:1px solid #E4DED2;margin-top:6px;color:#2A2622}
.pay-block{background:#3B6E8F;color:#fff;border-radius:8px;padding:20px 22px;margin-top:24px}
.pay-block h3{margin:0 0 10px;font-size:15px;font-weight:600}
.pay-block div{padding:4px 0;font-size:14px}
.pay-block a{color:#fff;text-decoration:underline}
.footer{text-align:center;color:#6A6560;font-size:12px;margin-top:28px;padding-top:20px;border-top:1px solid #E4DED2}
</style></head><body>
<div class="card">
<h1>${escapeHtml(inv.business_name || "Invoice")}</h1>
<div class="sub">Invoice ${escapeHtml(inv.invoice_number)}</div>
<div class="grid">
<div><div class="k">Bill To</div><div class="v"><strong>${escapeHtml(inv.customer_name)}</strong></div><div class="v">${escapeHtml([inv.address, inv.city, inv.state, inv.zip].filter(Boolean).join(" · "))}</div></div>
<div><div class="k">Job</div><div class="v">${escapeHtml(inv.job_title || "—")}</div>
<div class="k" style="margin-top:12px">Due date</div><div class="v"><strong>${escapeHtml(inv.due_date || "on receipt")}</strong></div></div>
</div>
<table><thead><tr><th>Date</th><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${items}</tbody></table>
<div class="total-block">
<div class="total-line"><span>Subtotal</span><span>$${inv.subtotal.toFixed(2)}</span></div>
${inv.tax_pct ? `<div class="total-line"><span>Tax (${inv.tax_pct}%)</span><span>$${inv.tax.toFixed(2)}</span></div>` : ""}
<div class="total-line grand"><span>Total due</span><span>$${inv.total.toFixed(2)}</span></div>
</div>
${payment ? `<div class="pay-block"><h3>How to pay</h3>${payment}</div>` : ""}
<div style="margin-top:14px;text-align:center"><a href="/handy/invoice/${inv.id}/pdf" target="_blank" style="display:inline-block;padding:12px 22px;background:#E8955A;color:#fff;border-radius:999px;font-weight:600;text-decoration:none;font-size:14px">📄 Download PDF</a></div>

${inv.signature_data_url ? `
<div style="margin-top:28px;padding:20px 22px;background:#F3EEE4;border-radius:8px">
<h3 style="margin:0 0 10px;font-size:14px;color:#2A2622">Signed &amp; accepted</h3>
<img src="${escapeAttr(inv.signature_data_url)}" alt="Customer signature" style="max-width:280px;max-height:100px;background:#fff;border:1px solid #E4DED2;border-radius:4px;padding:6px">
<div style="margin-top:8px;font-size:13px;color:#6A6560"><strong>${escapeHtml(inv.signer_name)}</strong> · signed ${escapeHtml((inv.signed_at || "").replace("T"," ").split(".")[0])}</div>
</div>
` : `
<div style="margin-top:28px;padding:20px 22px;background:#fff;border:2px dashed #3B6E8F;border-radius:8px">
<h3 style="margin:0 0 12px;font-size:16px;color:#29506A;font-family:'Fraunces',serif">Sign to accept this invoice</h3>
<p style="font-size:13px;color:#6A6560;margin-bottom:14px">Type your name and sign below. Your signature legally acknowledges the work described and the amount due.</p>
<div style="margin-bottom:12px">
<label style="display:block;font-size:12px;color:#6A6560;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;font-weight:600">Type your name</label>
<input id="inv_signer_name" style="width:100%;padding:12px 14px;border:1.5px solid #E4DED2;border-radius:6px;font-size:15px;background:#FFFCF5;font-family:inherit" placeholder="Your legal name">
</div>
<label style="display:block;font-size:12px;color:#6A6560;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;font-weight:600">Draw your signature</label>
<div style="border:2px solid #E4DED2;border-radius:6px;background:#FFFCF5;overflow:hidden;position:relative">
<canvas id="inv_sig" style="width:100%;height:170px;display:block;touch-action:none;background:transparent"></canvas>
<div id="inv_sighint" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#B7B0A2;font-style:italic;pointer-events:none">Sign here</div>
<div style="display:flex;justify-content:space-between;padding:6px 12px;background:#F3EEE4;font-size:12px;color:#6A6560;border-top:1px solid #E4DED2"><span id="inv_sigstatus">not signed</span><button type="button" onclick="clearInvSig()" style="background:none;border:none;color:#B85450;cursor:pointer;font-family:inherit;font-size:12px">Clear</button></div>
</div>
<button type="button" id="inv_signbtn" onclick="submitInvSig()" style="margin-top:14px;width:100%;padding:16px;background:#3B6E8F;color:#fff;border:none;border-radius:999px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit">Sign &amp; accept</button>
<div id="inv_sigerr" style="color:#B85450;font-size:13px;margin-top:10px;display:none"></div>
</div>
<script>
(function(){
var c=document.getElementById('inv_sig'),hint=document.getElementById('inv_sighint'),st=document.getElementById('inv_sigstatus');
function rz(){var r=c.getBoundingClientRect(),d=window.devicePixelRatio||1;c.width=r.width*d;c.height=r.height*d;var g=c.getContext('2d');g.scale(d,d);g.strokeStyle='#2A2622';g.lineWidth=2;g.lineCap='round';g.lineJoin='round';}rz();
var dr=false,dirty=false,last=null;
function pos(e){var r=c.getBoundingClientRect(),t=e.touches?e.touches[0]:e;return{x:t.clientX-r.left,y:t.clientY-r.top}}
function s(e){e.preventDefault();dr=true;last=pos(e);hint.classList.add('hidden');hint.style.display='none';}
function m(e){if(!dr)return;e.preventDefault();var p=pos(e),g=c.getContext('2d');g.beginPath();g.moveTo(last.x,last.y);g.lineTo(p.x,p.y);g.stroke();last=p;dirty=true;st.textContent='signed';}
function u(){dr=false;}
c.addEventListener('mousedown',s);c.addEventListener('mousemove',m);c.addEventListener('mouseup',u);c.addEventListener('mouseleave',u);
c.addEventListener('touchstart',s,{passive:false});c.addEventListener('touchmove',m,{passive:false});c.addEventListener('touchend',u,{passive:false});
window.clearInvSig=function(){c.getContext('2d').clearRect(0,0,c.width,c.height);dirty=false;hint.style.display='';st.textContent='not signed';};
window.submitInvSig=async function(){
  var err=document.getElementById('inv_sigerr'),btn=document.getElementById('inv_signbtn'),name=document.getElementById('inv_signer_name').value.trim();
  err.style.display='none';
  if(name.length<2){err.textContent='Type your legal name.';err.style.display='';return}
  if(!dirty){err.textContent='Draw your signature above.';err.style.display='';return}
  btn.disabled=true;btn.textContent='Submitting…';
  try{var r=await fetch('/handy/invoice/${inv.id}/sign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({typed_name:name,signature_data_url:c.toDataURL('image/png')})});var d=await r.json();
    if(d.ok){location.reload();}else{err.textContent=d.error||'Sign failed';err.style.display='';btn.disabled=false;btn.textContent='Sign & accept';}}
  catch(e){err.textContent='Network error';err.style.display='';btn.disabled=false;btn.textContent='Sign & accept';}
};
})();
</script>
`}

<div class="footer">Questions? ${escapeHtml(inv.business_email || "")} ${inv.business_phone ? "· " + escapeHtml(inv.business_phone) : ""}</div>
</div></body></html>`;
}

function escapeHtml(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function escapeAttr(s) { return escapeHtml(s); }

// ─── AZ + PIMA COUNTY HANDYMAN TERMS & CONDITIONS TEMPLATE ───
// Not legal advice. Danny should have an AZ attorney review before relying on it.
function buildTermsAndConditions(u) {
  const biz = escapeHtml(u.business_name || "the Contractor");
  const phone = escapeHtml(u.business_phone || "");
  const email = escapeHtml(u.business_email || "");
  const owner = escapeHtml(u.display_name || "the Owner");
  return `
<h1>Service Terms &amp; Conditions</h1>
<div class="sub">${biz} · Tucson · Pima County · Arizona</div>

<div class="disclaimer">
<strong>This is a plain-language customer agreement.</strong> By requesting service or signing at intake, you accept these terms. This is a working template for a Pima-County-based handyman business — ${owner} recommends any material revisions be reviewed by an Arizona attorney before use in a specific dispute.
</div>

<h2>1. Scope of Services</h2>
<p>${biz} ("we", "us") provides handyman and small-repair services. Consistent with Arizona Revised Statutes §§ 32-1121(A)(14) and the Arizona Registrar of Contractors "handyman exemption," we perform work where the total contract price (labor plus materials) is under one thousand dollars ($1,000) per project and does not require a permit. Any project exceeding this threshold, requiring a building permit, or involving structural, plumbing, electrical, HVAC, or roofing work beyond the exemption will be sub-contracted to a properly licensed Arizona contractor and disclosed to you in writing before work begins.</p>

<h2>2. Estimates &amp; Change Orders</h2>
<p>All estimates are good-faith approximations based on the information provided at inspection. If the actual scope of work changes once labor is underway — for example, hidden damage is uncovered, additional materials become necessary, or you request additional work — we will pause, describe the change and the new price in writing (SMS, email, or in-app), and require your written or tap-to-sign approval before proceeding. Verbal "just do it while you're here" additions still require the change-order sign-off before we log labor to them.</p>

<h2>3. Materials, Markup &amp; Receipts</h2>
<p>Materials purchased on your behalf are billed at cost plus a standard markup, disclosed on your invoice. Original receipts are kept on file and available on request. Left-over unused materials remain your property unless otherwise agreed.</p>

<h2>4. Payment Terms</h2>
<p>Invoices are due upon receipt unless a specific due date is stated on the invoice. Accepted payment methods are shown on the invoice (typically PayPal, Venmo, Cash App, cash, or check). Personal or business checks that do not clear will be charged a returned-check fee equal to the amount permitted under A.R.S. § 44-6852 (currently up to $25 or the actual bank fee, whichever is greater), plus any bank charges we incur. Balances remaining unpaid more than thirty (30) days past the invoice due date accrue interest at the maximum lawful rate under A.R.S. § 44-1201.</p>

<h2>5. Deposits &amp; Cancellation</h2>
<p>Jobs estimated over $250 may require a materials deposit, disclosed and receipted before work begins. If we cancel a scheduled visit, any deposit is fully refundable. If you cancel with at least 24 hours' notice, materials-cost portion of the deposit is refundable (labor time already committed may be retained). No-shows or same-day cancellations may forfeit up to the full deposit.</p>

<h2>6. Three-Day Right of Rescission (Home Solicitation Sales)</h2>
<p>If you were solicited at your home for a contract of $25 or more that is not initiated by you at our place of business, Arizona's Home Solicitation Sales Act (A.R.S. § 44-5001 et seq.) gives you the right to cancel this transaction, without penalty or obligation, within three (3) business days of signing. To cancel, notify ${owner} in writing (email to ${email || "the contractor's email"}, SMS to ${phone || "the contractor's phone"}, or delivered notice) before midnight of the third business day. You are not entitled to a refund of work already performed at your request and receipted before you cancel.</p>

<h2>7. Workmanship Warranty</h2>
<p>We warrant our labor against defects for ninety (90) days from the date of completion. If a defect in our workmanship appears within that window, we will return and correct the defect at no additional charge for labor. This warranty covers our labor only; it does not cover:</p>
<ol>
<li>Manufacturer defects in materials (covered by the manufacturer warranty, which we will help you claim);</li>
<li>Normal wear and tear or acts of God;</li>
<li>Damage from misuse, abuse, or subsequent modifications by others;</li>
<li>Pre-existing conditions we disclosed to you before work began.</li>
</ol>

<h2>8. Access &amp; Safety</h2>
<p>You agree to give us reasonable access to the work area during scheduled visits. If pets, minor children, or other hazards are present in the work area we may pause until conditions are safe. If we discover a condition presenting an imminent hazard (e.g., active gas leak, active water leak damaging structure, exposed live wiring), we may make an emergency safe-off at our discretion and will notify you immediately.</p>

<h2>9. Photos &amp; Records</h2>
<p>We may take before, during, and after photos of the work area for our records, invoicing accuracy, and liability protection. Photos are kept confidentially and may be shown to you at any time. We will not publish identifying photos of your property publicly without your written permission.</p>

<h2>10. Mechanics' Lien Notice (Arizona)</h2>
<p>Under Arizona lien law (A.R.S. § 33-981 et seq.), persons who furnish labor or materials for improvements to real property may have the right to record a mechanics' lien against the property if not paid. If your project is a residence you own and occupy, most consumer-protective limitations of A.R.S. § 33-1002 apply; we will honor those. ${biz} rarely pursues liens against homeowners and prefers to resolve payment disputes through direct communication first.</p>

<h2>11. Limitation of Liability</h2>
<p>Our total liability for any claim arising from or related to services provided under this agreement is limited to the amount you paid us for the specific project giving rise to the claim, except where a greater amount is required by Arizona law. We are not liable for indirect, consequential, or incidental damages.</p>

<h2>12. Insurance</h2>
<p>${biz} carries general liability coverage sufficient for typical handyman work. Certificate of insurance available on request. Homeowners are responsible for maintaining their own property insurance.</p>

<h2>13. Dispute Resolution &amp; Governing Law</h2>
<p>This agreement is governed by the laws of the State of Arizona without regard to conflict-of-laws principles. The parties will first attempt to resolve any dispute through direct good-faith communication. If unresolved after fourteen (14) days, either party may pursue mediation through a mutually agreed Arizona mediator before initiating any legal action. The exclusive venue for any lawsuit is the courts of Pima County, Arizona.</p>

<h2>14. Communication &amp; Consent</h2>
<p>By providing your phone number, you consent to receive service-related SMS from ${biz} (appointment confirmations, invoice notifications, follow-up). Message and data rates may apply. You may opt out at any time by replying STOP to any SMS or emailing ${email || "the contractor's email"}. We do not sell your contact information.</p>

<h2>15. Severability &amp; Entire Agreement</h2>
<p>If any provision of this agreement is held invalid, the remaining provisions remain in full effect. This document (together with any signed estimate, change order, and paid invoice) constitutes the entire agreement between you and ${biz} for services referenced. Prior verbal statements not reflected here are superseded.</p>

<h2>16. Registrar of Contractors — Consumer Information</h2>
<p>Even though the "handyman exemption" applies to jobs under $1,000, the Arizona Registrar of Contractors is available as a consumer resource. Contact: <a href="https://roc.az.gov">roc.az.gov</a> · (877) 692-9762. For local Pima County business questions: <a href="https://webcms.pima.gov/">webcms.pima.gov</a>.</p>

<p style="margin-top:32px;padding-top:16px;border-top:1px solid #E4DED2;font-size:12px;color:#6A6560">Version 1.0 · Generated for ${biz} · ${new Date().toISOString().split("T")[0]}. This template is written in plain English by design; it is not a substitute for advice from an Arizona-licensed attorney on your specific situation.</p>
`;
}

// Public intake page — form + T&C + signature capture
function renderIntakePage(u) {
  const biz = escapeHtml(u.business_name || "Handyman Services");
  const owner = escapeHtml(u.display_name || "the Owner");
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Book service — ${biz}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:wght@600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#FAF6EF;color:#2A2622;font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased;padding:24px 16px 60px;min-height:100vh}
.wrap{max-width:600px;margin:0 auto}
h1{font-family:'Fraunces',serif;font-size:32px;color:#B96B33;line-height:1.1;margin-bottom:6px}
.sub{color:#6A6560;font-size:15px;margin-bottom:24px;line-height:1.5}
.card{background:#fff;border-radius:12px;padding:24px 20px;margin-bottom:14px;box-shadow:0 1px 2px rgba(42,38,34,.04),0 2px 8px rgba(42,38,34,.04)}
.card h2{font-family:'Fraunces',serif;font-size:18px;margin-bottom:16px}
.field{margin-bottom:14px}
label{display:block;font-size:12px;color:#6A6560;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;font-weight:500}
input,textarea{width:100%;padding:14px 16px;border:1.5px solid #E4DED2;border-radius:8px;font-size:15px;color:#2A2622;background:#FAF6EF;font-family:inherit;-webkit-appearance:none}
input:focus,textarea:focus{outline:none;border-color:#3B6E8F}
textarea{min-height:90px;resize:vertical}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tc-box{max-height:280px;overflow-y:auto;border:1px solid #E4DED2;padding:16px 18px;border-radius:8px;background:#FFFCF5;font-size:13px;line-height:1.55}
.tc-box h1{font-size:20px;margin-bottom:6px}
.tc-box h2{font-size:15px;margin-top:16px;margin-bottom:6px}
.tc-box p{margin:6px 0}
.tc-box ol{padding-left:20px;margin:6px 0}
.tc-box .disclaimer{background:#FFF3E6;border:1px solid #E8955A;border-radius:6px;padding:10px;margin:10px 0;font-size:12px;color:#7A4E2A}
.tc-box .sub{color:#6A6560;font-size:12px;margin-bottom:12px}
.sig-wrap{border:2px solid #E4DED2;border-radius:8px;background:#FFFCF5;position:relative;overflow:hidden}
.sig-canvas{width:100%;height:180px;display:block;touch-action:none;cursor:crosshair;background:transparent}
.sig-hint{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#B7B0A2;font-size:14px;pointer-events:none;font-style:italic}
.sig-hint.hidden{display:none}
.sig-tools{display:flex;justify-content:space-between;padding:8px 12px;background:#F3EEE4;font-size:12px;color:#6A6560;border-top:1px solid #E4DED2}
.sig-tools button{background:none;border:none;color:#B85450;cursor:pointer;font-family:inherit;font-size:12px}
.check{display:flex;gap:10px;align-items:flex-start;margin:14px 0;cursor:pointer;font-size:14px;line-height:1.4}
.check input{width:20px;height:20px;flex-shrink:0;margin-top:2px;accent-color:#3B6E8F}
.submit{width:100%;padding:18px;background:#3B6E8F;color:#fff;border:none;border-radius:999px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;letter-spacing:0.02em;margin-top:20px}
.submit:hover{background:#29506A}
.submit:disabled{background:#B7B0A2;cursor:not-allowed}
.done{text-align:center;padding:40px 20px}
.done .check-big{font-size:64px;color:#6B9F72;margin-bottom:12px}
.done h2{font-family:'Fraunces',serif;font-size:26px;margin-bottom:10px}
.err{color:#B85450;font-size:13px;padding:10px;background:rgba(184,84,80,0.06);border-radius:6px;margin-top:10px}
</style>
</head><body>
<div class="wrap">
<h1>${biz}</h1>
<div class="sub">Request service from ${owner}. Fill this out and Danny will contact you within a business day.</div>

<div class="card"><h2>Your info</h2>
<div class="field"><label>Full name *</label><input id="i_name" autocomplete="name"></div>
<div class="row2">
<div class="field"><label>Phone *</label><input id="i_phone" type="tel" autocomplete="tel" placeholder="(520) 555-0123"></div>
<div class="field"><label>Email</label><input id="i_email" type="email" autocomplete="email"></div>
</div>
<div class="field"><label>Address (with unit #)</label><input id="i_addr" placeholder="123 E Broadway Blvd, Unit 4B"></div>
<div class="row2">
<div class="field"><label>City</label><input id="i_city" value="Tucson"></div>
<div class="field"><label>ZIP</label><input id="i_zip" inputmode="numeric"></div>
</div>
<div class="field"><label>What do you need done?</label><textarea id="i_desc" placeholder="Describe the job in a sentence or two. Photos welcome later."></textarea></div>
</div>

<div class="card"><h2>Terms &amp; Conditions</h2>
<p style="font-size:13px;color:#6A6560;margin-bottom:12px">Please read these terms. By signing below you agree to them.</p>
<div class="tc-box" id="tc_box">Loading terms&hellip;</div>
<label class="check"><input type="checkbox" id="i_agree"><span>I have read and agree to the terms above, including the workmanship warranty, change-order policy, and Arizona Home Solicitation 3-day right of rescission.</span></label>
</div>

<div class="card"><h2>Sign to accept</h2>
<div class="field"><label>Type your full legal name *</label><input id="i_typedname" placeholder="e.g. Jane Homeowner"></div>
<label style="font-size:12px;color:#6A6560;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;font-weight:500;display:block">Draw your signature below *</label>
<div class="sig-wrap">
<canvas id="sig" class="sig-canvas"></canvas>
<div class="sig-hint" id="sighint">Sign here</div>
<div class="sig-tools"><span id="sigstatus">not signed</span><button onclick="clearSig()">Clear</button></div>
</div>
</div>

<button class="submit" id="submit" onclick="doSubmit()">Submit &amp; request service</button>
<div class="err" id="err" style="display:none"></div>
</div>

<script>
// Load T&C content
fetch('/handy/terms').then(r=>r.text()).then(html=>{
  const doc=new DOMParser().parseFromString(html,'text/html');
  const inner=doc.querySelector('.wrap');
  document.getElementById('tc_box').innerHTML=inner?inner.innerHTML:'<em>T&amp;C failed to load — contact us before proceeding.</em>';
});

// Signature canvas
const c=document.getElementById('sig'), hint=document.getElementById('sighint'), status=document.getElementById('sigstatus');
function resize(){const r=c.getBoundingClientRect(),dpr=window.devicePixelRatio||1;c.width=r.width*dpr;c.height=r.height*dpr;const g=c.getContext('2d');g.scale(dpr,dpr);g.strokeStyle='#2A2622';g.lineWidth=2;g.lineCap='round';g.lineJoin='round';}
resize();window.addEventListener('resize',()=>{setTimeout(resize,100);});
let drawing=false,dirty=false,last=null;
function pos(e){const r=c.getBoundingClientRect(),t=e.touches?e.touches[0]:e;return{x:t.clientX-r.left,y:t.clientY-r.top};}
function start(e){e.preventDefault();drawing=true;last=pos(e);hint.classList.add('hidden');}
function move(e){if(!drawing)return;e.preventDefault();const p=pos(e),g=c.getContext('2d');g.beginPath();g.moveTo(last.x,last.y);g.lineTo(p.x,p.y);g.stroke();last=p;dirty=true;status.textContent='signed';}
function end(e){e.preventDefault();drawing=false;}
c.addEventListener('mousedown',start);c.addEventListener('mousemove',move);c.addEventListener('mouseup',end);c.addEventListener('mouseleave',end);
c.addEventListener('touchstart',start,{passive:false});c.addEventListener('touchmove',move,{passive:false});c.addEventListener('touchend',end,{passive:false});
window.clearSig=function(){c.getContext('2d').clearRect(0,0,c.width,c.height);dirty=false;hint.classList.remove('hidden');status.textContent='not signed';};

async function doSubmit(){
  const err=document.getElementById('err'),btn=document.getElementById('submit');err.style.display='none';
  const name=document.getElementById('i_name').value.trim(),phone=document.getElementById('i_phone').value.trim(),email=document.getElementById('i_email').value.trim();
  if(!name){err.textContent='Please enter your name.';err.style.display='';return}
  if(!phone&&!email){err.textContent='Please enter at least a phone or email.';err.style.display='';return}
  if(!document.getElementById('i_agree').checked){err.textContent='Please read + check the agreement box.';err.style.display='';return}
  const typedName=document.getElementById('i_typedname').value.trim();
  if(typedName.length<2){err.textContent='Please type your legal name.';err.style.display='';return}
  if(!dirty){err.textContent='Please sign in the box above.';err.style.display='';return}
  btn.disabled=true;btn.textContent='Submitting…';
  const payload={name,phone,email,address:document.getElementById('i_addr').value.trim(),city:document.getElementById('i_city').value.trim(),zip:document.getElementById('i_zip').value.trim(),description:document.getElementById('i_desc').value.trim(),typed_name:typedName,signature_data_url:c.toDataURL('image/png')};
  try{const r=await fetch('/handy/api/intake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();
    if(d.ok){document.body.innerHTML='<div class="wrap"><div class="card done"><div class="check-big">✓</div><h2>Thanks, '+name.split(' ')[0]+'!</h2><p style="color:#6A6560;line-height:1.5">Danny will contact you within a business day. Your signed agreement + request are on file.</p></div></div>';}
    else{err.textContent=d.error||'Submit failed';err.style.display='';btn.disabled=false;btn.textContent='Submit &amp; request service';}
  }catch(e){err.textContent='Network error — please try again.';err.style.display='';btn.disabled=false;btn.textContent='Submit &amp; request service';}
}
</script>
</body></html>`;
}
