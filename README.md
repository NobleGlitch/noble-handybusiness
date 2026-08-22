# Noble Handybusiness

**Handyman-business-in-a-box.** Self-hostable, single-container operational stack for solo handymen, small crews, and family shops. Tucson-tested at [handytucson.tech](https://handytucson.tech).

Three surfaces, one truck:

- **Owner dashboard** — jobs, hours, customers, invoices, PDF export, quick-charge mobile flow, daily punch list, legal-tip widget, AI chat.
- **Assistant call console** — big "PHONE RANG" button, autocomplete customer lookup, 3-action flow (log · callback · schedule), impossible-distance warnings, live call log.
- **Customer portal** — signup, live-calendar booking with mandatory time blocks, ticket history, review submission.
- **Team inbox (📬)** — internal mail between owner + assistant, direct-to-customer messages (locally staged; outbound email routing is v2), and quick notes-to-self. First-boot seeds a welcome message that summarizes the market value of what you're running.

Runs on one Node process + one SQLite file. No external DB, no Redis, no queues. Deploy in a container in five minutes.

Part of the [Noble Glitch](https://nobleglitch.com) network.

---

## What's in the box

**Operational**
- Owner dashboard with 7 tabs (Home / Route / Customers / Jobs / Bills / Chat / Me)
- Assistant call console with autocomplete, distance/time collision warnings, and a 3-action intake flow
- Customer-facing portal (signup, booking, ticket history)
- PDF invoice generator (branded, line items, signature block, photo attachments)
- Quick-charge mobile flow (title → hours → rate → generate invoice → text/email in under 60s)
- Onboarding wizard for first-time owner setup

**Communication**
- SignalWire / Twilio-compatible SMS layer (owner alerts, appointment reminders, review requests)
- Nodemailer stub (swap for real SMTP or Postmark/Resend/SES)
- TCPA opt-out handling built in
- Inbound SignalWire voice webhook (forwards to owner's cell, records voicemail)

**Automation**
- Appointment reminders (day-before / day-of morning / 2-hour) via cron
- Overdue-invoice reminders (day 3 / 7 / 14 / every 14 after) via cron
- 90-minute post-completion review-request via cron
- 6-month customer check-in via cron
- Legal tip widget (rotating Arizona / Pima County handyman-law cards)

**Data**
- ~20 SQLite tables (users, customers, jobs, hours, materials, invoices, tickets, reminders, calls, notes, agreements, reviews, quick-leads, …)
- WAL mode + foreign keys on by default
- All persisted to a single `.db` file — easy backup, easy migration

---

## Quick start (Docker)

```bash
git clone https://github.com/NobleGlitch/noble-handybusiness.git
cd noble-handybusiness
cp .env.example .env
# Edit .env — at minimum set SESSION_SECRET
docker compose up -d
open http://localhost:3000
```

## Quick start (Node)

Requires Node 20+ and native build tools for `better-sqlite3` + `bcrypt`.

```bash
git clone https://github.com/NobleGlitch/noble-handybusiness.git
cd noble-handybusiness
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # → paste into SESSION_SECRET
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). You'll land on the customer-facing home page. Sign up as a customer via `/portal/signup`, or create an owner user by inserting a row into `handy_users` (see [`docs/first-owner.md`](docs/first-owner.md) coming soon).

---

## Screenshots

Live production instance: **[handytucson.tech](https://handytucson.tech)**

- Landing (`/`) — hero + pricing + 6-service list + 16-photo gallery + reviews + lead form + FAQ + Noble Glitch network footer
- Owner dashboard (`/dashboard`) — after owner sign-in
- Assistant console (`/assistant`) — for whoever answers the phone
- Customer portal (`/portal`) — after customer sign-in

---

## Architecture

- **`server.js`** — standalone Express entry point. Opens SQLite, wires a stub mailer, mounts the router at `/handy/*`.
- **`handy-router.js`** — the whole operational stack, ~2,700 lines. Attaches ~80 routes, creates ~20 tables, registers cron jobs.
- **`services/handy-pdf.js`** — pdfkit-based invoice renderer.
- **`public/handy/`** — 10 vanilla-JS single-page HTMLs (no framework, no build step, all client rendering via `fetch`).

Two isolated sessions run side by side under the `/handy/*` mount:

- `handy.sid` — for the owner + assistant (dashboard + call console)
- `handy_portal.sid` — for customers (portal)

Both persist to SQLite via `better-sqlite3-session-store`. Cookies survive restarts; no external session store required.

The router originally shipped mounted on a larger multi-tenant Express app (Noble Glitch's `nobleglitch-site`). In that host, the `/handy/*` prefix is stripped by nginx `sub_filter` before hitting the browser so URLs on `handytucson.tech` look like `/dashboard` instead of `/handy/dashboard`. Standalone, you either serve at the root (accept the `/handy/` prefix) or add an nginx / Caddy rewrite in front — example configs in `docs/deploy/`.

---

## Rebranding for your own shop

This code is currently themed for Danny McKay Handyman ([handytucson.tech](https://handytucson.tech)). To adapt it for a different business:

- **Business name, phone, address, city** — find/replace inside `public/handy/*.html` and the copy strings in `handy-router.js` (search for `"Danny"`, `"McKay"`, `"Tucson"`, `520`, `handytucson`)
- **Palette + fonts** — the CSS variables at the top of `public/handy/home.html` (`--cta`, `--structural`, `--bg`) drive the whole landing. Full palette is 5 colors + 2 fonts (Archivo + Inter)
- **Legal tips** — the widget in `handy-router.js` (search for `handy_widget_history`) is loaded with Arizona / Pima County law. Swap in your jurisdiction's rules or gut it entirely
- **AZ ROC handyman exemption footer text** — replace with your state's equivalent (or remove)

A v2 with real theme-config-driven branding is planned; until then, `grep -r` is your friend.

---

## Configuration reference

All env vars documented in [`.env.example`](.env.example). Only `SESSION_SECRET` is strictly required — every SMS, PayPal, geocoding, and AI integration silently no-ops if unset. The app still runs.

| Var | Required? | Purpose |
|---|---|---|
| `SESSION_SECRET` | **yes** | Signed cookie secret. Random 48 bytes minimum |
| `PORT` | no | Default `3000` |
| `DB_PATH` | no | Default `./data/handy.db` |
| `SIGNALWIRE_*` | no | SMS layer — reminders, alerts, review requests |
| `OPERATOR_CELL` | no | Owner's phone for lead / ticket SMS pings |
| `PAYPAL_*` | no | PayPal Invoicing API |
| `GOOGLE_MAPS_KEY` | no | Address geocoding + distance checks |
| `OLLAMA_URL` + `OLLAMA_MODEL` | no | Local LLM for the owner dashboard's AI chat tab |

---

## Roadmap

- [ ] Theme-config-driven branding (single `theme.env`, no more find-replace)
- [ ] Stripe Payment Links + Square ACH alongside PayPal
- [ ] Template designer UI for invoices
- [ ] Deposit-then-balance invoice flow
- [ ] Estimate → invoice conversion
- [ ] Recurring / Home Care Membership invoices
- [ ] PWA install + offline mode for the customer portal
- [ ] Chase QuickAccept payment-link integration
- [ ] Docs site with deploy recipes for Fly.io, Railway, and bare-metal Docker

---

## License

MIT — see [LICENSE](LICENSE).

## Author

Built and maintained by [Noble Glitch](https://nobleglitch.com) — Tucson's one-stop digital solo operator. Full-stack development, software engineering, rapid response. For anything tech, quick reaction, or emergency response: call Noble.
