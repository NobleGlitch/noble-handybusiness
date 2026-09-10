# Noble Handybusiness — Feature Gap Analysis & Integration Roadmap

**Prepared:** 2026-08-23
**Author:** Noble Glitch research pass
**Target repo:** [github.com/NobleGlitch/noble-handybusiness](https://github.com/NobleGlitch/noble-handybusiness)
**Live install audited:** [handytucson.tech](https://handytucson.tech)
**Scope:** Competitive gap analysis + integration design against Service Fusion, Housecall Pro, Jobber, ServiceTitan, plus a merge plan against NobleDispatch (Noble Glitch's trucking TMS).

> **Constraint reminder (non-negotiable):** Handybusiness stays SQLite + single-container + solo-to-3-employee-friendly. No enterprise gold-plating. Existing handytucson.tech schema is additive-only.

---

## 1. Executive Summary

### 1.1 What we already have (baseline)

Confirmed by reading `/root/github-presentation/noble-handybusiness/handy-router.js` (2,921 lines, ~97 mounted routes, 22 SQLite tables) and `README.md`:

| Surface | Status |
|---|---|
| Owner dashboard (7 tabs) | Shipped |
| Assistant call console (3-action flow) | Shipped |
| Customer portal (signup / book / tickets) | Shipped |
| PDF invoice generator w/ e-signature | Shipped |
| Quick-charge mobile flow | Shipped |
| SignalWire SMS layer (reminders, alerts, review asks) | Shipped |
| Cron: appointment reminders, overdue invoices, review-ask, 6-month check-in | Shipped |
| Team inbox (owner ↔ assistant + customer) | Shipped |
| Google Voice manual-send queue | Shipped |
| SignalWire inbound voice webhook + voicemail forward | Shipped |
| Agreements + terms (typed-name + signature capture) | Shipped |
| Legal-tip rotating widget | Shipped |
| PayPal invoicing (stubbed) | Shipped |
| Onboarding wizard | Shipped |
| Job photos + attachments (base64 in SQLite) | Shipped |
| AI chat (Ollama) | Shipped |

### 1.2 Top 5 gaps ranked by revenue impact

| # | Gap | Why it matters (revenue) | Effort | Ship priority |
|---|---|---|---|---|
| **1** | **QuickBooks Online sync (customers + invoices + payments)** | Every serious buyer above solo tier already runs QBO. Absence of QBO is the #1 disqualifier vs Service Fusion/Housecall/Jobber. Unlocks the mid-market (2-10 tech shops that pay $99-299/mo). | Large | **M1** |
| **2** | **Multi-employee scheduling + roles/permissions** | Without a "field tech" role, the product hard-caps at solo. Adding techs unlocks per-seat pricing tiers ($X/tech/mo) — the actual SaaS moat. | Large | **M2** |
| **3** | **Estimate → Invoice conversion + Deposit/Progress billing** | Handybusiness only bills flat post-completion. Estimates unlock winning bigger jobs (remodels, multi-day). Deposits fund materials up-front. Already on the README roadmap. | Medium | **M1** |
| **4** | **Two-way calendar sync (Google + Outlook + iCal feed)** | Solo owners live in Google Calendar. If Handybusiness doesn't push into it (and read out of it for personal blocks), scheduling collisions kill trust. Jobber has this; Housecall does too. Table-stakes. | Small | **M1** |
| **5** | **Vehicle / crew calendar + GPS location on the dispatch board** | Once multi-tech ships, dispatchers need a truck axis — "which truck is the ladder in, and who's driving it today?" This is Service Fusion's core differentiator per [Contractor ToolStack review](https://contractortoolstack.com/software/service-fusion/) and lifts the target ceiling from 3-tech to 10-tech shops. | Medium | **M3** |

### 1.3 What NOT to build

Explicitly out of scope regardless of demand:

- Multi-warehouse inventory + purchase orders (enterprise, not <10-employee)
- Marketing automation / drip campaigns / A-B testing (that's Housecall's paid tier)
- Priceb ook maintenance UI (ServiceTitan's flagship — over-engineered for us)
- Payroll processing (integrate via QBO/Gusto/ADP — don't rebuild)
- Multi-branch / multi-location dispatch consoles (enterprise)
- Native iOS/Android app (PWA is enough; README already commits to this)

---

## 2. Service Fusion Feature Inventory (what they ship, what we don't)

**Sources:**
- [servicefusion.com features hub](https://www.servicefusion.com/field-service-management-software)
- [Service Fusion + QuickBooks Online integration page](https://www.servicefusion.com/quickbooks-online-integration)
- [Service Fusion "Killer Features" PDF](https://www.servicefusion.com/wp-content/uploads/2023/05/ServiceFusion-Killer-Features.pdf)
- [Contractor ToolStack review, 2026](https://contractortoolstack.com/software/service-fusion/)
- [FieldCamp review, 2026](https://fieldcamp.ai/reviews/service-fusion/)
- [ServiceMag review, 2026](https://www.servicemag.org/software/servicefusion)
- [FieldServiceTools review, 2026](https://fieldservicetools.com/reviews/service-fusion/)

Legend: ✅ we have · ⚠️ partial · ❌ gap · ⛔ out of scope for us

### 2.1 Booking & scheduling

| Feature | Us | Notes |
|---|---|---|
| Drag-and-drop dispatch board (tech-axis × time-axis) | ❌ | Per Service Fusion, this is their #1 UX asset — techs vertical, jobs colored blocks horizontal |
| Multi-tech / multi-resource scheduling | ❌ | We're single-tech |
| Recurring service intervals (weekly/monthly/quarterly) | ❌ | We only reminder-cron 6-month check-in |
| Job time windows (arrival window, not fixed appt) | ⚠️ | We store `duration_minutes` + `scheduled_at`, no window |
| Zone/route optimization | ❌ | We do a single "impossible-distance" check, no route |
| Customer-facing booking widget (embeddable) | ⚠️ | We have `/portal/book`, not embeddable on a marketing site |
| Google Calendar 2-way sync | ❌ | See §4 |
| Outlook 365 2-way sync | ❌ | See §4 |
| iCal feed export | ❌ | Trivial to add |
| Blackout dates / holiday calendar | ❌ | |
| Skill-based auto-assign | ⛔ | Too enterprise |

### 2.2 Customer management / CRM

| Feature | Us | Notes |
|---|---|---|
| Customer record with multiple addresses | ⚠️ | One address per customer today |
| Service history per address (not just per customer) | ❌ | Multi-property landlords need this |
| Customer notes + tags | ⚠️ | Notes yes, tags no |
| Customer files / photos gallery | ✅ | Attachments API exists |
| Duplicate-customer merge | ❌ | |
| Customer portal login | ✅ | `handy_customer_users` |
| Referral tracking | ❌ | |

### 2.3 Invoicing & payments

| Feature | Us | Notes |
|---|---|---|
| PDF invoice generation | ✅ | `services/handy-pdf.js` |
| Line items | ✅ | `line_items_json` |
| E-signature on invoice | ✅ | `signature_data_url` |
| Email invoice | ⚠️ | Nodemailer stub |
| SMS invoice link | ✅ | |
| Recurring invoices | ❌ | On README roadmap |
| Progress billing (% or fixed milestones) | ❌ | Housecall + Jobber ship this |
| Deposits (partial upfront + balance later) | ❌ | On README roadmap |
| Batch invoicing | ❌ | |
| Credit card processing | ⚠️ | PayPal only; no Stripe/Square/Chase QuickAccept |
| ACH / bank transfer | ❌ | |
| Stored payment methods | ❌ | |
| Automatic late-fee assessment | ❌ | |
| Overdue reminder cron | ✅ | Days 3/7/14/every 14 |
| QuickBooks sync (customers, invoices, payments) | ❌ | See §3 — flagship gap |

### 2.4 Estimates / proposals

| Feature | Us | Notes |
|---|---|---|
| Estimate creation | ❌ | On README roadmap |
| Estimate → Invoice conversion | ❌ | On README roadmap |
| Good/Better/Best tiered options | ❌ | Housecall + ServiceTitan pitch this |
| Customer approval workflow (view + sign) | ❌ | We do this for invoices, not estimates |
| Estimate expiration | ❌ | |

### 2.5 Inventory / parts / materials

| Feature | Us | Notes |
|---|---|---|
| Materials line items per job | ✅ | `handy_materials` |
| Markup on materials | ✅ | `markup_pct` |
| Receipt upload | ✅ | `receipt_url` |
| SKU-level inventory tracking | ⛔ | Enterprise; skip |
| Multi-warehouse | ⛔ | |
| Purchase orders | ⛔ | |
| Pricebook (menu of predefined services) | ❌ | Small handyman shops need a simple version (see M2) |

### 2.6 Reporting & analytics

| Feature | Us | Notes |
|---|---|---|
| Revenue by month | ❌ | Data is in `handy_invoices`; no report page |
| Revenue by customer | ❌ | |
| Job profitability (revenue - hours×rate - materials cost) | ❌ | |
| Tech utilization (billable hours / total hours) | ❌ | N/A until multi-tech |
| Outstanding A/R aging | ⚠️ | Cron reminds but no aging bucket display |
| Sold-vs-invoiced conversion rate | ❌ | Needs estimates first |
| CSV export | ❌ | |
| P&L report | ❌ | Best delegated to QBO once M1 lands |

### 2.7 Mobile (field-tech app)

| Feature | Us | Notes |
|---|---|---|
| Mobile-first dashboard | ✅ | Quick-charge flow is mobile-tuned |
| Offline mode | ❌ | On README roadmap (PWA) |
| Photo capture with GPS | ⚠️ | We store gps_lat/lng if provided, no capture flow enforces it |
| Voice notes (audio) | ⚠️ | `POST /jobs/:id/notes/voice` route exists — check payload |
| On-my-way SMS button | ❌ | Housecall's signature feature |
| Digital signature from customer on phone | ✅ | |
| Time-tracking clock-in/clock-out | ⚠️ | We log hours, no start/stop timer |

### 2.8 Customer-facing surfaces

| Feature | Us | Notes |
|---|---|---|
| Public landing page | ✅ | |
| Online booking | ✅ | |
| Portal for ticket history | ✅ | |
| Review request cron | ✅ | 90 min post-completion |
| Google review URL push | ✅ | `gmb_review_url` |
| "On my way" live map link | ❌ | Housecall + ServiceTitan flagship |
| Post-visit customer survey | ⚠️ | Reviews only |
| Customer's saved payment method | ❌ | |

### 2.9 Communications

| Feature | Us | Notes |
|---|---|---|
| SMS (SignalWire/Twilio compatible) | ✅ | |
| Inbound SMS webhook | ✅ | `/api/signalwire/inbound` |
| Inbound voice → cell forward + voicemail record | ✅ | `/api/signalwire/voice-inbound` |
| Email templates | ⚠️ | Hardcoded; no template UI |
| TCPA opt-out handling | ✅ | `sms_opt_out` column |
| Team chat / internal mail | ✅ | `handy_mail` |
| Call-log with caller history | ✅ | `handy_calls` |
| AI receptionist / autoresponder | ⛔ | Service Fusion charges extra for ServiceCall.ai; we defer to Noble stack |

### 2.10 Integrations

| Integration | Us | Notes |
|---|---|---|
| QuickBooks Online | ❌ | **Flagship gap — see §3** |
| QuickBooks Desktop | ⛔ | |
| Xero | ❌ | Nice-to-have; QBO first |
| Stripe | ❌ | On README roadmap |
| Square | ❌ | On README roadmap |
| PayPal Invoicing | ⚠️ | Stub only |
| Google Calendar | ❌ | **See §4** |
| Outlook / Microsoft 365 | ❌ | **See §4** |
| Zapier / Make | ❌ | Adds long tail — implement via webhooks |
| Google Maps geocoding | ✅ | |
| SignalWire / Twilio SMS | ✅ | |
| Podium / Birdeye (review platforms) | ⛔ | |
| GPS fleet (Samsara, Motive, Verizon) | ❌ | See §7 — NobleDispatch merge covers this |

### 2.11 Fleet / GPS / tracking

| Feature | Us | Notes |
|---|---|---|
| Live tech location | ❌ | |
| Vehicle assignment to job | ❌ | |
| Route replay | ❌ | |
| Mileage log per vehicle | ❌ | |
| Vehicle maintenance schedule | ❌ | |
| Registration / insurance expiry alerts | ❌ | NobleDispatch has this on `trucks.registration_expiry` |

### 2.12 Roles / permissions / team

| Feature | Us | Notes |
|---|---|---|
| Multiple user roles | ⚠️ | `handy_users.role` column exists but only 'owner' / 'assistant' in practice |
| Per-role permission matrix | ❌ | **See §5** |
| User groups / crews | ❌ | |
| Supervisor hierarchy | ❌ | |
| Audit log (who did what when) | ❌ | NobleDispatch has this via `system.audit_log` |
| Field-tech access to only their jobs | ❌ | Blocking for adoption above solo |

**Categorization summary:**

- 🔴 **11 red-flag gaps** (QBO, multi-tech scheduling, roles, estimates, calendar sync, GPS, deposits, progress billing, "on my way," recurring invoices, audit log) — targeted by M1-M3.
- 🟡 **8 nice-to-haves** (embeddable booking widget, saved payment methods, referral tracking, batch invoicing, tags, service address ≠ billing address, Zapier/webhook egress, CSV export).
- 🔵 **6 out-of-scope** (SKU inventory, PO, pricebook UI at ServiceTitan depth, marketing automation, native app, multi-branch).

---

## 3. QuickBooks Online Integration — Full Spec

**Primary sources:**
- [Intuit Developer Portal — Get Started](https://developer.intuit.com/app/developer/qbo/docs/get-started) (referenced from webhook + entity docs)
- [Truto: QuickBooks Online API Guide, 2026](https://truto.one/blog/how-to-integrate-with-the-quickbooks-online-api-2026-guide/)
- [GetKnit: QBO In-Depth Integration Guide, 2026](https://www.getknit.dev/blog/quickbooks-online-api-integration-guide-in-depth)
- [Satva: QBO API Guide 2026](https://satvasolutions.com/blog/quickbooks-online-api-guide)
- [Coefficient: QBO rate limits](https://coefficient.io/quickbooks-api/quickbooks-api-rate-limits)
- [Housecall Pro QBO sync docs](https://help.housecallpro.com/en/articles/6293215-quickbooks-online-syncing-information-from-housecall-pro)
- [Service Fusion QBO integration page](https://www.servicefusion.com/quickbooks-online-integration)

### 3.1 What must sync (bidirectionality)

| Entity | Handybusiness → QBO | QBO → Handybusiness | Trigger |
|---|---|---|---|
| Customer | ✅ create + update | ✅ create + update | On new customer creation / edit; on QBO webhook |
| Item (service or material) | ✅ create if missing | ✅ pull master pricebook | Once at connect + on webhook |
| Invoice | ✅ create + update | ⚠️ status-only (paid detection) | On invoice send + on QBO webhook `Payment.Create` |
| Payment | ✅ record | ✅ receive from QBO Payments/native | On mark-paid + on QBO webhook |
| Estimate (M2) | ✅ create + update | ⚠️ status-only | On estimate send |
| TimeActivity | ✅ push hours (optional, per-tenant flag) | ❌ | On timesheet approval — deferred to post-M2 |

**Explicit non-goals:**
- Bills, PurchaseOrders, JournalEntries, Deposits → out of scope.
- Chart of Accounts editing → we accept QBO's setup, we don't manage it.

### 3.2 OAuth 2.0 flow

QBO uses **OAuth 2.0 authorization-code with PKCE**. Per Truto (2026), access tokens live 60 min; refresh tokens got a boost in Nov 2025 — now up to **5-year validity, rotating every 24-26 hours** ([Truto blog, 2026](https://truto.one/blog/how-to-integrate-with-the-quickbooks-online-api-2026-guide/)).

**Flow:**

```
1. Owner clicks "Connect QuickBooks" in Settings.
2. Browser → GET https://appcenter.intuit.com/connect/oauth2
      ?client_id=<CLIENT_ID>
      &scope=com.intuit.quickbooks.accounting
      &redirect_uri=https://<host>/handy/api/qbo/oauth/callback
      &response_type=code
      &state=<csrf>
3. Intuit callback → GET /handy/api/qbo/oauth/callback?code=…&state=…&realmId=…
4. Server → POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer
      grant_type=authorization_code
      code=…
      redirect_uri=…
      Authorization: Basic base64(client_id:client_secret)
5. Persist { access_token, refresh_token, realmId, expires_at, refresh_expires_at } to handy_qbo_connections
6. Register webhook subscription (via Developer Dashboard, not API — done once per app)
```

**Refresh:** cron every 55 min (before 60-min expiry). If refresh fails → mark connection `status='expired'`, surface reconnect banner.

### 3.3 URLs (sandbox vs production)

| Env | Base URL |
|---|---|
| Sandbox | `https://sandbox-quickbooks.api.intuit.com/v3/company/<realmId>/…` |
| Production | `https://quickbooks.api.intuit.com/v3/company/<realmId>/…` |
| Token endpoint (both) | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` |

Toggle via `QBO_ENV=sandbox|production` env var; default sandbox so OSS clones don't accidentally hit prod.

### 3.4 Rate limits

Per [Coefficient](https://coefficient.io/quickbooks-api/quickbooks-api-rate-limits): **500 requests/min per realmId, 10 concurrent, batch = 40/min**. Read-heavy endpoints capped at 200/min. Handybusiness volume is far under this — but we still implement:

- Token-bucket queue in `services/qbo-client.js` (bucket = 400/min for safety)
- Exponential backoff on 429 (2s → 4s → 8s → give up + queue for cron retry)
- All writes go through a serial per-realm queue (avoids SyncToken collisions)

### 3.5 SyncToken conflict resolution

Every QBO entity has a `SyncToken` (integer version). On update we send the token we received. If QBO responds 400 "Stale Object Error," we:

1. Refetch the entity from QBO
2. Merge our local delta on top (customer name, phone — never overwrite QBO's chart-of-accounts assignments)
3. Retry once
4. On second failure → log to `handy_qbo_sync_errors` + notify owner via team inbox

### 3.6 Webhooks

Per Intuit docs, webhooks fire Create/Update/Delete on: `Customer, Invoice, Payment, Item, Estimate, TimeActivity, SalesReceipt, CreditMemo, RefundReceipt` — and 15 others we don't care about.

Endpoint: `POST /handy/api/qbo/webhook` (unauthenticated; validated by HMAC-SHA256 header `intuit-signature` against `QBO_WEBHOOK_VERIFIER_TOKEN`).

Handler pseudocode:

```
verify HMAC → 401 if bad
parse eventNotifications[] → for each realmId:
   look up handy_qbo_connections by realmId
   for each dataChangeEvent:
       enqueue { realmId, entity, id, operation, lastUpdated } into handy_qbo_sync_queue
respond 200 within 3 seconds (or QBO retries)
```

A cron drains the queue every 60s. Idempotency via `UNIQUE(realm_id, entity, entity_id, last_updated)`.

### 3.7 Schema additions (SQLite — additive only)

```sql
CREATE TABLE IF NOT EXISTS handy_qbo_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,               -- FK handy_users.id (owner)
  realm_id TEXT UNIQUE NOT NULL,          -- QBO company id
  access_token TEXT NOT NULL,             -- encrypted at rest (see §3.9)
  refresh_token TEXT NOT NULL,            -- encrypted
  access_expires_at TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'sandbox',  -- 'sandbox' | 'production'
  status TEXT NOT NULL DEFAULT 'active',        -- 'active' | 'expired' | 'revoked'
  connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_refreshed_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS handy_qbo_id_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  realm_id TEXT NOT NULL,
  entity TEXT NOT NULL,                   -- 'Customer' | 'Invoice' | 'Item' | 'Payment' | 'Estimate'
  local_table TEXT NOT NULL,              -- 'handy_customers' | 'handy_invoices' | …
  local_id INTEGER NOT NULL,
  qbo_id TEXT NOT NULL,
  sync_token TEXT NOT NULL DEFAULT '0',
  last_pushed_at TEXT,
  last_pulled_at TEXT,
  UNIQUE(realm_id, entity, local_id),
  UNIQUE(realm_id, entity, qbo_id)
);

CREATE TABLE IF NOT EXISTS handy_qbo_sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  realm_id TEXT NOT NULL,
  direction TEXT NOT NULL,                -- 'push' | 'pull'
  entity TEXT NOT NULL,
  entity_id TEXT,                         -- local id if push, qbo id if pull
  operation TEXT NOT NULL,                -- 'create' | 'update' | 'delete'
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'in_flight' | 'done' | 'failed'
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  UNIQUE(realm_id, entity, entity_id, operation, created_at)
);

CREATE TABLE IF NOT EXISTS handy_qbo_sync_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  realm_id TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  http_status INTEGER,
  error_code TEXT,
  error_message TEXT,
  request_payload TEXT,
  response_body TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add QBO id columns to existing tables (additive — safe)
ALTER TABLE handy_customers ADD COLUMN qbo_id TEXT;
ALTER TABLE handy_customers ADD COLUMN qbo_sync_token TEXT;
ALTER TABLE handy_invoices ADD COLUMN qbo_id TEXT;
ALTER TABLE handy_invoices ADD COLUMN qbo_sync_token TEXT;
ALTER TABLE handy_invoices ADD COLUMN qbo_last_synced_at TEXT;
```

### 3.8 Route surface

| Route | Purpose |
|---|---|
| `GET  /handy/api/qbo/status` | Connection state + last sync summary |
| `GET  /handy/api/qbo/oauth/start` | Redirect to Intuit consent |
| `GET  /handy/api/qbo/oauth/callback` | Handle code exchange |
| `POST /handy/api/qbo/disconnect` | Revoke + null tokens |
| `POST /handy/api/qbo/sync/all` | Force full push (owner button) |
| `POST /handy/api/qbo/sync/customer/:id` | Force single-customer push |
| `POST /handy/api/qbo/sync/invoice/:id` | Force single-invoice push |
| `POST /handy/api/qbo/webhook` | Intuit webhook receiver (HMAC-validated) |
| `GET  /handy/api/qbo/errors` | Last N errors for support |

### 3.9 Security notes

- **Token encryption at rest.** Use `crypto.createCipheriv('aes-256-gcm', deriveKey(SESSION_SECRET, 'qbo'), iv)`. Never store plaintext tokens. Roll on `SESSION_SECRET` change.
- **Webhook HMAC.** Reject anything without a valid `intuit-signature`. Log rejections.
- **CSRF on OAuth start.** `state` param must be a 32-byte random string persisted in session, verified on callback.
- **Realm scoping.** Every query must filter by `realm_id = ?` — never trust the URL param.
- **PII in errors.** Redact tokens + emails from `handy_qbo_sync_errors.response_body` before insert.

### 3.10 Backfill strategy

On first connect the owner sees a modal:

- [ ] Import all my QBO customers into Handybusiness *(default off — most Handybusiness installs already have customers)*
- [x] Push all my Handybusiness customers into QBO
- [x] Push all my Handybusiness invoices from the last 90 days into QBO
- [ ] Push older invoices too

The backfill runs as an async job — status polled via `/api/qbo/status`.

### 3.11 What QBO does that we defer

- Chart of accounts management → user does this in QBO
- Sales tax rules → QBO Automated Sales Tax handles it once mapped
- Deposits (bank deposits) → out of scope
- Journal entries → out of scope
- Vendor bill entry → out of scope

---

## 4. Other Booking-Software Integrations

**Sources:**
- [Jobber Calendar Syncing docs](https://help.getjobber.com/hc/en-us/articles/115009378687-Calendar-Syncing) (Jobber ships one-way ICS-based sync; range = 2 weeks past, 20 weeks forward)
- [Housecall Pro Google Calendar integration](https://help.housecallpro.com/) (reviews on G2 complain about latency + lack of true 2-way)
- [Software Advice: Google Calendar vs Housecall Pro comparison, 2026](https://www.softwareadvice.com/scheduling/google-calendar-profile/vs/housecall/)
- [G2: Calendly vs Housecall Pro, 2026](https://www.g2.com/compare/calendly-vs-housecall-pro)

### 4.1 What the leaders actually ship

| Vendor | Google Cal | Outlook | iCal feed | Calendly | Acuity | Style |
|---|---|---|---|---|---|---|
| Jobber | ✅ one-way (out) | ✅ one-way (out) | ✅ | ❌ | ❌ | ICS pull |
| Housecall Pro | ✅ two-way (limited) | ✅ two-way (limited) | ✅ | ⚠️ Zapier | ⚠️ Zapier | API push + webhook |
| ServiceTitan | ✅ two-way | ✅ two-way | ✅ | ⚠️ marketplace | ⚠️ marketplace | Direct OAuth |
| Service Fusion | ⚠️ one-way | ⚠️ one-way | ✅ | ❌ | ❌ | ICS export |

**Key insight:** two-way is universally *aspirational* — even the market leaders ship partial two-way. Handybusiness can ship **one-way push (job → external calendar) + one-way pull (external "busy" blocks → dispatcher UI)** and match the market.

### 4.2 Proposed Handybusiness integration design

Three tiers of sophistication, ship in order:

#### Tier A (M1): iCal feed export — 1 day of work

```
GET /handy/ical/user/:userToken.ics
```

Returns an ICS 2.0 feed of every `handy_jobs` row with `scheduled_at` for the given user. Token is a random 40-char string stored on `handy_users.ical_token`. Owner copies the URL into Google Calendar → Add other calendars → From URL. Google refreshes every ~12h; that's a known Google limitation, not ours.

**Pros:** zero external creds, works with Apple Calendar / Outlook / Google / Fantastical / Fastmail / literally everything.
**Cons:** slow refresh, no push.

#### Tier B (M2): Google Calendar OAuth — write jobs into user's calendar

- OAuth 2.0 with scope `https://www.googleapis.com/auth/calendar.events`
- On job create/update/delete → mirror to the user's designated Google Calendar (they pick a specific calendar ID in settings — usually a "Work" calendar, not primary)
- Store Google `eventId` in `handy_jobs.google_event_id`
- Webhook subscription (`watch` API) → when user edits *in* Google, we get notified within 30-60 sec → pull the event and update `scheduled_at` if the moved event has a matching id
- Detect user's non-Handybusiness events on the same calendar → surface as "busy" blocks on the dispatch board (read-only)

#### Tier C (M3): Outlook / Microsoft 365 — same pattern via Microsoft Graph

- Endpoint: `https://graph.microsoft.com/v1.0/me/calendar/events`
- Scope: `Calendars.ReadWrite`
- Webhooks via Microsoft Graph change notifications
- Same schema (`handy_jobs.outlook_event_id`)

#### Deferred: Calendly / Acuity

Both are **inbound-booking** tools (someone books time on you). Two paths:

1. **Zapier-friendly webhook receiver.** Publish `POST /handy/api/hooks/booking-inbound` accepting a normalized JSON (`{name, phone, email, when, duration, source}`) → creates a `handy_tickets` row + notifies dispatcher. Zapier/Make can transform Calendly and Acuity payloads into this format.
2. **Native integrations (post-M3).** Only worth building once M1-M3 land + user demand justifies it. Both have straightforward webhook APIs.

### 4.3 Schema additions

```sql
ALTER TABLE handy_users ADD COLUMN ical_token TEXT;                -- Tier A
ALTER TABLE handy_users ADD COLUMN google_oauth_json TEXT;         -- Tier B (encrypted)
ALTER TABLE handy_users ADD COLUMN google_calendar_id TEXT;        -- which calendar to write to
ALTER TABLE handy_users ADD COLUMN outlook_oauth_json TEXT;        -- Tier C (encrypted)
ALTER TABLE handy_users ADD COLUMN outlook_calendar_id TEXT;
ALTER TABLE handy_jobs  ADD COLUMN google_event_id TEXT;
ALTER TABLE handy_jobs  ADD COLUMN outlook_event_id TEXT;

CREATE TABLE IF NOT EXISTS handy_external_busy_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source TEXT NOT NULL,                   -- 'google' | 'outlook'
  external_event_id TEXT NOT NULL,
  title TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  is_all_day INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, external_event_id)
);
```

### 4.4 Route surface

| Route | Tier |
|---|---|
| `GET  /handy/ical/user/:token.ics` | A |
| `POST /handy/api/ical/regenerate-token` | A |
| `GET  /handy/api/google/oauth/start` | B |
| `GET  /handy/api/google/oauth/callback` | B |
| `POST /handy/api/google/disconnect` | B |
| `GET  /handy/api/google/calendars` | B (list available) |
| `POST /handy/api/google/select-calendar` | B |
| `POST /handy/api/google/webhook` | B |
| `GET  /handy/api/outlook/oauth/start` | C |
| `GET  /handy/api/outlook/oauth/callback` | C |
| `POST /handy/api/outlook/webhook` | C |
| `POST /handy/api/hooks/booking-inbound` | Deferred (Calendly/Acuity via Zapier) |

---

## 5. Employee Roles + Permissions Model

**Sources:**
- [Housecall Pro Team Member Roles & Permissions](https://help.housecallpro.com/en/articles/1073431-team-member-roles-permissions) — Admin / Office / Tech, per Housecall docs.
- [ServiceTitan Office employee permissions](https://help.servicetitan.com/v1/docs/explanation-of-office-employee-permissions-in-servicetitan) — role-driven with granular per-permission overrides.
- [McCary Group comparison, 2026](https://mccarygroup.com/jobber-vs-housecall-pro-vs-servicetitan-2026/) — ServiceTitan aimed at 20+ tech shops with multi-role workflows.

### 5.1 Current state

`handy_users.role TEXT DEFAULT 'owner'` — only two values used in practice: `'owner'` and `'assistant'`. Customers live in a separate table (`handy_customer_users`). There is no permission enforcement anywhere in the router — auth is binary (`handyAuth` middleware requires *any* logged-in `handy_users` row).

### 5.2 Design goal

Ship a **7-role model with granular per-permission overrides**, but ship it in a way that:

- (a) Existing single-owner installs continue to work with zero action.
- (b) The permission surface is 20-30 named permissions, not 200.
- (c) Roles are opinionated defaults, not immutable — supervisors can flip a permission on for one tech without inventing a new role.

### 5.3 Roles (defaults)

| Role | Typical user | Sees | Edits |
|---|---|---|---|
| **owner** | Business owner | Everything | Everything (including billing + integrations) |
| **manager** | Ops manager at a 5-10 tech shop | All jobs, all techs, reports | Jobs, invoices, customer records; NOT billing/integrations |
| **dispatcher** | CSR who books work | All jobs, all techs' schedules | Create/reassign jobs; talk to customers |
| **office_admin** | Office manager, part-time | Invoices + customers + reports | Invoices, customer records; NOT team management |
| **supervisor** | Lead tech overseeing 2-3 juniors | Own crew's jobs | Assign jobs within crew, approve timesheets |
| **field_tech** | Journeyman handyman | Only jobs assigned to them or their crew | Own timesheet, own job notes, own photos, mark job complete |
| **view_only** | Bookkeeper / auditor / spouse checking numbers | Read-only across configured scopes | Nothing |

Plus the pre-existing external role:

| Role | Sees | Edits |
|---|---|---|
| **portal_customer** (separate table) | Own tickets, own invoices, own booking | Own profile, submit tickets, book |

### 5.4 Permission catalog

Named permissions, 30 total. Organized by domain:

| Domain | Permission key | Description |
|---|---|---|
| customers | `customers.view.all` | See all customers |
| customers | `customers.view.assigned` | See only customers whose jobs I'm on |
| customers | `customers.create` | Add a new customer |
| customers | `customers.edit` | Edit any customer they can view |
| customers | `customers.delete` | Delete customer |
| customers | `customers.merge` | Merge duplicate customers |
| jobs | `jobs.view.all` | See all jobs |
| jobs | `jobs.view.own` | See own assigned jobs only |
| jobs | `jobs.view.crew` | See jobs for their crew |
| jobs | `jobs.create` | Book a new job |
| jobs | `jobs.assign` | Assign a job to a tech / vehicle |
| jobs | `jobs.reassign` | Reassign an existing job |
| jobs | `jobs.delete` | Delete job |
| jobs | `jobs.complete` | Mark job as complete |
| jobs | `jobs.edit_price` | Change hourly rate / price on a job |
| invoices | `invoices.view.all` | See all invoices |
| invoices | `invoices.view.own` | See invoices for own jobs |
| invoices | `invoices.create` | Generate an invoice |
| invoices | `invoices.send` | Actually send the invoice to the customer |
| invoices | `invoices.mark_paid` | Mark invoice paid |
| invoices | `invoices.void` | Void or refund |
| schedule | `schedule.view.all` | See full dispatch board |
| schedule | `schedule.view.own` | See own day only |
| team | `team.view` | See other users' names + roles |
| team | `team.manage` | Add/edit/deactivate users |
| team | `team.assign_permissions` | Grant/revoke per-user permissions |
| reports | `reports.view.summary` | Dashboard KPIs |
| reports | `reports.view.detailed` | Drill-down + export |
| settings | `settings.company` | Edit brand name, phone, rates |
| settings | `settings.integrations` | Connect/disconnect QBO, Google, etc. |

### 5.5 Default role → permission mapping

| Permission | owner | manager | dispatcher | office_admin | supervisor | field_tech | view_only |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| customers.view.all | ✅ | ✅ | ✅ | ✅ | | | ✅ |
| customers.view.assigned | | | | | ✅ | ✅ | |
| customers.create | ✅ | ✅ | ✅ | ✅ | ✅ | | |
| customers.edit | ✅ | ✅ | ✅ | ✅ | ✅ | | |
| customers.delete | ✅ | ✅ | | | | | |
| customers.merge | ✅ | ✅ | | | | | |
| jobs.view.all | ✅ | ✅ | ✅ | ✅ | | | ✅ |
| jobs.view.crew | | | | | ✅ | | |
| jobs.view.own | | | | | | ✅ | |
| jobs.create | ✅ | ✅ | ✅ | | ✅ | | |
| jobs.assign | ✅ | ✅ | ✅ | | ✅ | | |
| jobs.reassign | ✅ | ✅ | ✅ | | ✅ | | |
| jobs.delete | ✅ | ✅ | | | | | |
| jobs.complete | ✅ | ✅ | | | ✅ | ✅ | |
| jobs.edit_price | ✅ | ✅ | | | | | |
| invoices.view.all | ✅ | ✅ | | ✅ | | | ✅ |
| invoices.view.own | | | | | ✅ | ✅ | |
| invoices.create | ✅ | ✅ | | ✅ | ✅ | | |
| invoices.send | ✅ | ✅ | | ✅ | | | |
| invoices.mark_paid | ✅ | ✅ | | ✅ | | | |
| invoices.void | ✅ | ✅ | | | | | |
| schedule.view.all | ✅ | ✅ | ✅ | ✅ | | | ✅ |
| schedule.view.own | | | | | ✅ | ✅ | |
| team.view | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| team.manage | ✅ | ✅ | | | | | |
| team.assign_permissions | ✅ | | | | | | |
| reports.view.summary | ✅ | ✅ | ✅ | ✅ | | | ✅ |
| reports.view.detailed | ✅ | ✅ | | ✅ | | | ✅ |
| settings.company | ✅ | ✅ | | | | | |
| settings.integrations | ✅ | | | | | | |

### 5.6 SQL DDL (additive-only, SQLite)

```sql
-- Backfill existing single-owner installs: default role stays 'owner'
-- handy_users.role column already exists (line 205 of handy-router.js).
-- Add a supervisor pointer + is_active + crew hint.
ALTER TABLE handy_users ADD COLUMN supervisor_user_id INTEGER;   -- self-FK
ALTER TABLE handy_users ADD COLUMN is_active INTEGER DEFAULT 1;
ALTER TABLE handy_users ADD COLUMN hourly_cost_rate REAL;        -- what WE pay them (for job costing)
ALTER TABLE handy_users ADD COLUMN default_crew_id INTEGER;      -- FK handy_crews.id (nullable)

-- Named permissions catalog. Seeded on first boot with the 30 keys above.
CREATE TABLE IF NOT EXISTS handy_permissions (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  domain TEXT NOT NULL
);

-- Role defaults. Seeded with the 7 roles above.
CREATE TABLE IF NOT EXISTS handy_roles (
  key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  is_system INTEGER DEFAULT 1,          -- system roles can't be deleted
  sort_order INTEGER DEFAULT 100
);

-- Role → permission mapping.
CREATE TABLE IF NOT EXISTS handy_role_permissions (
  role_key TEXT NOT NULL REFERENCES handy_roles(key),
  permission_key TEXT NOT NULL REFERENCES handy_permissions(key),
  PRIMARY KEY (role_key, permission_key)
);

-- Per-user overrides. Grant OR revoke a single permission for a single user
-- without inventing a new role. This is the escape hatch.
CREATE TABLE IF NOT EXISTS handy_user_permission_overrides (
  user_id INTEGER NOT NULL,
  permission_key TEXT NOT NULL REFERENCES handy_permissions(key),
  effect TEXT NOT NULL CHECK (effect IN ('grant','revoke')),
  granted_by_user_id INTEGER,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, permission_key)
);

-- Crews. Every field_tech + supervisor can belong to one primary crew.
CREATE TABLE IF NOT EXISTS handy_crews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color_hex TEXT DEFAULT '#0a7',
  lead_user_id INTEGER,                 -- FK handy_users.id
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Users can belong to more than one crew (rare but real for a 3-tech shop).
CREATE TABLE IF NOT EXISTS handy_crew_members (
  crew_id INTEGER NOT NULL REFERENCES handy_crews(id),
  user_id INTEGER NOT NULL,
  role_in_crew TEXT DEFAULT 'member',   -- 'lead' | 'member'
  PRIMARY KEY (crew_id, user_id)
);

-- Audit log — mirrors what NobleDispatch has via system.audit_log.
CREATE TABLE IF NOT EXISTS handy_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,                 -- 'invoice.send', 'job.reassign', 'settings.qbo.disconnect'
  entity_type TEXT,                     -- 'invoice' | 'job' | 'customer'
  entity_id INTEGER,
  details_json TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_handy_audit_created ON handy_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_handy_audit_user ON handy_audit_log(user_id, created_at DESC);
```

### 5.7 Enforcement pattern

Introduce a permission middleware helper:

```js
function requirePerm(...perms) {
  return (req, res, next) => {
    const userId = req.session?.handy?.user_id;
    if (!userId) return res.status(401).json({ error: 'auth' });
    const user = db.prepare("SELECT * FROM handy_users WHERE id=? AND is_active=1").get(userId);
    if (!user) return res.status(401).json({ error: 'auth' });
    const held = getEffectivePermissions(user);          // role defaults + overrides
    for (const p of perms) if (!held.has(p)) return res.status(403).json({ error: 'perm', missing: p });
    req.perms = held;
    req.user = user;
    next();
  };
}
```

Then decorate existing routes:

```js
app.get("/handy/api/customers", handySession, handyAuth, requirePerm('customers.view.all'), …);
app.get("/handy/api/customers/mine", handySession, handyAuth, requirePerm('customers.view.assigned'), …);
```

**Backwards compat:** any user with `role='owner'` is treated as holding *all* permissions unconditionally — the migration effectively grandfathers existing installs.

### 5.8 5 realistic personas

| Persona | Real name (fictional) | Role | Overrides | Crew | Notes |
|---|---|---|---|---|---|
| **The solo owner** | Danny McKay (Tucson) | `owner` | — | none | The current handytucson.tech install. Zero migration pain. |
| **The owner + spouse-bookkeeper** | Danny + Sarah | `owner` + `view_only` (Sarah) | Sarah gets `reports.view.detailed` (default already) | none | Sarah logs in from the couch to see the A/R aging. |
| **Owner + assistant + 1 tech** | Danny + Aspen (CSR) + Miguel (tech) | `owner`, `dispatcher`, `field_tech` | Miguel: **grant** `customers.edit` (so he can update customer notes from the field) | Crew "Truck 1" led by Miguel | Current Handytucson trajectory. |
| **Growing 5-person shop** | 1 owner + 1 dispatcher + 1 office_admin + 2 field_techs | mixed | — | Truck 1 (tech A), Truck 2 (tech B) | This is where QBO + roles start printing money. |
| **Franchise mini-multi (10 people)** | 1 owner + 1 manager + 2 dispatchers + 1 office_admin + 1 supervisor + 4 field_techs | mixed | Manager: **revoke** `settings.integrations` (owner keeps that ONE) | 3 crews | Ceiling before we say "go buy ServiceTitan." |

### 5.9 UI surface

New nav item in owner dashboard: **Team** (visible if `team.view`).

- **Team → Members** — list users, click to edit role + overrides
- **Team → Crews** — list crews, drag members between crews
- **Team → Permissions matrix** — flat table of role × permission, click to override for a role (owner-only)
- **Team → Audit log** — filterable feed (owner + manager)

---

## 6. Multi-Resource Scheduling (Employee + Vehicle + Crew Calendars)

**Sources:**
- [Arrivy crew management, 2026](https://www.arrivy.com/blog/6-best-crew-management-software-for-field-teams/) — the "group workers + resources into crews, assign whole crew in one step" pattern
- [FieldPulse multi-team scheduling](https://www.fieldpulse.com/features/scheduling-and-dispatching)
- [Service Fusion drag-and-drop dispatch board, per Contractor ToolStack](https://contractortoolstack.com/software/service-fusion/)
- [NobleDispatch `calendarEvents` table](file:///opt/nobledispatch/lib/db/schema/app.ts) — Noble's existing pattern of `jobId + truckId + employeeId + startAt + endAt`

### 6.1 The core insight

Every job needs **1 time window + N resources**. Resources fall into three axes:

1. **People** (`handy_users` where role includes tech/supervisor)
2. **Vehicles** (new `handy_vehicles`)
3. **Crews** (grouping of both)

A job assignment is `(job, employee_id?, vehicle_id?, crew_id?, starts_at, ends_at)`. Assigning a crew is shorthand for "assign every current member + primary vehicle of that crew." At schedule-render time we always flatten to per-employee and per-vehicle blocks.

### 6.2 Schema

```sql
-- Vehicles (borrowed pattern from NobleDispatch trucks table, simplified)
CREATE TABLE IF NOT EXISTS handy_vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,               -- 'Truck 1', 'Van (blue)'
  vehicle_type TEXT DEFAULT 'truck',    -- 'truck' | 'van' | 'trailer' | 'other'
  color_hex TEXT DEFAULT '#3b82f6',
  license_plate TEXT,
  make TEXT,
  model TEXT,
  year INTEGER,
  vin TEXT,
  registration_expiry TEXT,
  insurance_expiry TEXT,
  odometer INTEGER,
  status TEXT DEFAULT 'available',      -- 'available' | 'in_use' | 'maintenance' | 'retired'
  home_base_lat REAL,                   -- morning start location
  home_base_lng REAL,
  primary_crew_id INTEGER,              -- FK handy_crews.id
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Rename semantics: handy_jobs.assigned_user_id is the primary owner of the job,
-- but a job can have multiple assignees (helper tech). Introduce a join table.
ALTER TABLE handy_jobs ADD COLUMN starts_at TEXT;     -- more precise than scheduled_at
ALTER TABLE handy_jobs ADD COLUMN ends_at TEXT;
ALTER TABLE handy_jobs ADD COLUMN assigned_user_id INTEGER;
ALTER TABLE handy_jobs ADD COLUMN assigned_vehicle_id INTEGER;
ALTER TABLE handy_jobs ADD COLUMN assigned_crew_id INTEGER;

CREATE TABLE IF NOT EXISTS handy_job_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES handy_jobs(id) ON DELETE CASCADE,
  user_id INTEGER,                      -- one of user_id or vehicle_id (or both) must be set
  vehicle_id INTEGER,
  role_on_job TEXT DEFAULT 'primary',   -- 'primary' | 'helper' | 'driver'
  starts_at TEXT,                       -- can override job-level window
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(job_id, user_id, vehicle_id, role_on_job)
);
CREATE INDEX IF NOT EXISTS idx_handy_job_assignments_user ON handy_job_assignments(user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_handy_job_assignments_vehicle ON handy_job_assignments(vehicle_id, starts_at);

-- Non-job time blocks: PTO, training, vehicle-in-shop, etc.
-- Prevents double-booking without pretending everything is a job.
CREATE TABLE IF NOT EXISTS handy_time_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  block_type TEXT NOT NULL,             -- 'pto' | 'training' | 'meeting' | 'vehicle_maintenance' | 'personal'
  user_id INTEGER,                      -- either user or vehicle (or both)
  vehicle_id INTEGER,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  all_day INTEGER DEFAULT 0,
  color_hex TEXT,
  notes TEXT,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_handy_time_blocks_user ON handy_time_blocks(user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_handy_time_blocks_vehicle ON handy_time_blocks(vehicle_id, starts_at);

-- Vehicle mileage log (from NobleDispatch job_time_entries pattern, simplified)
CREATE TABLE IF NOT EXISTS handy_vehicle_mileage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  job_id INTEGER,
  user_id INTEGER,
  entry_date TEXT NOT NULL,
  start_odometer INTEGER,
  end_odometer INTEGER,
  miles_driven REAL,
  purpose TEXT,                         -- 'job' | 'material_run' | 'transit'
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 6.3 API surface

| Route | Returns |
|---|---|
| `GET /handy/api/schedule?date=YYYY-MM-DD&view=day\|week&axis=user\|vehicle\|crew` | Normalized events + resources |
| `POST /handy/api/schedule/assign` | Body: `{ job_id, user_ids[], vehicle_id, crew_id, starts_at, ends_at }` |
| `POST /handy/api/schedule/reassign/:job_id` | Move a job to another resource/time |
| `POST /handy/api/time-blocks` | Create PTO / meeting / vehicle-out |
| `DELETE /handy/api/time-blocks/:id` | |
| `GET /handy/api/vehicles` | List |
| `POST /handy/api/vehicles` | CRUD |
| `PUT /handy/api/vehicles/:id` | |
| `DELETE /handy/api/vehicles/:id` | Soft-delete (status='retired') |
| `GET /handy/api/vehicles/:id/mileage-log` | For per-vehicle reports |

The `GET /handy/api/schedule` response shape:

```json
{
  "date_range": ["2026-08-25", "2026-08-31"],
  "resources": [
    {"id":"user:1","kind":"user","label":"Danny","color":"#000"},
    {"id":"user:2","kind":"user","label":"Miguel","color":"#e11"},
    {"id":"vehicle:1","kind":"vehicle","label":"Truck 1","color":"#3b82f6"},
    {"id":"crew:1","kind":"crew","label":"South-side crew","color":"#0a7"}
  ],
  "events": [
    {
      "id":"job:412",
      "type":"job",
      "title":"Fence repair — Alvarez",
      "resource_ids":["user:2","vehicle:1"],
      "starts_at":"2026-08-25T09:00:00Z",
      "ends_at":"2026-08-25T11:30:00Z",
      "color":"#e11",
      "customer_id":93,
      "address":"1234 W. Grant Rd",
      "status":"scheduled"
    },
    {
      "id":"block:22",
      "type":"time_block",
      "title":"Truck 1 — oil change",
      "resource_ids":["vehicle:1"],
      "starts_at":"2026-08-26T07:00:00Z",
      "ends_at":"2026-08-26T09:00:00Z",
      "color":"#666",
      "block_type":"vehicle_maintenance"
    }
  ]
}
```

### 6.4 UI/UX sketch

Three views (all read the same `GET /api/schedule` and pivot):

#### 6.4.1 Owner / dispatcher view (default) — resource-axis dispatch board

```
                Mon 25              Tue 26              Wed 27
              8  10  12  2  4    8  10  12  2  4    8  10  12  2  4
Danny        [Alvarez ]                [ Chen  ]  [ walk-in ][      ]
Miguel       [   Fence  ]      [   Reyes drain    ]        [    ]
Truck 1      [   Fence  ][oil-change]  [   Reyes drain    ]
Truck 2                        [Alvarez ]                [ Chen  ]
```

- **X axis:** time
- **Y axis:** switchable — `user`, `vehicle`, `crew`
- **Drag** a job block from one row to another → reassign
- **Drag** the edge → resize duration
- **Right-click** a job → context menu (edit, unassign, mark complete, message customer)
- **Color** = crew or status (toggle in header)
- **Gray blocks** = external calendar busy (from §4) — read-only, cannot be dragged over
- **Red overlap indicator** = double-booking warning (with per-vehicle overlap detection)

Implement in vanilla JS on `<canvas>` or with the lightweight [vis-timeline](https://github.com/visjs/vis-timeline) library — no framework build step, matches the existing zero-build ethos.

#### 6.4.2 Field-tech view — "my day"

```
Wed Aug 27 — 3 jobs, ~6.5 billable hours
────────────────────────────────────────────────
9:00 am   Reyes drain              [MAP] [CALL]
          1180 E. Grant Rd            (2 hrs)
          Notes: kitchen sink, bring the snake

11:30 am  drive → materials             (30 min)

12:00 pm  Alvarez fence patch          [MAP] [CALL]
          1234 W. Grant Rd            (2 hrs)

2:30 pm   Chen door hardware           [MAP] [CALL]
          8891 N. Oracle              (2.5 hrs)
```

- Only shows jobs where I'm on the assignment list.
- Big "I'm on my way" button per job → sends the customer a live-map SMS (needs Twilio/SignalWire).
- Tap to clock in / clock out — writes to `handy_hours`.

#### 6.4.3 Employee's personal calendar view

Same as 6.4.2 but week-scale. Read-only for the tech; supervisors can drop PTO / meeting blocks here.

### 6.5 Which pieces are new vs extend existing

| Existing today | Extension |
|---|---|
| `handy_jobs.scheduled_at` | Add `starts_at + ends_at + assigned_user_id + assigned_vehicle_id + assigned_crew_id` |
| `GET /api/schedule` returns owner's day | Add `?axis=` + `?view=` + multi-resource pivot |
| `GET /api/schedule/next` (mobile "what's next") | Filter to logged-in user's assignments |
| — | New tables: `handy_vehicles`, `handy_job_assignments`, `handy_time_blocks`, `handy_vehicle_mileage` |
| — | New routes: `/api/vehicles`, `/api/time-blocks`, `/api/schedule/assign` |

---

## 7. NobleDispatch Feature Merge

**Source:** direct read of `/opt/nobledispatch/` on `boston2`. Package = Next.js 14 + Drizzle ORM + Postgres + Better-Auth + Mapbox + BullMQ + Twilio + Resend + Stripe + Web-Push. Roughly 20 Drizzle tables across `system.*` (auth/tenants) + `app.*` (fleet). Notable admin pages: `/admin/calendar`, `/admin/fleet-map`, `/admin/employees`, `/admin/trucks`, `/admin/pay-periods`, `/admin/jobs`, `/admin/messages`, `/admin/documents`, `/admin/ai-parse`, `/admin/inbound`, `/admin/audit`. Driver surface: `/driver/job` + `/driver/emergency` API.

### 7.1 Feature-by-feature relevance rating

| # | NobleDispatch feature | Where it lives | Handybusiness relevance | How to port |
|---|---|---|---|---|
| 1 | **Trucks / vehicles table** with VIN, plate, reg-expiry, insurance-expiry, color, status | `app.trucks` | **High** | Ship `handy_vehicles` (§6.2) — near-identical shape, drop CDL-specific fields |
| 2 | **Employees table** with hire_date, pay_type, pay_rate, is_active | `app.employees` | **High** | Extend `handy_users` (§5.6) — already has `role`; add `hourly_cost_rate + is_active + hire_date` |
| 3 | **Job → assignedEmployee + assignedTruck** foreign keys | `app.jobs` | **High** | Direct port: `handy_jobs.assigned_user_id + assigned_vehicle_id` (§6.2) |
| 4 | **`calendarEvents` table** with `jobId + truckId + employeeId + startAt + endAt + eventType` | `app.calendar_events` | **High** | Port as `handy_time_blocks` (§6.2) — Handybusiness scoped to PTO/maintenance/personal, jobs live in `handy_jobs` |
| 5 | **`jobTimeEntries` table** with category + isBillable flag | `app.job_time_entries` | **High** | Extend existing `handy_hours` — add `category + is_billable + employee_id + starts_at + ends_at` columns; NobleDispatch pattern of per-tech time logging is exactly what a multi-tech handyman shop needs |
| 6 | **`employeePayPeriods` table** — hours + gross_pay + status | `app.employee_pay_periods` | **Medium** | Port as `handy_pay_periods`; solo owners won't use it, but 3+ employee shops will. Ship in M4 |
| 7 | **`documents` table** — filename + document_type + attached to job/employee/truck | `app.documents` | **Medium** | Handybusiness has `handy_photos + handy_agreements + handy_intake_leads` — merge into a unified `handy_documents` table with `document_type` (photo/agreement/receipt/insurance/registration) |
| 8 | **`inboundRequests` table** — parse an inbound load-board email into a Job draft | `app.inbound_requests` | **High** | Direct port: when a Handybusiness owner gets a lead email (Angi, Thumbtack, Yelp forward), parse via AI and stage as `handy_intake_leads` with parsed fields |
| 9 | **`chatSessions + chatMessages`** — live-chat widget for the customer-facing site | `app.chat_sessions` | **Medium** | Landing page live-chat is a solid extra; probably ship as a v2 module, not core |
| 10 | **`tenantSettings`** — brand name, colors, letterhead, dispatch hours | `app.tenant_settings` | **High** | The `theme-config-driven branding` item on the README roadmap — port the shape (jsonb → JSON TEXT in SQLite). Even non-multi-tenant Handybusiness benefits from a settings-driven brand |
| 11 | **`audit_log`** — action + entity + user + IP + user agent | `system.audit_log` | **High** | Ship as `handy_audit_log` (§5.6) |
| 12 | **Multi-tenant subdomain routing + `custom_domains` table** | `system.tenants + custom_domains` | **Skip** | Handybusiness is deliberately single-tenant per install. If a customer wants multi-tenant they self-host N containers. Do not import |
| 13 | **`superadmin/*` panel** — cross-tenant ops | `app/superadmin` | **Skip** | Same reason — single-tenant model |
| 14 | **Fleet map (Mapbox live positions)** at `/admin/fleet-map` | `app/admin/fleet-map/FleetMap.tsx` | **Medium** | Great feature but requires phones running the driver app continuously reporting location. Ship as optional M5 feature; use Google Maps (we already have the key) not Mapbox (extra dep) |
| 15 | **Driver surface** at `/driver/*` with big-touch job cards + emergency SOS | `app/driver` | **High** | Handybusiness already has a mobile-first quick-charge; port the "big-touch job card" + emergency-contact pattern for field techs. Use for §6.4.2 |
| 16 | **AI-parse a paste-in load** — Claude/Anthropic call to extract job fields from unstructured text | `app/admin/ai-parse` + `lib/ai/` | **High** | Handybusiness has Ollama for chat — reuse for `POST /api/leads/parse` that takes a pasted email/text and returns a filled-in `handy_intake_leads` row |
| 17 | **Job status advance state machine** (`/api/jobs/[id]/advance`) | `app/api/jobs/[id]/advance` | **Medium** | Handybusiness statuses today are ad-hoc strings. Formalize: `inbound → scheduled → dispatched → on_site → complete → invoiced → paid`. Add a single `POST /api/jobs/:id/advance` endpoint |
| 18 | **Real-time (`/api/realtime`) websocket bridge** for dispatch-board live updates | `app/api/realtime + lib/realtime` | **Medium** | Nice-to-have; polling every 15s is fine for 1-3 tech shops. Ship in a later phase if user request emerges |
| 19 | **Push notifications (`web-push`)** for driver alerts | `app/api/push + lib/push.ts` | **Low** | Deferred — SMS is faster to build and universally reachable |
| 20 | **Email templates (React Email + Resend)** | `emails/ + lib/email.ts` | **Low** | Handybusiness has Nodemailer stub; swap to Resend later if needed, but React Email is a heavy dep — skip |
| 21 | **PDF generation (@react-pdf/renderer)** for BOL/POD-style docs | `lib/pdf/` | **Low** | Handybusiness already ships `services/handy-pdf.js` (pdfkit) — no swap needed |
| 22 | **PayPeriod PDF export** for owner review | `app/admin/pay-periods/[id]` | **Medium** | Once `handy_pay_periods` exists in M4, add a print view |
| 23 | **`tts.ts` + `audio.ts`** — text-to-speech for driver alerts | `lib/` | **Skip** | Novel but low-utility for handyman; skip |
| 24 | **BullMQ background jobs + Redis** | `lib/` + package.json `bullmq + ioredis` | **Skip** | Handybusiness uses `node-cron` in-process — deliberately no Redis. Do NOT import BullMQ |
| 25 | **BetterAuth + OTP + 2FA** | `lib/auth/` + `otplib` | **Low** | Bcrypt + session-cookie is fine for handyman scale. If someone wants 2FA they can enable Cloudflare Access in front. Skip |
| 26 | **S3-compatible object storage for docs (`@aws-sdk/client-s3`)** | `lib/storage` | **Skip** | Handybusiness deliberately stores base64 in SQLite for single-container deploy. Do NOT import S3 |

### 7.2 High-relevance porting plan (7 items)

Ordered by dependency + effort:

| Port | Milestone | Effort |
|---|---|---|
| Trucks/vehicles table | M2 | Small |
| Employees table extensions + audit log | M2 | Small |
| Job → user/vehicle assignment + calendar_events pattern | M2 | Medium |
| jobTimeEntries → per-tech billable hours | M2 | Small |
| Inbound requests + AI-parse (Ollama) | M3 | Medium |
| Documents table unification | M3 | Small |
| Fleet map (optional Google Maps live view) | M5 | Medium |

### 7.3 What NOT to port (explicit rejects)

- **Postgres.** Drizzle-in-Postgres is beautiful for NobleDispatch's multi-tenant story; Handybusiness stays SQLite.
- **Multi-tenancy.** Every install = one shop.
- **Better-Auth + OTP.** Overkill.
- **BullMQ + Redis.** Cron is fine.
- **S3.** Base64 in SQLite is fine at handyman scale (a shop with 100 photos/mo hits ~50 MB/yr — nothing).
- **Mapbox subscription.** We have Google Maps.
- **React Email + Resend.** Nodemailer stub with SMTP hooks is fine.
- **`superadmin/*`.** Not applicable.

---

## 8. Roadmap Sequencing

Effort scale: **S** = 1-3 days · **M** = 1-2 weeks · **L** = 3-6 weeks.
Total elapsed if shipped in strict order by one engineer ≈ **4-5 months.** Chunks are individually shippable.

### M1 — "QBO + Calendar + Estimates" (revenue-unlocking) · ~6 weeks

| Deliverable | Effort |
|---|---|
| QBO OAuth + connection storage | M |
| QBO customer + invoice + payment push (from Handy → QBO) | M |
| QBO webhook receiver + pull (paid detection) | M |
| QBO sandbox test harness + reconnect flow | S |
| iCal feed export (Tier A of §4) | S |
| Estimate table + estimate → invoice conversion route | M |
| Deposit / progress-billing option on invoice edit page | M |
| Settings → Integrations UI panel | S |

**Exit criteria:** Danny can (a) connect his QBO, (b) send an estimate to a customer, (c) collect a 50% deposit, (d) mark job complete, (e) send final invoice, (f) see it appear in QBO within 60 sec.

### M2 — "Multi-employee + roles + vehicles" (scale-unlocking) · ~7 weeks

| Deliverable | Effort |
|---|---|
| Role catalog + permission catalog seed + role_permissions mapping | S |
| Per-user override table + effective-permissions helper | S |
| `requirePerm()` middleware + decorate all 97 existing routes | M |
| Team management UI (add/edit/deactivate user, assign role + overrides) | M |
| Crews table + crew management UI | S |
| Vehicles table + vehicles CRUD UI (from NobleDispatch trucks) | S |
| Extend `handy_jobs` with assignment columns + `handy_job_assignments` join | S |
| Refactor existing `/api/schedule` to be per-user (field_tech sees own only) | S |
| Audit log table + audit middleware + audit log viewer page | S |
| Google Calendar OAuth + one-way write (Tier B of §4) | M |

**Exit criteria:** Danny can invite Miguel as `field_tech`, assign a job to Miguel + Truck 1, Miguel logs in on his phone and sees only his day, timesheets flow into a per-employee summary, and the audit log records who reassigned what.

### M3 — "Dispatch board + inbound + AI-parse" · ~5 weeks

| Deliverable | Effort |
|---|---|
| Drag-and-drop resource-axis dispatch board (§6.4.1) | L |
| Time-blocks table + PTO / vehicle-maintenance UI | S |
| Outlook / Microsoft 365 OAuth (Tier C of §4) | M |
| Inbound requests table + `POST /api/leads/parse` (Ollama parses pasted lead emails) | M |
| Documents table unification (photos + agreements + receipts + insurance/reg) | S |

**Exit criteria:** dispatcher opens dispatch board, drags "Alvarez fence" from Danny to Miguel, and Miguel sees the change in his phone within 15 sec. Owner can paste an Angi email into the Leads inbox and get a pre-filled ticket.

### M4 — "Payments + Reports + Pay Periods" · ~5 weeks

| Deliverable | Effort |
|---|---|
| Stripe Payment Links integration (already README roadmap) | M |
| Square ACH integration (already README roadmap) | M |
| Chase QuickAccept payment-link integration (already README roadmap) | S |
| Recurring invoices (already README roadmap) | M |
| Reports page: A/R aging, revenue by month, revenue by customer, job profitability | M |
| CSV export on customers + invoices + jobs | S |
| Pay periods table + per-employee timesheet PDF export | M |

**Exit criteria:** owner sees at-a-glance A/R aging, exports last-quarter revenue to CSV, and closes a Miguel pay period with a signed PDF.

### M5 — "Live location + On-my-way + Fleet map" · ~4 weeks

| Deliverable | Effort |
|---|---|
| PWA install + offline mode (README roadmap) | M |
| "On my way" SMS button (customer gets live map link) | S |
| Field-tech clock-in/clock-out timer | S |
| Optional live-location beacon (opt-in per user) → new `handy_user_locations` table | M |
| Google Maps live fleet view for dispatcher | M |
| Vehicle mileage log + per-vehicle mileage report | S |

**Exit criteria:** customer texts "where are you?" and Miguel taps "On my way," customer immediately gets a live map. Dispatcher can see all in-progress trucks on one map.

### M6 — "Nice-to-haves + polish" · ~3 weeks

| Deliverable | Effort |
|---|---|
| Theme-config-driven branding (README roadmap) | S |
| Template designer UI for invoices (README roadmap) | M |
| Zapier-friendly `/api/hooks/booking-inbound` (Calendly/Acuity ingress) | S |
| Webhook egress table (fire on job/invoice events, for user Zapier flows) | S |
| Customer-side saved payment methods | M |
| Referral tracking + referral report | S |

---

## 9. Bundle + Backwards-Compat Risks

### 9.1 Schema-migration risks

All migrations are **additive-only** — new columns default NULL, new tables only referenced by new code. Danger points:

| Risk | Mitigation |
|---|---|
| A field_tech user logs in for the first time and sees `owner`-level access because their `role` column was NULL | Migration sets `handy_users.role = COALESCE(role, 'owner')` — but *only* if they're the *first* user. All subsequently-added users default to a safe role picked in the invite flow (never NULL) |
| Existing routes lose access when we add `requirePerm()` | Ship in two passes: (1) add `requirePerm()` but log-only for 1 week, (2) enforce. Owners with role='owner' bypass all checks |
| `handy_jobs.scheduled_at` renaming to `starts_at` breaks the current mobile view | Do NOT rename — add `starts_at + ends_at` alongside, backfill from `scheduled_at + duration_minutes`, and treat `scheduled_at` as read-only legacy |
| QBO push writes duplicate customers because our fuzzy-match is wrong | On first QBO connect, run a merge wizard: for each Handy customer, show the top-3 QBO candidates by name+phone and let the owner pick "same" or "different" |

### 9.2 Session / auth risks

- `handy.sid` cookie today has no role claims — it just holds `user_id`. That's fine; permissions get looked up per-request. **Do NOT put permissions in the session** — role or override changes must take effect immediately.
- The customer portal cookie (`handy_portal.sid`) is completely isolated — no impact.

### 9.3 Cron risks

New crons (QBO token refresh, QBO webhook queue drain, external calendar sync) all need:

- **Concurrency guard** — SQLite `BEGIN IMMEDIATE` around any state transition, or a simple in-memory `if (running) return`
- **Timeout kill** — no individual cron run should hold the DB > 30s
- **Env-off switch** — every new integration silently no-ops without creds (matches existing `.env` pattern)

### 9.4 Deploy risks

- **Docker image bloat.** New deps (googleapis, @microsoft/microsoft-graph-client) add ~40 MB uncompressed. Acceptable — one-container ethos preserved.
- **SQLite file growth.** Documents-in-DB approach means `.db` file will grow. Add a nightly cron reporting DB size in the dashboard; add a `VACUUM` weekly.
- **Better-sqlite3 native builds.** New dep additions must not break Alpine builds. Test the Dockerfile after each new dep.

### 9.5 Production handytucson.tech-specific

- **The `/handy/*` prefix strip via nginx `sub_filter`.** All new routes MUST live under `/handy/` — the strip already handles them. Do not introduce root-level routes.
- **PayPal is live** — the QBO Payments module must NOT double-record when a PayPal invoice is paid. Fix: `handy_invoices` gets a `payment_source` column; QBO only receives the payment once, tagged as the source that wrote it.
- **SignalWire numbers are live** — new SMS templates (on-my-way link, deposit request) must go through the existing `sms_opt_out` gate.
- **Ollama URL is optional** — AI-parse features must degrade gracefully to "paste + hand-edit" when `OLLAMA_URL` is unset.

### 9.6 Rollback plan

Any migration that adds a new table can be rolled back by dropping the table. Column additions cannot be dropped in SQLite without a full rebuild — mitigate by:

- Feature-flag every new column behind a `features_enabled_json` field on `handy_users` (per-user opt-in)
- If a feature ships broken, disable the flag; the column stays but nothing reads it

### 9.7 Testing strategy

Add a minimal integration harness (nothing shipped today):

```
tests/
  qbo-sync.spec.js      # spins up handybusiness + QBO sandbox, asserts push
  permissions.spec.js   # asserts a field_tech cannot see other techs' jobs
  schedule.spec.js      # asserts double-booking prevention
  cron-idempotency.spec.js  # runs each cron twice, asserts no duplicates
```

Use `better-sqlite3` in-memory (`new Database(':memory:')`) for speed. Wire into a `npm test` script + a GitHub Actions workflow.

---

## 10. Appendix — Confirmed source citations

Every claim about a competitor product traces to one of these:

- Service Fusion: [features hub](https://www.servicefusion.com/field-service-management-software), [QBO integration page](https://www.servicefusion.com/quickbooks-online-integration), [Killer Features PDF](https://www.servicefusion.com/wp-content/uploads/2023/05/ServiceFusion-Killer-Features.pdf), [Contractor ToolStack review 2026](https://contractortoolstack.com/software/service-fusion/), [FieldCamp review 2026](https://fieldcamp.ai/reviews/service-fusion/), [ServiceMag review 2026](https://www.servicemag.org/software/servicefusion), [FieldServiceTools review 2026](https://fieldservicetools.com/reviews/service-fusion/)
- Housecall Pro: [Team Member Roles & Permissions](https://help.housecallpro.com/en/articles/1073431-team-member-roles-permissions), [QBO Online sync docs](https://help.housecallpro.com/en/articles/6293215-quickbooks-online-syncing-information-from-housecall-pro), [G2 comparison 2026](https://www.g2.com/compare/calendly-vs-housecall-pro), [Software Advice 2026 Google Cal vs HCP](https://www.softwareadvice.com/scheduling/google-calendar-profile/vs/housecall/)
- Jobber: [Calendar Syncing docs](https://help.getjobber.com/hc/en-us/articles/115009378687-Calendar-Syncing), [New Schedule docs](https://help.getjobber.com/hc/en-us/articles/29840886387351-New-Schedule)
- ServiceTitan: [Office employee permissions](https://help.servicetitan.com/v1/docs/explanation-of-office-employee-permissions-in-servicetitan), [ServiceTitan vs HCP comparison](https://www.servicetitan.com/comparison/servicetitan-vs-housecall-pro), [McCary Group 2026](https://mccarygroup.com/jobber-vs-housecall-pro-vs-servicetitan-2026/)
- QuickBooks Online API: [Intuit Developer Portal](https://developer.intuit.com/app/developer/qbo/docs/get-started), [Truto 2026 guide](https://truto.one/blog/how-to-integrate-with-the-quickbooks-online-api-2026-guide/), [GetKnit 2026 guide](https://www.getknit.dev/blog/quickbooks-online-api-integration-guide-in-depth), [Satva 2026 API guide](https://satvasolutions.com/blog/quickbooks-online-api-guide), [Coefficient rate limits](https://coefficient.io/quickbooks-api/quickbooks-api-rate-limits), [Satva 2026 rate-limit deep dive](https://satvasolutions.com/blog/quickbooks-online-api-limitations-guide)
- Crew management + scheduling patterns: [Arrivy 2026 crew software round-up](https://www.arrivy.com/blog/6-best-crew-management-software-for-field-teams/), [FieldPulse scheduling features](https://www.fieldpulse.com/features/scheduling-and-dispatching), [Monday.com 2026 FSM comparison](https://monday.com/blog/service/field-service-scheduling-software/), [Workyard 2026 scheduling comparison](https://www.workyard.com/compare/field-service-scheduling-software)
- NobleDispatch: direct read of `/opt/nobledispatch/` on `boston2` — `lib/db/schema/app.ts`, `lib/db/schema/system.ts`, `app/admin/*`, `app/api/*`, `app/driver/*`, `package.json` (Aug 2026)
- Noble Handybusiness: direct read of `/root/github-presentation/noble-handybusiness/` — `handy-router.js` (2,921 LOC, 97 routes, 22 tables), `README.md`, `server.js`, `services/handy-pdf.js`

---

**End of gap analysis.** Total scope: **6 milestones, ~30 weeks of engineering effort**, delivered incrementally with additive-only migrations so handytucson.tech stays live throughout.
