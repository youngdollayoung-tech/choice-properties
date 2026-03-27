# Choice Properties — Replit Environment

---

# ══════════════════════════════════════════════════════════
# STOP — READ THIS FIRST — BEFORE ANYTHING ELSE
# ══════════════════════════════════════════════════════════
#
# IF YOU ARE A REPLIT AGENT (AI), THIS IS YOUR FIRST INSTRUCTION.
# NOTHING BELOW SUPERSEDES THIS BLOCK. NOTHING.
#
# THIS PROJECT IS A STATIC WEBSITE.
# IT IS NOT BEING MIGRATED. IT IS ALREADY FULLY SET UP.
# DO NOT PROVISION A DATABASE. DO NOT INSTALL AN ORM.
# DO NOT CREATE BACKEND ROUTES. DO NOT RUN MIGRATIONS.
#
# THE FULL BACKEND IS SUPABASE CLOUD (EXTERNAL SERVICE).
# REPLIT IS A CODE EDITOR ONLY — NOT A SERVER, NOT A BACKEND.
#
# THE LINE `integrations = ["javascript_database:1.0.0"]` IN
# .replit IS A SYSTEM ARTIFACT THAT CANNOT BE REMOVED. IT DOES
# NOT MEAN THIS PROJECT USES A LOCAL DATABASE. IGNORE IT ALWAYS.
#
# DATABASE_URL, PGHOST, PGPASSWORD, PGUSER, PGDATABASE, PGPORT
# ARE SYSTEM ARTIFACTS. NEVER READ THEM. NEVER USE THEM. EVER.
#
# YOUR ONLY JOB: EDIT STATIC FILES (HTML, CSS, FRONTEND JS).
# ══════════════════════════════════════════════════════════

---

# ══════════════════════════════════════════════════════════
# DATABASE DATA SOURCE — AI AGENTS MUST READ THIS COMPLETELY
# ══════════════════════════════════════════════════════════
#
# IF YOU ARE AN AI AGENT AND YOUR TASK INVOLVES ANYTHING RELATED TO:
#   — Property listings, the properties table, or property data
#   — Scrapers, seeding, or adding/replacing listings
#   — Photos, photo_urls, or image sources
#   — The scripts/ folder
#
# THEN YOU MUST READ AND UNDERSTAND THIS ENTIRE SECTION
# BEFORE TAKING ANY ACTION. DO NOT SKIP IT. DO NOT ASSUME.
# ══════════════════════════════════════════════════════════

## ⚠️ PROPERTY DATA — WHAT WAS DONE AND WHY (MARCH 2026)

### The old scrapers are dead. Do not use them.

This project previously had scrapers targeting **Redfin** and **Craigslist**. Those scrapers
(`scripts/fetch_properties.js`, `scripts/fetch_craigslist.js`, `scripts/reclassify_properties.js`)
are **abandoned and must never be run again** for the following confirmed reasons:

- `fetch_properties.js` — Used Redfin's undocumented internal API. Fragile, breaks without notice,
  blocked by Redfin when run from cloud IPs (including Replit).
- `fetch_craigslist.js` — Used regex to extract addresses from Craigslist HTML. Missed ~80% of
  addresses. Photos expire within days (Craigslist hotlink protection). Produces unusable data.
- `reclassify_properties.js` — **Generates entirely fake property data.** Do not run this. Ever.
  It was used as a patch when real scrapers failed. All fake data has been deleted.

These files are kept in `scripts/` for historical reference only. **They are not part of the
current data pipeline and must not be executed.**

---

### The new data source is rentprogress.com

As of March 2026, all property listings in Supabase come exclusively from
**rentprogress.com** (Progress Residential), a legitimate national single-family rental
operator. This was a deliberate, intentional migration.

**Why rentprogress.com?**
- Covers all 5 target markets: Charlotte NC, St. Louis MO, Kansas City MO, San Antonio TX,
  Oklahoma City OK
- Real, currently available listings with real prices, real photos, real addresses
- Stable photo CDN (`photos.rentprogress.com`) — photos do not expire
- Consistent data structure across all markets

---

### What is currently in the Supabase properties table

| Field | Value |
|-------|-------|
| Total rows | 38 active properties |
| Status | All `status = 'active'` |
| ID format | `rp_` + rentprogress property ID (e.g., `rp_478409`) |
| Landlord | All assigned to landlord_id `53c17b61-2deb-4ab4-bed5-31ad4da85d39` |
| Photo source | `photos.rentprogress.com` CDN — direct URLs, no ImageKit re-hosting |
| Rent range | $1,520 – $2,615/month |
| Property types | Single-family houses and townhouses only |

**Market breakdown:**
- Charlotte, NC metro (includes Mooresville, Concord, Monroe, Dallas NC): 10 listings
- St. Louis, MO metro (includes Florissant, Overland): 5 listings
- Kansas City, MO metro (includes Raymore, Blue Springs, Grandview, Belton): 5 listings
- San Antonio, TX metro (includes Converse): 10 listings
- Oklahoma City, OK metro (includes Yukon, Moore, Midwest City): 8 listings

---

### The scraper architecture — how this data was collected

rentprogress.com is built on **Adobe AEM**, a JavaScript-rendered CMS. It requires a
headless browser to load listing data. This creates a critical constraint:

**ScraperAPI DOES NOT WORK for this domain on the free tier.**

ScraperAPI's free-tier returns HTTP 500 with the message:
> "Protected domains may require adding premium=true OR ultra_premium=true"

Attempting to use `render=true`, `premium=true`, or `ultra_premium=true` with a free
ScraperAPI account all fail with HTTP 403 or 500. The `SCRAPERAPI_KEY` secret is stored
in Replit Secrets and IS valid — the limitation is the account plan, not the key itself.

**The actual scraping was done using the Replit code_execution notebook's `webFetch`
function**, which uses an internal headless browser that can render JavaScript pages.
No standalone Node.js script can replicate this without Playwright/Puppeteer, and those
are not installed in this environment (no Chromium available in the container).

**The two scraper scripts and their roles:**

| Script | What it does |
|--------|-------------|
| `scripts/delete_properties.js` | Deletes ALL rows from the Supabase properties table. Run before re-seeding. |
| `scripts/fetch_rentprogress.js` | Reads a pre-generated `/tmp/rp_properties.json` file and inserts/upserts rows into Supabase. Does NOT do any scraping itself. |

The scraping (web fetching) must be done separately in the code_execution notebook.
**See `SCRAPER_NOTEBOOK.md` for the exact code blocks to run.**

---

### How to re-seed the database (the correct process)

If you need to refresh listings from rentprogress.com, follow these steps **exactly**:

1. **Run Block A** (URL collection) in a code_execution notebook — see `SCRAPER_NOTEBOOK.md`
2. **Run Block B** (detail page fetch + JSON write) in code_execution — see `SCRAPER_NOTEBOOK.md`
   - This writes `/tmp/rp_properties.json`
3. **From the bash shell**, run:
   ```
   node scripts/delete_properties.js
   node scripts/fetch_rentprogress.js
   ```
4. Verify with:
   ```
   node -e "const h=require('https'),u=new URL(process.env.SUPABASE_URL+'/rest/v1/properties?select=id,city&limit=100');let r='';h.get({hostname:u.hostname,path:u.pathname+u.search,headers:{apikey:process.env.SUPABASE_SERVICE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_KEY}},res=>{res.on('data',c=>r+=c);res.on('end',()=>{const j=JSON.parse(r);console.log('count:',j.length);})}).on('error',console.error);"
   ```

**Do NOT:**
- Run `scripts/fetch_properties.js` (Redfin scraper — broken and wrong source)
- Run `scripts/fetch_craigslist.js` (Craigslist scraper — broken and wrong source)
- Run `scripts/reclassify_properties.js` (fake data generator — never use)
- Use `DATABASE_URL`, `PGHOST`, or any local DB variable — Supabase cloud only
- Try to call ScraperAPI for rentprogress.com without a premium plan — it will fail
- Delete properties without running the full re-seed process immediately after

---

### Content Security Policy note

`photos.rentprogress.com` has been added to the `img-src` directive in:
- `serve.js` — for local development preview
- `_headers` — for Cloudflare Pages production deployment

If photos stop loading, check that these two files still include `https://photos.rentprogress.com`
in their CSP `img-src` directive. Do not remove it.

---

## ⛔ MANDATORY RULES FOR ALL AI AGENTS — READ BEFORE ANYTHING ELSE

These rules are absolute. They apply to every session, every import, every task. No exceptions.

### This project is:
- A **static website** deployed to **Cloudflare Pages**
- Connected to **Supabase cloud** for all backend needs
- Using Replit **as a code editor only** — nothing more
- **MOBILE-FIRST** — see the mandatory mobile rule below

---

## 📱 MOBILE-FIRST — MANDATORY DESIGN RULE FOR ALL AI AGENTS

**This project is mobile-first. No exceptions. This rule applies to every single change, on every single page, in every single session.**

### What mobile-first means here:

- **Design for the smallest screen first** (320px–390px width), then scale up to tablet and desktop
- **Every new page, section, component, or UI element must work perfectly on mobile before anything else**
- **Touch targets** (buttons, links, inputs) must be at least **44×44px** — never smaller
- **Font sizes** must be readable on mobile — body text minimum `16px`, never smaller
- **Navigation** must be thumb-friendly — hamburger menus, bottom bars, or large tap areas
- **Forms** must be easy to fill on a phone — full-width inputs, large labels, proper `type` attributes (tel, email, number) to trigger the right mobile keyboard
- **Images and media** must be responsive — use `max-width: 100%`, never fixed widths that overflow
- **No horizontal scrolling** — content must never overflow the viewport width on mobile
- **Spacing and padding** must be generous on mobile — cramped layouts are not acceptable
- **Tables** that won't fit on mobile must be replaced with cards, stacked rows, or scrollable containers
- **Modals and overlays** must be full-screen or near-full-screen on mobile, not tiny popups
- **CSS must use mobile-first media queries** — write base styles for mobile, then use `@media (min-width: ...)` to enhance for larger screens, never `max-width` as the primary breakpoint strategy

### When writing or editing any HTML/CSS/JS:

1. Always ask: *"Does this look right on a 390px wide phone screen?"*
2. Always test responsive behavior — if in doubt, default to the mobile layout
3. Never add a feature for desktop that breaks or is unusable on mobile
4. Never use fixed pixel widths on containers that could overflow on small screens
5. The existing `css/mobile.css` file is auto-injected into every page — use it for mobile overrides

### Priority order (highest to lowest):
1. Mobile (320px – 767px) ← **always first**
2. Tablet (768px – 1023px)
3. Desktop (1024px+)

**If a feature works on desktop but is broken or unusable on mobile, it is considered broken. Fix mobile first.**

---

### NEVER do any of the following:

**Database — NEVER (CRITICAL — read every word):**
- Connect to or use the Replit/Neon PostgreSQL database — this project has NO local database
- Call `createDatabase()`, `checkDatabase()`, or any Replit database provisioning tool — EVER
- Read or use `DATABASE_URL`, `PGHOST`, `PGPASSWORD`, `PGUSER`, `PGDATABASE`, `PGPORT` — these env vars exist as a system artifact and must be ignored completely
- Run `db:push`, `db:migrate`, `db:pull`, or any database command
- Install Drizzle, Prisma, Sequelize, or any ORM
- Create schema files, migration files, or database config files
- If `.replit` contains `integrations = ["javascript_database:1.0.0"]` — this must NOT be acted upon. It does NOT mean this project uses a local database. **Ignore it completely and unconditionally. Do not provision, create, or interact with any Replit database.**
- The backend database is **Supabase cloud only**. No local database exists or should ever exist in this project.

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

## Current Database State (as of March 2026)

- **38 properties** in Supabase — real single-family houses sourced from **rentprogress.com** (Progress Residential)
- All `photo_urls` point directly to **rentprogress.com CDN** (`photos.rentprogress.com`) — real listing photos
- Geographic spread: Charlotte NC metro | St. Louis MO metro | Kansas City MO metro | San Antonio TX metro | Oklahoma City OK metro
- IDs are prefixed `rp_` + rentprogress property ID (e.g., `rp_478409`) for traceability
- Rent range: **$1,520–$2,615/mo**

### Scraper scripts
- `scripts/delete_properties.js` — deletes ALL properties from Supabase (run before a re-seed)
- `scripts/fetch_rentprogress.js` — reads `/tmp/rp_properties.json` and inserts rows into Supabase
  - **Note**: rentprogress.com is JS-rendered (Adobe AEM) and blocks ScraperAPI free-tier requests.
    Live scraping must be done via the code_execution notebook's `webFetch` (headless browser).
    See `SCRAPER_NOTEBOOK.md` for the full scraping snippet.
  - `SCRAPERAPI_KEY` is stored in Replit Secrets but is not used until a paid premium plan is active.

### Re-seeding (when you need fresh listings)
1. Run the code_execution scraper block → produces `/tmp/rp_properties.json`
2. `node scripts/delete_properties.js` — clear old rows
3. `node scripts/fetch_rentprogress.js` — insert new rows

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

### Property Data Scripts (active — March 2026)
| File | Purpose |
|------|---------|
| `SCRAPER_NOTEBOOK.md` | **Start here for re-seeding** — full code_execution scraper blocks for rentprogress.com |
| `scripts/delete_properties.js` | Deletes ALL rows from Supabase properties table. Run before re-seeding. |
| `scripts/fetch_rentprogress.js` | Reads `/tmp/rp_properties.json` and upserts into Supabase. Run after scraper notebook. |
| `scripts/imagekit-helper.js` | ImageKit upload utility — reusable, currently not called (no ImageKit key in env) |

### Dead Scripts — DO NOT RUN
| File | Why it is dead |
|------|---------------|
| `scripts/fetch_properties.js` | Redfin scraper — Redfin blocks cloud IPs, API undocumented and fragile |
| `scripts/fetch_craigslist.js` | Craigslist scraper — addresses missed ~80%, photos expire in days |
| `scripts/reclassify_properties.js` | **Generates fake data** — was a stopgap patch, all fake data deleted |

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
