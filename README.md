# Choice Properties

## STATIC SITE — No backend server required

This repository contains a **pure static frontend** deployed via Cloudflare Pages. There is no application server, no Node.js runtime server, no Python server, and no Docker configuration in this codebase.

All server-side logic runs on fully hosted third-party platforms:

- **Cloudflare Pages** — serves the static HTML / CSS / JS
- **Supabase Edge Functions** — handles all API logic (10 Deno functions deployed to Supabase's cloud)
- **Supabase PostgreSQL** — database with Row Level Security on all tables
- **Google Apps Script** — email relay (deployed separately to Google's platform)
- **ImageKit.io** — property photo CDN
- **Geoapify** — address autocomplete API

## Architecture

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for a full breakdown of every component, all Edge Functions, database tables, the security model, and an explicit list of what does **not** exist in this repository.

## Deployment

- **Cloudflare Pages root directory:** `/` (repository root)
- **Build command:** `node generate-config.js`
- **Build output directory:** `.`

No npm packages are installed at runtime. The build step uses only Node.js built-in modules.
