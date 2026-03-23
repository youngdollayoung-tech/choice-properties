# Choice Properties — Replit Environment

---

## CRITICAL — READ THIS FIRST BEFORE TAKING ANY ACTION

**This project is a static website. Replit is used as a code editor and live preview only.**

| Fact | What it means |
|------|---------------|
| Deployment target | **Cloudflare Pages** — not Replit |
| Backend | **Supabase cloud** — not Replit, not Neon, not any local DB |
| Database | **Supabase PostgreSQL** (hosted) — no migration tool, no ORM |
| Replit's role | Code editor + live preview only |

### YOU MUST NEVER:
- Connect, configure, or use the Replit PostgreSQL / Neon database
- Run `db:push`, `db:migrate`, or any database command
- Install Drizzle, Prisma, Sequelize, or any ORM
- Create backend files (server routes, schema files, db config, api/ directories)
- Add backend packages to `package.json`
- Attempt to "set up the database environment" — the database runs on Supabase cloud
- Modify `serve.js`, `.replit`, or `generate-config.js` unless explicitly asked
- Touch any file in `supabase/functions/` unless explicitly asked

### `supabase/functions/` contains Deno code that runs on Supabase cloud — NOT on Replit.

---

## Project Overview

Choice Properties is a nationwide rental marketplace — a **static site** served by a lightweight Node.js file server (`serve.js`). All backend logic runs as **Supabase Edge Functions** hosted on Supabase cloud. There is no local database and no ORM.

---

## Database Setup (New Supabase Project)

**Run one file:**
```
SETUP.sql
```
Paste the entire file into Supabase → SQL Editor → New query → Run.

That is the only file needed. It includes the complete schema, all security patches, all RLS policies, all functions, views, storage configuration, and indexes. Do not run SCHEMA.sql, SECURITY-PATCHES.sql, APPLICANT-AUTH.sql, or phase4-patches.sql — those are legacy files kept for reference only.

After running SETUP.sql:
1. Enable Email OTP in Supabase → Authentication → Providers → Email
2. Add your admin: `INSERT INTO admin_roles (user_id, email) VALUES ('uid', 'email');`
3. Set Edge Function secrets (see SETUP.md for the full list)

See **SETUP.md** for the complete step-by-step new project guide.

---

## Architecture

- **Frontend**: Static HTML/CSS/JS files served from the project root
- **Server**: `serve.js` — Node.js HTTP server on port 5000 (Replit preview only)
- **Backend API**: Supabase Edge Functions (Deno, hosted on Supabase cloud)
- **Database**: Supabase Postgres (hosted on Supabase cloud)
- **Image CDN**: ImageKit
- **Email relay**: Google Apps Script (GAS) relay for transactional emails
- **Address autocomplete**: Geoapify

## How serve.js Works (Replit Preview Only)

On startup, `serve.js`:
1. Reads Replit environment secrets
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
| `serve.js` | Static file server + config.js generator (Replit preview only) |
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

## Environment Secrets (Replit Preview Only)

Set these in Replit's Secrets panel for the live preview to connect to Supabase:

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

**Supabase Edge Function secrets** (set in Supabase → Settings → Edge Functions, NOT in Replit):
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
| `get_apps_by_email(email)` | anon/auth | Returns app IDs for email recovery |
| `submit_tenant_reply(app_id, msg, name)` | anon/auth | Inserts a tenant reply message |
| `sign_lease(app_id, signature, ip)` | authenticated | Primary applicant lease signing (token verified by Edge Function) |
| `sign_lease_co_applicant(app_id, sig, ip)` | authenticated | Co-applicant signing |
| `mark_expired_leases()` | authenticated | Bulk-marks stale sent leases as expired |
| `generate_property_id()` | authenticated | Generates PROP-XXXXXXXX IDs server-side |

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
