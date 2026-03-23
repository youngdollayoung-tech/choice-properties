# Changelog — Choice Properties

All notable changes to this project are documented here.
Every task, fix, or update must add an entry. Most recent changes appear first.

## [2026-03-17] — Tenant Dashboard: Auth Gate, Move-In Callout, Empty Reply Guard

- **Auth gate on reply area (`apply/dashboard.html`):** Unauthenticated users who look up an application by App ID now see a "Sign in to send a message" prompt instead of the reply textarea. Previously, anyone knowing an App ID could call `submit_tenant_reply` as that tenant without being signed in. The compose area only renders when `currentUser` is set.
- **Move-in coordination callout (`apply/dashboard.html`):** When a lease is fully signed (`signed` or `co_signed`) and `move_in_status` is not yet `completed`, a new blue "Next Step: Move-In Coordination" callout appears below the tenancy confirmation. It shows the total move-in amount (from `move_in_costs` if available, or a generic description) and the lease start date, so tenants know what to expect before the team reaches out.
- **Empty reply guard (`apply/dashboard.html`):** The Send button now starts disabled and only enables when the textarea contains non-whitespace content (`oninput` event). The existing early-return guard in the click handler remains as a second layer of defence.

## [2026-03-15] — Admin Dashboard Polish (6 Small Fixes)

- **Favicon** added to all 9 admin pages — `assets/favicon.svg` is now linked in every `<head>`, eliminating the 404 console error and showing the correct browser tab icon.
- **Login form wrapper** — email/password inputs and sign-in button are now inside a proper `<form onsubmit>` element, fixing the browser warning and enabling browser password-manager autofill/save.
- **Forgot password link** added to admin login — typing your email then clicking "Forgot password?" sends a Supabase password-reset email and shows a green success message inline. Error cases surface normally in the red error box.
- **Admin name "Loading…" default** added to 7 pages (Applications, Email Logs, Landlords, Leases, Listings, Messages, Move-Ins) — previously blank on initial render, now consistent with the dashboard's "Loading…" placeholder.
- **Table loading rows** added to Leases, Listings, Move-Ins, and Email Logs `<tbody>` elements, and a loading indicator to the Messages threads container — pages no longer show an empty table body while data is being fetched.
- **Hardcoded colour removed** from admin Listings page — listing title links now use `var(--gold)` instead of a literal `#2563eb` hex value, keeping the design token system intact.

## [2026-03-15] — Fix Admin & Landlord Dashboard Login (ES Module Scoping)

- **Root cause fixed:** `cp-api.js` uses ES module `export` statements. When loaded as a classic `<script>`, browsers throw a SyntaxError and `window.CP` is never defined, silently breaking all admin/landlord pages.
- **Fix — all 9 admin pages:** `cp-api.js` tag changed to `type="module"`. Inline data scripts reverted from `type="module"` back to classic `<script>` and their init IIFEs wrapped in `document.addEventListener('DOMContentLoaded', ...)`, which fires *after* module scripts — guaranteeing `window.CP` is set before any page logic runs.
- **`onclick` handlers preserved:** Because all page functions (`login`, `applyFilter`, `openModal`, `sendReply`, `toggleVerify`, `voidLease`, `changeStatus`, `submitStatus`, `submitLease`, `submitMessage`, `closeModal`, `openLeaseModal`, `markPaid`, `toggleDetail`, `clearFilters`, `submit`, `openMsgModal`) are defined at the top level of classic scripts, they remain on `window` and are reachable by HTML `onclick="..."` attributes and dynamically-generated button HTML.
- **Landlord pages unaffected:** Their inline scripts already used `type="module"` with explicit `import` statements; no change needed.

## [2026-03-15] — Gallery, Lightbox & Card UX Upgrade (Zillow-parity)

- **Gallery mosaic:** Height raised 480px → 560px (1024px+), side panel changed from 1-column × 2-row to a proper 2×2 grid showing all 4 thumbnails (indices 1–4). Added gradient overlays on main image and hover image-zoom on all panels. "See all photos" button now shows a live photo count badge and uses a cleaner pill design with backdrop blur. All class/ID names preserved for JS compatibility.
- **Lightbox redesign:** Completely restructured from a flat single-image overlay to a three-zone layout: (1) header bar with pill counter + close button, (2) main image stage with larger nav arrows and a smooth fade transition (`transitioning` class toggles opacity + scale), (3) scrollable thumbnail filmstrip at bottom — thumbnails highlight the active index, auto-scroll to keep it visible, and are clickable. Added swipe support for mobile lightbox. Thumbnail strip is built lazily on first `openLightbox()` call for performance.
- **Property cards:** Image aspect ratio changed from 63% → 60% padding-top for a wider, more cinematic crop. Hover shadow upgraded with a third layer and a subtle border-color shift for added polish.
- **Meta row (property.html):** Updated to use icon+text two-line structure — each meta item now shows a brand-blue icon badge on the left and label/value stacked on the right, matching the Zillow detail style.
- **Version bump:** `property.css?v=3` → `v=4` in `property.html`; `listings.css?v=3` → `v=4` in `index.html` and `landlord/profile.html` (was v=2 there).

## [2026-03-14] — Strengthened AI Rules in replit.md

- **Deployment chain rules:** Added a mandatory top-level warning explaining that Replit is a code editor only, the live site runs on Cloudflare Pages via GitHub, and changes must be pushed to GitHub to go live. Includes the exact push steps.
- **CSS cache-busting rule:** Added a mandatory rule requiring any AI that changes a CSS file to bump the `?v=` version string in every HTML file across the project. Current versions documented (`v=3`).
- **Cloudflare Pages compatibility:** Added a ✅/❌ list of what is and isn't allowed on a static CDN — no Node.js runtime, no `process.env`, no server-side code.
- **Preview vs. live table:** Added side-by-side table distinguishing the Replit preview (`serve.js` on port 5000) from the live Cloudflare site.
- **Design system rules:** Always use CSS tokens; never hardcode hex or pixel values; do not invent new background colors.
- **JavaScript rules:** Vanilla JS only; no ES modules, no frameworks, no bundler; no `process.env`; no new CDN scripts without approval; all Supabase calls through `cp-api.js`.
- **Image rules:** All property images via ImageKit CDN using `CONFIG.img()`; no raw Supabase storage URLs.
- **Page structure rules:** New pages must copy nav/footer from `index.html`; admin/landlord/apply portals are isolated; kebab-case filenames.

Format:
**[YYYY-MM-DD] — Short title**
- What changed and why

---

## [2026-03-13] — Design Enhancement Phase: Cards, Gallery Mosaic & Animations

- **T001 — Card image & hover overhaul (`css/listings.css`):** Image area raised from 52% → 63% padding-top for a more cinematic, taller card image. Hover effect changed from jarring blue-border flash to a smooth shadow bloom (translateY -4px + deeper shadow, border stays neutral). Photo count badge moved to bottom-left with solid dark background and higher contrast. Save button enlarged from 32px → 36px.
- **T002 — Card body hierarchy (`css/listings.css` + `index.html`):** Price raised from 24px → 28px, weight 700 → 800 so it dominates the card. Meta row (bed/bath/sqft) now uses a single top border and dot separators instead of double borders with wide gaps. Apply button label changed to "Apply Now", slightly more padding. Card images now fade in via `onload="this.classList.add('cp-img-loaded')"` instead of popping in blank.
- **T003 — Staggered card entrance animation (`css/listings.css` + `index.html`):** Replaced the static CSS nth-child animation approach with an `IntersectionObserver`-driven stagger: cards start at opacity 0 / translateY 20px and animate in with a 55ms per-card delay (capped at 320ms) as they enter the viewport. `animateCards()` is called at the end of `renderProperties()`. Skeleton cards are excluded via `!important` overrides. Respects `prefers-reduced-motion`.
- **T004 — Gallery mosaic layout (`property.html` + `css/property.css`):** Replaced the flat single-image + thumbnail strip gallery with an Airbnb-style 3:2 mosaic grid — large main panel on the left, 2×2 sub-panel grid on the right. Clicking any panel opens the existing lightbox at that photo index. "See all photos" button is positioned absolute bottom-right in a clean white pill. If a property has 1 photo, side grid is hidden and main takes full width. If there are 5+ photos, the last panel shows a "+N more" overlay. Mobile collapses to single-image with nav arrows and a swipe counter. All existing lightbox JS (keyboard nav, counter, close, touch swipe) is 100% intact. `id="gallery"` preserved for the `renderUnavailable` path.
- **T005 — Filter active count badge (`index.html` + `css/listings.css`):** Added `updateFilterBadge()` function called by `refreshResults()`. A small blue pill badge appears inside the "More Filters" button showing the number of active non-default filters (type, beds, max/min rent, min baths, search). Hides when all filters are cleared.
- **T006 — Nav scroll polish (`css/main.css`):** `.nav.scrolled` now transitions background to `rgba(255,255,255,0.99)` (from 0.97) with a stronger layered shadow. Nav transition extended to cover both `box-shadow` and `background` for a crisp, intentional feel on scroll.

## [2026-03-13] — Properties Display & Rendering Fixes

- **Bug fix — Sort "Most Beds" now works (`index.html`):** The `beds_desc` sort branch was missing from `applyFilters()`, causing the "Most Beds" dropdown option to silently fall through to "Newest". Added `if (sortBy === 'beds_desc') return (b.bedrooms ?? 0) - (a.bedrooms ?? 0)` to the sort chain.
- **Bug fix — Empty-state filter screen color tokens (`index.html`):** The "No listings match your filters" empty state used unmapped legacy tokens `--slate-light`, `--slate`, and `--blue` which don't exist in the design system. Replaced with `--color-text-muted`, `--color-text-secondary`, and `--color-brand` respectively. The icon and text now render with correct muted colors instead of black.
- **Bug fix — Full property card is now clickable (`index.html`):** Cards had a hover-lift effect and `cursor:pointer` suggesting the whole card is a link, but only the photo and title were `<a>` elements. Added a click listener to each `.property-card` that navigates to the property detail page whenever the click target is not already a button or link (save button, nav arrows, apply button retain their own behavior).
- **UX — Active Listings stat hidden on load failure (`index.html`):** When Supabase is unreachable the stat counter stayed as `—` forever, looking broken. On error, the entire stat item is now hidden so the hero stats row shows only the two static items (Avg. Apply Time and Coverage).
- **UX — Contact card Save/Share buttons repositioned (`property.html`):** The Save and Share buttons were displayed below the "Questions? Message the Landlord" heading, creating a confusing layout where the heading didn't match the first visible content. The `share-row` is now rendered above the heading so save/share quick actions appear first, followed by the message form with its own label.
- **UX — Description loading state uses skeleton shimmer (`property.html`):** The description area on the property detail page initialized with a bare "Loading property details…" text string while all other loading areas on the page use animated skeleton shimmer placeholders. Replaced with four skeleton lines matching the body text height and staggered widths, consistent with the rest of the page.

---

## [2026-03-13] — Security Hardening: claim_application() email verification

- **`APPLICANT-AUTH.sql` — `claim_application()` RPC hardened:** The email verification in the function now uses `auth.email()` (the server-side JWT-verified email for the authenticated caller) instead of the client-supplied `p_email` parameter. This closes a theoretical attack vector where a malicious authenticated user who knew another applicant's `app_id` and email address could call the RPC directly via the REST API and claim that application. In normal dashboard usage, `currentUser.email` (the OTP-verified email) was always passed, so no user-facing behavior changes. The `p_email` parameter is retained in the function signature for backward compatibility but is no longer used for verification. Full audit of the applicant identity system confirmed all other components — OTP login flow, dashboard auth routing, `get_my_applications()` field exposure, `get_lease_financials()` financial gating, `co_applicant_email` display logic, `lastSuccessAppId` sessionStorage lifecycle, and all SQL migration idempotency — are working correctly.

---

## [2026-03-13] — Applicant Identity Layer (Passwordless OTP Authentication)

- **New `APPLICANT-AUTH.sql` migration:** Adds `applicant_user_id uuid` column to `applications` table with a foreign key to `auth.users`, an index, and a new RLS policy (`applications_applicant_read`) so authenticated applicants can read only their own rows. Also adds two secure RPCs: `get_my_applications()` returns the calling user's full application list (safe field subset), and `claim_application(app_id, email)` lets a newly-signed-in user link a legacy application submitted before they had an account (email-verified to prevent hijacking). Grant statements included.
- **New `apply/login.html` page:** Applicant-facing passwordless OTP email sign-in. Two-step flow — enter email → receive 8-digit code → auto-submits on 8th digit. Supports `?redirect=` URL param so users land back on whatever page triggered the sign-in. Checks existing session on load and skips the form if already signed in. Includes "Track by Application ID instead" and "Resend my Application ID" fallback paths.
- **Updated `apply/dashboard.html` — auth-aware design:** On page load, checks the Supabase session. (1) If authenticated with no `?id=` param — renders a "My Applications" list showing all linked apps as clickable cards, with status/lease pills. Clicking a card opens the detail view (same `renderDetailView` function). A "Look Up a Specific Application" section is appended below the list as a fallback. (2) If not authenticated — shows the classic App ID lookup card plus a sign-in prompt banner. (3) If `?id=` param present — always shows that app directly (works for both auth and anon). Topbar now shows signed-in email + Sign Out button when authenticated. All anonymous detail views now show a "Sign in to see all your applications" prompt so users discover the feature naturally. `signOut` routes back to `/apply/login.html` for the applicant scope.
- **Updated `js/cp-api.js` — `CP.ApplicantAuth` added:** New helper object exported on `window.CP` with `sendOTP(email)`, `verifyOTP(email, token)`, `getUser()`, `getSession()`, `signOut()`, `getMyApplications()` (calls `get_my_applications()` RPC), and `claimApplication(appId, email)` (calls `claim_application()` RPC). `Auth.signOut()` updated to route to `/apply/login.html` when on an `/apply/` path (was incorrectly routing to `/landlord/login.html`).
- **Updated `supabase/functions/process-application/index.ts`:** Added optional applicant auth block after rate-limit check. Extracts the Bearer JWT from the Authorization header; if it differs from the anon key, verifies it against Supabase Auth and extracts the user UUID. Adds `applicant_user_id` to the application insert record (null for anonymous submissions). Entirely non-breaking — no change to existing anonymous flow.
- **Setup instructions:** Run `APPLICANT-AUTH.sql` once in Supabase SQL Editor. Enable Email OTP in Supabase Auth settings (Dashboard → Auth → Providers → Email → Enable OTP). No other configuration needed.

---

## [2026-03-13] — Verification & Polish Pass: Nav consistency, logo standardization, apply.html address fix

- **Nav drawer CTA fix (property.html):** `drawerAuthLink` was missing the `btn-full` class, making the "Landlord Login" button in the mobile drawer narrower than on all other pages. Added `btn-full` to match every other page.
- **Nav logo standardization — dark inline override removed (property.html, about.html, faq.html, how-to-apply.html, how-it-works.html, 404.html):** All six pages overrode the `nav-logo-mark` CSS class with an inline `background:#0f1117` or `background:var(--ink)` style, rendering a near-black logo while `index.html` showed the correct brand-blue `nav-logo-emblem`. Changed all instances to `nav-logo-emblem` (no inline styles), which carries the correct blue background, `flex-shrink:0`, and a subtle brand-shadow via CSS — consistent with the homepage.
- **Nav logo standardization — letter fallback replaced (terms.html, privacy.html):** Both pages used `<div class="nav-logo-mark">C</div>` (a plain blue square with the letter "C") rather than the SVG house icon used everywhere else. Replaced with the correct `nav-logo-emblem` + SVG markup.
- **SVG brand circle color unified:** The house SVG's inner circle was `rgba(37,99,235,0.9)` on several pages (the old Tailwind blue-600) vs the design-system brand blue `rgba(0,106,255,0.8)`. Standardized to `rgba(0,106,255,0.8)` across all affected pages.
- **apply.html footer address placeholder removed:** The hardcoded `<p>Your Business Address</p>` is now a hidden `<p id="footerAddressLine">` that reads `CONFIG.COMPANY_ADDRESS` on `DOMContentLoaded` and reveals itself only when that value is non-empty — consistent with how `footerContactLine` and `footerEmailLink` are already handled.
- **HTTP verification:** All 12 public pages confirmed returning HTTP 200 post-changes.

---

## [2026-03-13] — Bug fixes #1–6: Tenant dashboard, lease signing, and admin modal

- **Fix 1 — Lease deadline countdown (dashboard.html):** Replaced hardcoded "48 hours" with a `leaseDeadlineText()` helper that reads `lease_expiry_date` and renders the real remaining time (e.g. "within 3 days — by Fri, Mar 20"). Falls back to generic text if the field is absent.
- **Fix 2 — Lease text readability (lease.html):** Expanded `.lease-text` max-height from 400px to 600px so tenants can read significantly more of the lease agreement without scrolling inside a tiny box. Added a dynamic expiry-countdown banner at the top of the signing page (red for <24 h, amber otherwise).
- **Fix 3 — Download signed lease (dashboard.html):** Added "📄 Download Signed Lease" button to the `lease_status === 'signed'` and `co_signed` callouts. Uses `app.lease_pdf_url`, which the `get-application-status` edge function already generates as a fresh Supabase Storage signed URL on every dashboard load — so the link is never stale.
- **Fix 4 — Denial reason shown to tenants (dashboard.html):** The denial callout now conditionally renders `app.admin_notes` (written by the admin at denial time) as a "Reason provided:" sub-section. Sanitised via `escapeHTML()`.
- **Fix 5 — "Fee Paid" step accuracy (dashboard.html):** Step 2 of the progress bar was advancing to complete when `status === 'under_review'` regardless of `payment_status`. Removed the erroneous `|| app.status === 'under_review'` branch — step 2 now only shows complete when `payment_status === 'paid'`.
- **Fix 6 — Lease modal start-date pre-fill (admin/applications.html):** `openLeaseModal()` now accepts a `prefillMoveIn` parameter (the applicant's `requested_move_in_date`). The "Send Lease", "Resend Lease", and "Send New Lease" buttons pass this value; the modal sets `m-start` from it rather than defaulting to today.
- **Bonus fix — Dashboard lookup card HTML corruption (dashboard.html):** The lookup card block had literal `\n` and `\"` escape sequences in raw HTML (pre-existing). Unescaped all sequences so the card renders cleanly in all browsers.

## [2026-03-13] — Improvement #2: Persistent property context banner across all steps

- Added `div#propertyContextBanner` in `apply.html` between the step progress bar and the submission-progress div — outside all form sections so it persists across every step
- Reuses existing `.property-confirm-banner` CSS class (no new CSS written)
- Shows "Applying for" label, property title, address, rent/mo, and bed/bath count
- Added `_showContextBanner(prop)` and `_hideContextBanner()` methods in `apply.js`
- `onPropertySelected()` calls `_showContextBanner` on every selection (shows on pick, hides on clear/escape)
- `_activatePropertyLock()` calls `_showContextBanner` so banner appears immediately on page load when arriving from a listing
- Mobile layout handled by existing `.property-confirm-banner` media query (480px breakpoint wraps badge to full-width row)

---

## [2026-03-13] — Hardened Replit AI control — 4-layer static site enforcement

- Added `.agents/instructions.md` — dedicated agent instruction file that Replit reads on import, classifying the project as a static site and listing absolute prohibitions
- Rewrote `replit.md` — moved machine-readable `PROJECT_TYPE / DEPLOYMENT_TARGET / BACKEND` metadata to the very first lines so any AI parser reads project classification before anything else; fixed incorrect "python3" local preview reference (actual command is `node serve.js`); added explicit "NOT Replit" labels to all Cloudflare and Supabase env var sections
- Updated `package.json` description — now explicitly states static site, Cloudflare deployment, no Replit database, no ORM as the very first thing any AI sees in the manifest
- Note: `javascript_database` blueprint entry in `.replit` could not be removed (file is system-protected); mitigated by the three layers above which clearly override any database integration signals

---

## [2025-06-23] — Fix: public listings not appearing on homepage

- **Root cause**: `index.html`, `property.html`, `apply/dashboard.html`, and `apply/lease.html` all loaded `cp-api.js` as a classic `<script>`. Since `cp-api.js` contains ES6 `export` declarations, browsers throw a `SyntaxError` when parsing it as a non-module script — the entire file fails to execute, `window.CP` is never defined, and no property data loads.
- **Fix**: Changed all four pages to load `cp-api.js` as `<script type="module">` and converted their inline `<script>` blocks to `<script type="module">` as well (modules are deferred and execute in document order, so `window.CP` is guaranteed to be set before the inline module runs).
- **Additional**: Added `window.lookup`, `window.recoverById`, `window.sendRecovery` exports to `apply/dashboard.html`'s module, and `window.doSign`, `window.doCoSign` to `apply/lease.html`'s module, so `onclick` attributes in HTML templates continue to resolve these functions globally.
- **Landlord/admin pages were unaffected** — they already used `import { ... } from '../js/cp-api.js'` (ES module syntax), which is correct.

---

## [2025-03-12] — Documentation enforcement system added

- Created `CHANGELOG.md` to track all project changes going forward
- Updated `replit.md` with mandatory documentation update rule — AI must update docs as part of every task
- Defined clear ownership rules for each documentation file

## [2025-03-12] — Replit AI hard rules added to replit.md

- Added ABSOLUTE PROHIBITIONS section at the top of `replit.md`
- Blocks AI from installing databases, ORMs, server frameworks, or backend files
- Blocks any migration or provisioning attempts on import to a new Replit account
- Clarifies Replit is used as a code editor only — deployment target remains Cloudflare Pages

## [2025-03-12] — Replit-specific files removed (cleanup)

- Removed `server.js` (Express static server — not needed for Cloudflare Pages)
- Removed `server/db.ts` (Drizzle/Postgres file — wrong for this project)
- Removed `node_modules/` and `package-lock.json`
- Reverted `package.json` to original state — no dependencies, build script only
- Restored workflow to `python3 -m http.server 5000`

## [2025-03-12] — Initial Replit import from GitHub

- Project imported from GitHub into Replit for editing
- No code changes made to the core application
- Node.js 20 installed for running `generate-config.js` build script
