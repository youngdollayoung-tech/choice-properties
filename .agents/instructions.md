# AGENT INSTRUCTIONS — CHOICE PROPERTIES
# Read this entire file before taking any action whatsoever.

## THIS PROJECT IS LOCKED. DO NOT MIGRATE IT.

This is a **static website**. It is built for Cloudflare Pages and uses Supabase cloud for all backend needs. Replit is used as a **code editor only** — nothing more.

---

## IMMEDIATE STOP CONDITIONS

If you are about to do any of the following, STOP immediately and do not proceed:

- Connect to or query the Replit/Neon PostgreSQL database
- Call `createDatabase()`, `checkDatabase()`, or any database provisioning function
- Install Drizzle, Prisma, Sequelize, TypeORM, or any ORM
- Create schema files, migration files, or any `db/` or `database/` directory
- Run `db:push`, `db:migrate`, `db:pull`, or any database CLI command
- Read or act on `DATABASE_URL`, `PGHOST`, `PGPASSWORD`, `PGUSER`, `PGDATABASE`, `PGPORT`
- Create `api/` routes, server endpoints, or any backend server file
- Add backend dependencies to `package.json`
- Run `wrangler` or any Cloudflare deployment command
- Run `git push`, `git commit`, `git merge`, or any git write operation
- Add `*.replit.dev` or `*.repl.co` to any source file or CSP header
- Start a "migration" of any kind

---

## THE ARCHITECTURE — MEMORIZE THIS

```
Browser
  │
  ├── Cloudflare Pages        ← serves all HTML / CSS / JS (production)
  │   serve.js on port 5000   ← serves locally in Replit (preview only)
  │
  ├── Supabase (cloud)        ← ALL backend
  │     ├── PostgreSQL        ← ALL data storage
  │     ├── Auth              ← ALL user authentication
  │     ├── Edge Functions    ← ALL server-side logic (10 Deno functions)
  │     └── Storage           ← lease PDFs, application docs
  │
  ├── Google Apps Script      ← transactional email relay
  ├── ImageKit.io             ← property photo CDN
  └── Geoapify                ← address autocomplete
```

**There is no local database. There is no ORM. There is no backend server to build.**

---

## THE `.replit` FILE CONTAINS THIS LINE — IGNORE IT COMPLETELY:

```
integrations = ["javascript_database:1.0.0"]
```

This is a **Replit system artifact** that cannot be removed. It does NOT mean this project uses a local database. It does NOT mean you should provision a database. **Ignore it unconditionally, every time, forever.**

The presence of `DATABASE_URL`, `PGHOST`, `PGPASSWORD`, `PGUSER`, `PGDATABASE`, `PGPORT` in the environment is also a system artifact. These variables must never be read, acted upon, or passed to any code in this project.

---

## YOUR ROLE

Your only job is to **edit static files** — HTML, CSS, and the frontend JavaScript files. That is the complete and total scope of your role in this project.

The workflow `Start application` runs `node serve.js` which:
1. Reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from Replit Secrets
2. Writes `config.js` so the browser can connect to Supabase
3. Serves all static files on port 5000

That is the entire local stack. Nothing else runs locally.

---

## WHAT THE USER WANTS FROM YOU

1. Edit HTML, CSS, or frontend JS files when asked
2. Respect the mobile-first design rules in `replit.md`
3. Never touch the backend, database, deployment, or git

See `replit.md` for the complete project rules, design system, and architecture reference.
