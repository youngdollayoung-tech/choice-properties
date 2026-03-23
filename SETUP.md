# Choice Properties — Setup Guide

Do these steps in order. Don't skip any.

---

## Step 1 — Generate Your Relay Secret

Generate a random 48-character secret. You can use any password manager, or run `openssl rand -hex 24` in your terminal.

Save it somewhere safe. You'll paste it in two places — both must match exactly or emails won't send.

---

## Step 2 — Supabase Project

1. Go to **supabase.com** → create a new project
2. Once it loads, go to **SQL Editor → New query**
3. Paste the **entire contents of `SETUP.sql`** → click **Run** → wait for the success message
4. That's it — one file, one run. No additional patch files needed.

**Save these from Supabase → Project Settings → API:**
- Project URL (looks like `https://xxxx.supabase.co`)
- Anon public key (the `eyJ...` key labelled "anon public")

---

## Step 3 — Enable Email OTP in Supabase Auth

Supabase → **Authentication → Providers → Email:**
- Enable **OTP** (one-time code) — required for applicant login

Supabase → **Authentication → URL Configuration:**
- Site URL: `https://yourdomain.com`
- Redirect URLs — add both:
  - `https://yourdomain.com/landlord/login.html`
  - `https://yourdomain.com/admin/login.html`

---

## Step 4 — Supabase Edge Function Secrets

In Supabase → **Settings → Edge Functions → Environment Variables**, add these secrets:

| Secret Name | Value |
|---|---|
| `GAS_EMAIL_URL` | Your GAS Web App URL (you'll get this in Step 5) |
| `GAS_RELAY_SECRET` | Your relay secret from Step 1 |
| `IMAGEKIT_PRIVATE_KEY` | From ImageKit → Developer Options |
| `IMAGEKIT_URL_ENDPOINT` | From ImageKit → Developer Options |
| `ADMIN_EMAIL` | Your admin email address |
| `DASHBOARD_URL` | Your live site URL e.g. `https://yourdomain.com` |
| `FRONTEND_ORIGIN` | Same as DASHBOARD_URL |

> You can add ImageKit secrets later — everything else works without them.

---

## Step 5 — Google Apps Script Email Relay

1. Go to **script.google.com** → New project
2. Delete all default code, paste the entire contents of `GAS-EMAIL-RELAY.gs`
3. Click **Project Settings** (gear icon) → **Script Properties** → add these:

| Property | Value |
|---|---|
| `RELAY_SECRET` | Your relay secret from Step 1 — must be identical |
| `ADMIN_EMAILS` | Your admin email |
| `COMPANY_NAME` | Your business name |
| `COMPANY_EMAIL` | Your reply-to email |
| `COMPANY_PHONE` | Your phone number |
| `DASHBOARD_URL` | Your live site URL |

4. Click **Deploy → New deployment**
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the Web App URL → go back to Step 4 and add it as `GAS_EMAIL_URL`

> Future updates: always use **Deploy → Manage deployments → Edit (pencil)** — never create a new deployment or you'll get a new URL and break everything.

---

## Step 6 — Cloudflare Pages Frontend Deploy

1. Go to **dash.cloudflare.com** → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. Connect your GitHub account and select your repository
3. Under **Set up builds and deployments**:
   - **Framework preset**: None
   - **Root directory**: `/` *(repository root)*
   - **Build command**: `node generate-config.js`
   - **Build output directory**: `.`
4. Under **Environment variables**, add:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Your Supabase anon public key |
| `IMAGEKIT_URL` | `https://ik.imagekit.io/your-id` |
| `IMAGEKIT_PUBLIC_KEY` | Your ImageKit public key |
| `GEOAPIFY_API_KEY` | Your Geoapify API key (address autocomplete) |
| `COMPANY_NAME` | Your business name |
| `COMPANY_EMAIL` | Your business email |
| `COMPANY_PHONE` | Your phone number |
| `COMPANY_ADDRESS` | Your business address |
| `ADMIN_EMAILS` | Your admin email |

5. Click **Save and Deploy**

From now on: every push to `main` → Cloudflare Pages auto-redeploys the frontend.

> **Custom domain**: Cloudflare Pages → your project → **Custom domains** → Add domain. SSL is automatic.

---

## Step 7 — Deploy Edge Functions (One Time)

1. Open your terminal and navigate to your project folder
2. Log in to Supabase CLI:
```
npx supabase login
```
3. Deploy all functions (replace `YOUR_PROJECT_REF` with your Reference ID from Supabase → Project Settings → General):
```
npx supabase functions deploy --project-ref YOUR_PROJECT_REF
```
4. Go to **Supabase → Edge Functions** — you should see all functions listed and active

Only repeat this step if you edit the function code.

---

## Step 8 — Create Your Admin Account

1. Register an account on your live site (any method)
2. Supabase → **Authentication → Users** → find your email → copy your **User UID**
3. Supabase → **SQL Editor → New query** → run:

```sql
INSERT INTO admin_roles (user_id, email)
VALUES ('your-user-uid-here', 'your@email.com');
```

4. Sign out and back in — you now have access to `/admin/dashboard.html`

---

## When You Change Domains

Update all of these — missing even one breaks something:

- Supabase Secrets: `DASHBOARD_URL` and `FRONTEND_ORIGIN`
- GAS Script Properties: `DASHBOARD_URL`
- Supabase → Authentication → URL Configuration: Site URL and both Redirect URLs
- Cloudflare Pages → your project → Custom domains (if applicable)

---

## Troubleshooting

**Emails not sending / email_logs shows `failed`**
→ Supabase → Edge Functions → click the function → Logs tab for the exact error
→ Most common: `GAS_EMAIL_URL` secret is wrong or GAS not deployed yet
→ Verify `GAS_RELAY_SECRET` matches `RELAY_SECRET` in GAS Script Properties exactly

**Site loads but shows errors / CONFIG not defined**
→ Environment variables not set in Cloudflare Pages → Settings → Environment variables
→ Trigger a redeploy: Cloudflare Pages → your project → Deployments → Retry deployment

**Address autocomplete not working**
→ `GEOAPIFY_API_KEY` not set — add it in Cloudflare Pages environment variables and redeploy

**Admin login redirects incorrectly after domain change**
→ Update redirect URLs in Supabase → Authentication → URL Configuration

**Lease signing link is broken**
→ `DASHBOARD_URL` in Supabase secrets is pointing to the old domain — update it

**Images not loading**
→ `IMAGEKIT_URL` environment variable is wrong or not set

---

*Choice Properties · Your trust is our standard.*
