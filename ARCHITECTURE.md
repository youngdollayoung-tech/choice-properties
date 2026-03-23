# Choice Properties — System Architecture

---

## ⛔ Rules for AI Agents — Mandatory

Read `.agents/instructions.md` immediately. Full rules are there.

**Short version — NEVER:**
- Use the Replit/Neon database (`DATABASE_URL`, any ORM, any DB migration command)
- Deploy to Cloudflare Pages (`wrangler`, CF CLI, or any deployment API)
- Run any git write operation (`git push`, `git commit`, `git merge`)
- Create backend files, server routes, or `api/` directories
- Add backend packages to `package.json`

**The `.replit` file contains `integrations = ["javascript_database:1.0.0"]` — this is a locked system artifact that cannot be removed. It does NOT mean this project uses a local database. Ignore it.**

**ONLY** edit static files (HTML, CSS, JS) locally. The user pushes to GitHub manually. Cloudflare Pages deploys automatically from there.

---

## Overview

Choice Properties is a **pure static frontend** connected to fully hosted backend services. There is no application server in this repository. Every component runs either in the browser or on a third-party hosted platform.

```
Browser
  │
  ├── Cloudflare Pages CDN  ← serves static HTML / CSS / JS
  │
  ├── Supabase              ← database, auth, realtime, storage
  │     ├── PostgreSQL (RLS enforced on all tables)
  │     ├── Supabase Auth (landlord + admin login)
  │     ├── Realtime (application status updates)
  │     ├── Storage (lease PDFs, application docs — private)
  │     └── Edge Functions (10 Deno functions — API layer)
  │
  ├── Google Apps Script    ← email relay (deployed separately)
  │
  ├── ImageKit.io           ← property photo CDN + transforms
  │
  └── Geoapify              ← address autocomplete API
```

---

## Component Breakdown

### Frontend — Cloudflare Pages

| Type | Details |
|---|---|
| Language | Vanilla JavaScript (ES6+), HTML5, CSS3 |
| Framework | None |
| Build step | `node generate-config.js` — injects env vars into `config.js` |
| Deployment | Cloudflare Pages (auto-deploy on push to `main`) |
| CDN | Cloudflare global CDN (automatic, no configuration needed) |
| Security headers | `_headers` file (X-Frame-Options, CSP, HSTS, etc.) |
| 404 handling | `_redirects` file (catch-all → `404.html`) |

The build step uses only Node.js built-in modules (`fs`, `process.env`). No npm packages are installed during the build.

---

### Backend API — Supabase Edge Functions

10 Deno-based Edge Functions deployed to Supabase's infrastructure:

| Function | Purpose | Auth required |
|---|---|---|
| `process-application` | Receive and store rental applications | Public (rate-limited) |
| `generate-lease` | Generate lease PDF and send signing link | Admin only |
| `sign-lease` | Process digital signatures | Token-based (no login) |
| `update-status` | Update application status | Admin / Landlord |
| `mark-paid` | Mark first month paid | Admin only |
| `mark-movein` | Confirm move-in | Admin only |
| `send-inquiry` | Send property inquiry to landlord | Public (rate-limited) |
| `send-message` | Send message in thread | Admin only |
| `imagekit-upload` | Authenticated photo upload to ImageKit | Authenticated user |
| `get-application-status` | Tenant status check by Application ID | Public (rate-limited) |

**Deployment:** `npx supabase functions deploy --project-ref YOUR_REF` (one-time; see SETUP.md → Step 7)

These functions are NOT part of this repository's local runtime. They run on Deno in Supabase's cloud and never execute locally.

---

### Database — Supabase PostgreSQL

| Table | Description |
|---|---|
| `properties` | Rental listings |
| `landlords` | Landlord profiles |
| `applications` | Tenant applications (SSN masked to last-4) |
| `messages` | Application thread messages |
| `inquiries` | Property inquiry submissions |
| `email_logs` | All email send attempts with status |
| `admin_roles` | Admin user registry |
| `saved_properties` | Tenant saved listings |

Row Level Security (RLS) is enabled on all tables. Schema is in `SCHEMA.sql`; security patches are in `SECURITY-PATCHES.sql`.

---

### Email — Google Apps Script Relay

A Google Apps Script Web App receives email requests from Supabase Edge Functions and sends them via Gmail. The script source is in `GAS-EMAIL-RELAY.gs` and must be manually deployed to Google's platform.

Secret verification (`RELAY_SECRET`) is enforced on every request. The GAS URL and secret live only in Supabase Edge Function secrets — never in the frontend.

---

### Image Storage — ImageKit.io

Property photos and landlord avatars are served through ImageKit's global CDN. Upload is handled by the `imagekit-upload` Edge Function (private key stays in Supabase secrets). The frontend receives CDN URLs and applies transform presets for different display sizes.

---

### Lease Storage — Supabase Storage

| Bucket | Access | Contents |
|---|---|---|
| `lease-pdfs` | Private | Signed lease HTML files |
| `application-docs` | Authenticated users only | Tenant-uploaded documents |

Signed URLs (7-day expiry) are generated on-demand by the `get-application-status` function. Files are never publicly accessible.

---

## Security Model

| Concern | Mechanism |
|---|---|
| Database access | RLS policies on every table; service role key server-side only |
| Admin auth | JWT verified server-side against `admin_roles` table |
| SSN data | Masked to last-4 on receipt; never stored full |
| Lease signing | 192-bit random tokens per lease; verified server-side |
| Email relay | HMAC secret verified on every request |
| Rate limiting | In-memory per-IP limits on all public Edge Functions |
| File access | All sensitive buckets private; signed URLs only |
| CORS | Edge Functions use `Access-Control-Allow-Origin: *` (public API) |
| Frontend config | `config.js` generated at build time; gitignored; no-cache headers |

---

## What Does NOT Exist In This Repository

| What you might expect | Reality |
|---|---|
| Express / Fastify / Koa server | None — no server at all |
| Node.js API routes | None — Supabase Edge Functions handle all server logic |
| Python Flask / Django | None |
| Local database | None — Supabase is the database |
| Redis / queue / workers | None |
| Docker / docker-compose | None |
| `.env` file with secrets | None — secrets live in Supabase and GAS dashboards |
| npm packages for runtime | None — `generate-config.js` uses only Node.js built-ins |

---

## Local Development

Any static file server works. No build pipeline is needed for local development.

```bash
# From the repository root:
python3 -m http.server 8080
# OR
npx serve .
```

Create a local `config.js` from `config.example.js` with your Supabase credentials. This file is gitignored.

---

## Data Flow — Tenant Submits Application

```
Browser → POST /functions/v1/process-application
            │
            ├── Rate limit check (in-memory, per IP)
            ├── Duplicate check (email + property)
            ├── INSERT into applications (SSN masked server-side)
            ├── INSERT into email_logs (pending)
            └── POST to GAS relay → Gmail sends confirmation email
                    │
                    └── email_logs updated to success/failed
```

---

## Deployment Checklist

- [ ] Supabase project created, `SCHEMA.sql` and `SECURITY-PATCHES.sql` run
- [ ] Supabase Edge Function secrets set (7 secrets — see SETUP.md)
- [ ] Google Apps Script deployed, URL added as `GAS_EMAIL_URL` secret
- [ ] Supabase Auth redirect URLs configured
- [ ] Cloudflare Pages project created, environment variables set
- [ ] Edge Functions deployed via `npx supabase functions deploy`
- [ ] Admin account created via SQL insert into `admin_roles`
- [ ] `health.html` checks passing on the live site
