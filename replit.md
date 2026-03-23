# Choice Properties — Replit Environment

---

## ⛔ MANDATORY RULES FOR ALL AI AGENTS — READ BEFORE ANYTHING ELSE

These rules are absolute. They apply to every session, every import, every task. No exceptions.

### This project is:
- A **static website** deployed to **Cloudflare Pages**
- Connected to **Supabase cloud** for all backend needs
- Using Replit **as a code editor only** — nothing more

### NEVER do any of the following:

**Database — NEVER:**
- Connect to or use the Replit/Neon PostgreSQL database
- Read or use `DATABASE_URL`, `PGHOST`, `PGPASSWORD`, `PGUSER`, `PGDATABASE`, `PGPORT`
- Run `db:push`, `db:migrate`, `db:pull`, or any database command
- Install Drizzle, Prisma, Sequelize, or any ORM
- Create schema files, migration files, or database config files
- The `.replit` file contains `integrations = ["javascript_database:1.0.0"]` — this is a system artifact that CANNOT be removed. It does NOT mean this project uses a local database. **Ignore it completely and unconditionally.**

**Deployment — NEVER:**
- Deploy to Cloudflare Pages
- Run `wrangler`, `wrangler pages deploy`, or any Cloudflare CLI command
- Use the Cloudflare API to trigger a deployment
- Deployment is always done manually by the user: they push to GitHub and Cloudflare Pages handles it

**Git — NEVER:**
- Run `git push`, `git commit`, `git merge`, `git rebase`, or any git write operation
- Create or merge pull requests automatically
- Your responsibility ends at editing files. The user handles all git operations.

**Backend — NEVER:**
- Create server routes, API endpoints, or backend server files
- Add backend packages to `package.json`
- Create an `api/` directory or backend directory structure
- Modify `serve.js` or `generate-config.js` unless the user explicitly asks
- Modify `supabase/functions/` unless the user explicitly asks

**Replit infrastructure — NEVER:**
- Add `*.replit.dev` or `*.repl.co` domains to any app source file, config, or CSP header
- Provision or configure any Replit-managed service as part of the app

**Authentication — NEVER (critical rule, read carefully):**
- Assume email confirmation is required or enabled for any user type
- Add email verification gates, confirmation screens, or "check your email" flows for landlords, agents, or admins
- Suggest enabling Supabase email confirmation for landlords, agents, or admins
- Add `emailRedirectTo`, OTP flows, or magic-link flows for landlord/admin sign-up or sign-in
- Treat `data.session === null` after `auth.signUp()` as a valid or expected landlord/admin state — if session is null after landlord signup, it is a bug, not a design choice

### ONLY do this:
Edit static files (HTML, CSS, JS) locally. That is the full scope of your role.

---

## ⚠️ AUTHENTICATION GROUND TRUTH — MANDATORY FOR ALL AI ACTIONS

This section defines the exact, current, enforced authentication model. Every code change, every suggestion, every review must be consistent with these rules. Do not deviate.

### Email Confirmation: DISABLED for all landlord and admin accounts

**Supabase Auth setting:** `Confirm email` is **OFF**.

This means:
- `supabase.auth.signUp()` for a landlord returns `{ user, session }` immediately — **session is always non-null on success**
- The landlord profile INSERT into `landlords` happens in the same call, in the same authenticated context
- There is no confirmation email step, no "check your inbox" screen, and no pending-confirmation state for landlords or admins
- If session is null after signUp, it is an error — surface it immediately, do not treat it as a normal flow

### Three distinct user types — never conflate them

| User Type | Auth Method | Email Confirmation | Session after signUp |
|-----------|-------------|-------------------|----------------------|
| **Landlord / Agent** | Email + Password | **DISABLED** | Immediate |
| **Admin** | Email + Password | **DISABLED** | Immediate (must also exist in `admin_roles`) |
| **Applicant / Tenant** | OTP (passwordless) | N/A — OTP is stateless | After OTP verify only |

### What this means for the RLS policies

The `landlords_own_write` policy is:
```sql
USING (user_id = auth.uid())
```
This works correctly because landlord signUp always returns a live session, so `auth.uid()` is never null at the time of the `landlords` INSERT.

### Future email confirmation

If email confirmation is ever re-enabled for landlords or admins, the `signUp()` flow in `js/cp-api.js` **must be restructured** — the landlord INSERT cannot happen at signUp time without a live session. This would require a Supabase Auth database trigger or a deferred insert on first login. Do not re-enable email confirmation without also addressing this architectural dependency.

### Applicant OTP is unaffected

Applicants (`/apply/`) use a completely separate passwordless OTP flow (`supabase.auth.signInWithOtp()`). This is unrelated to the landlord/admin email confirmation setting and must never be changed to email+password.

---

## Project Overview

Choice Properties is a nationwide rental marketplace — a **static site** served by a lightweight Node.js file server (`serve.js`). All backend logic runs as **Supabase Edge Functions** hosted on Supabase cloud. There is no local database and no ORM.

---

## How Changes Go Live

```
AI edits files locally in Replit
         ↓
User reviews changes
         ↓
User pushes to GitHub manually
         ↓
Cloudflare Pages auto-deploys
         ↓
Live site updates
```

The AI's job ends after step 1.

---

## Database Setup (New Supabase Project)

**Run one file:**
```
SETUP.sql
```
Paste the entire file into Supabase → SQL Editor → New query → Run.

That is the only file needed. It includes the complete schema, all security patches, all RLS policies, all functions, views, storage configuration, and indexes. Do not run SCHEMA.sql, SECURITY-PATCHES.sql, APPLICANT-AUTH.sql, or phase4-patches.sql — those are legacy files kept for reference only.

After running SETUP.sql:
1. **Disable email confirmation**: Supabase → Authentication → Providers → Email → toggle **"Confirm email" OFF**
2. **Enable Email OTP** (for applicants only): Supabase → Authentication → Providers → Email → enable OTP
3. Add your admin: `INSERT INTO admin_roles (user_id, email) VALUES ('uid', 'email');`
4. Set Edge Function secrets (see SETUP.md for the full list)

See **SETUP.md** for the complete step-by-step new project guide.

---

## Architecture

- **Frontend**: Static HTML/CSS/JS files served from the project root
- **Server**: `serve.js` — Node.js HTTP server on port 5000 (local preview only, not deployed)
- **Backend API**: Supabase Edge Functions (Deno, hosted on Supabase cloud)
- **Database**: Supabase Postgres (hosted on Supabase cloud)
- **Image CDN**: ImageKit
- **Email relay**: Google Apps Script (GAS) relay for transactional emails
- **Address autocomplete**: Geoapify

## How serve.js Works (Local Preview Only)

On startup, `serve.js`:
1. Reads environment secrets set in Replit
2. Regenerates `config.js` with those values so the browser has access to public keys
3. Starts the HTTP server on port 5000

In production, Cloudflare Pages runs `generate-config.js` as a build step and serves the static files globally.

## Workflow
- **"Start application"** runs `node serve.js` on port 5000

---

## Key Files

| File | Purpose |
|------|---------|
| `SETUP.sql` | **Single authoritative database setup** — run this for any new Supabase project |
| `SETUP.md` | Complete step-by-step new project setup guide |
| `serve.js` | Static file server + config.js generator (local preview only) |
| `config.js` | Auto-generated at startup from env secrets (do not edit manually) |
| `config.example.js` | Template showing all config fields with placeholder values |
| `generate-config.js` | Cloudflare Pages build-time config generator |
| `js/cp-api.js` | Shared Supabase API client used by all pages |
| `js/apply.js` | Rental application form logic |
| `js/imagekit.js` | ImageKit upload helper |
| `supabase/functions/` | Edge Function source (deployed to Supabase cloud, version-controlled here) |

### Legacy SQL Files (do not use for new projects)
| File | Status |
|------|--------|
| `SCHEMA.sql` | Superseded by SETUP.sql |
| `SECURITY-PATCHES.sql` | Superseded by SETUP.sql |
| `APPLICANT-AUTH.sql` | Superseded by SETUP.sql |
| `phase4-patches.sql` | Superseded by SETUP.sql |

---

## Environment Secrets (Local Preview Only)

Set these in Replit's Secrets panel so the local preview can connect to Supabase:

| Secret | Description |
|--------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase public anon key (safe for browser) |
| `IMAGEKIT_URL` | ImageKit URL endpoint |
| `IMAGEKIT_PUBLIC_KEY` | ImageKit public key |
| `GEOAPIFY_API_KEY` | Geoapify address autocomplete key |
| `COMPANY_NAME` | Display name (default: "Choice Properties") |
| `COMPANY_EMAIL` | Contact email |
| `COMPANY_PHONE` | Contact phone |
| `COMPANY_TAGLINE` | Tagline |
| `COMPANY_ADDRESS` | Business address |
| `ADMIN_EMAILS` | Comma-separated admin email list |
| `LEASE_DEFAULT_LATE_FEE_FLAT` | Default flat late fee (default: 50) |
| `LEASE_DEFAULT_LATE_FEE_DAILY` | Default daily late fee (default: 10) |
| `LEASE_DEFAULT_EXPIRY_DAYS` | Lease link expiry in days (default: 7) |
| `FEATURE_CO_APPLICANT` | Enable co-applicant (default: true) |
| `FEATURE_VEHICLE_INFO` | Enable vehicle info (default: true) |
| `FEATURE_DOCUMENT_UPLOAD` | Enable document upload (default: true) |
| `FEATURE_MESSAGING` | Enable messaging (default: true) |
| `FEATURE_REALTIME_UPDATES` | Enable realtime (default: true) |

**Supabase Edge Function secrets** (set in Supabase → Settings → Edge Functions, NOT here):
- `GAS_EMAIL_URL` — Google Apps Script email relay URL
- `GAS_RELAY_SECRET` — Secret token for GAS relay authentication
- `IMAGEKIT_PRIVATE_KEY` — ImageKit private key (never expose to browser)
- `DASHBOARD_URL` — Public site root URL (used to build signing links in emails)
- `ADMIN_EMAIL` — Admin notification email for process-application

---

## Pages

- `/` — Public listings homepage
- `/listings.html` — Browse & filter all properties
- `/property.html` — Individual property detail page
- `/apply.html` — Rental application form
- `/apply/dashboard.html` — Applicant status dashboard
- `/apply/lease.html` — Lease signing page
- `/admin/` — Admin dashboard (login, applications, listings, leases, messages)
- `/landlord/` — Landlord portal (dashboard, listings, applications, messages)

---

## Supabase Edge Functions

All deployed to Supabase cloud — not run locally:

| Function | Purpose |
|----------|---------|
| `process-application` | Receives application form, saves to DB, fires emails |
| `get-application-status` | Rate-limited status lookup for applicants |
| `generate-lease` | Admin-triggered lease generation with state compliance |
| `sign-lease` | Tenant/co-applicant signing, lease HTML generation, void action |
| `update-status` | Admin/landlord application status updates |
| `send-message` | Admin/landlord → tenant messaging |
| `send-inquiry` | Property inquiry emails + app-ID recovery |
| `mark-paid` | Mark application fee as paid |
| `mark-movein` | Record tenant move-in |
| `imagekit-upload` | Server-side ImageKit upload (keeps private key secure) |

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `admin_roles` | Tracks which Supabase Auth users have admin access |
| `landlords` | Landlord/property manager profiles |
| `properties` | Property listings |
| `inquiries` | Property inquiry messages from prospective tenants |
| `applications` | Rental applications (core table — all applicant + lease data) |
| `messages` | Admin/landlord ↔ tenant message threads |
| `email_logs` | Log of all transactional email sends |
| `saved_properties` | Tenant property saves (ownership-based RLS) |

## Key Database Functions (RPC)

| Function | Caller | Purpose |
|----------|--------|---------|
| `get_application_status(app_id)` | anon/auth | Returns applicant-safe status + messages |
| `get_lease_financials(app_id, last_name)` | anon/auth | Returns financial terms + sign token (last-name gated) |
| `get_my_applications()` | authenticated | Returns all apps linked to the current user |
| `claim_application(app_id, email)` | authenticated | Links legacy app to a Supabase Auth account |
| `get_apps_by_email(email)` | **authenticated only** | Returns app IDs for email recovery (restricted — PII) |
| `get_app_id_by_email(email)` | **authenticated only** | Returns most recent app_id for email (restricted — PII) |
| `submit_tenant_reply(app_id, msg, name)` | anon/auth | Inserts a tenant reply message |
| `sign_lease(app_id, signature, ip)` | authenticated | Primary applicant lease signing (token verified by Edge Function) |
| `sign_lease_co_applicant(app_id, sig, ip)` | authenticated | Co-applicant signing |
| `mark_expired_leases()` | admin or cron only | Bulk-marks stale sent leases as expired |
| `generate_property_id()` | authenticated | Generates PROP-XXXXXXXX IDs server-side |
| `generate_app_id()` | authenticated | Generates CP-YYYYMMDD-XXXXXXNNN IDs server-side |
| `increment_counter(table, id, col)` | anon/auth | Increments property view counts (properties.views_count only) |

---

## CSS Architecture

All styles split by concern and loaded in order:
- `css/main.css` — Design tokens, base resets, shared component library
- `css/mobile.css` — Responsive layer (loaded last everywhere)
- `css/listings.css` — Homepage hero, property grid, filters
- `css/property.css` — Gallery mosaic, lightbox, detail layout
- `css/apply.css` — Multi-step application form wizard
- `css/admin.css` — Dark-themed admin dashboard
- `css/landlord.css` — Landlord portal

## Property Detail Gallery System

- **Mosaic layout**: 3:2 grid (hero + 2×2 side panels) with LQIP blur-up
- **Responsive height**: `clamp(300px,48vw,660px)` → scales up to 2560px
- **Mobile**: single-column carousel with velocity-aware swipe, dot indicators
- **Lightbox**: fullscreen with LQIP, velocity-aware swipe, focus trap, keyboard nav, thumbnail filmstrip
- **Accessibility**: `aria-modal`, `aria-live` counter, focus trap, focus restoration on close
