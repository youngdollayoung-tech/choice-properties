// ============================================================
// CHOICE PROPERTIES — Universal Configuration
// ============================================================
// This is the ONLY file you edit when deploying to a new
// environment. Every HTML file imports this before anything else.
//
// ⚠️  SECRETS THAT DO NOT BELONG HERE (put in Supabase secrets):
//     GAS_EMAIL_URL        → Supabase Dashboard → Edge Functions → Secrets
//     GAS_RELAY_SECRET     → Supabase Dashboard → Edge Functions → Secrets
//     IMAGEKIT_PRIVATE_KEY → Supabase Dashboard → Edge Functions → Secrets
//     DASHBOARD_URL        → Your public site root URL (e.g. https://yoursite.com)
//                            Used by generate-lease and sign-lease to build signing links.
//     ADMIN_EMAIL          → Email address for admin notifications from process-application.
//
// Works on: localhost, any domain, any server, any port.
// No build tools required.
// ============================================================

const CONFIG = {

  // ── Supabase ──────────────────────────────────────────────
  // Both are safe to be public (anon key is designed for client use)
  SUPABASE_URL:      'YOUR_SUPABASE_URL',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',

  // ── ImageKit ──────────────────────────────────────────────
  // Only the PUBLIC key and URL endpoint go here.
  // Private key stays in Supabase Edge Function secrets ONLY — never here.
  IMAGEKIT_URL:        'https://ik.imagekit.io/YOUR_IMAGEKIT_ID',
  IMAGEKIT_PUBLIC_KEY: 'YOUR_IMAGEKIT_PUBLIC_KEY',

  // ── Geoapify (address autocomplete on application form) ───
  // Get a free key at https://www.geoapify.com — the free tier is sufficient.
  GEOAPIFY_API_KEY: 'YOUR_GEOAPIFY_API_KEY',

  // ── Company Info ──────────────────────────────────────────
  COMPANY_NAME:     'Choice Properties',
  COMPANY_EMAIL:    'your@email.com',
  COMPANY_PHONE:    'YOUR-PHONE-NUMBER',
  COMPANY_TAGLINE:  'Your trust is our standard.',
  COMPANY_ADDRESS:  'Your Business Address',

  // ── Admin Config ──────────────────────────────────────────
  // These are for UI display only — real admin auth is server-side
  // via the admin_roles table. Do not rely on this for security.
  ADMIN_EMAILS: [
    'your@email.com',
  ],

  // ── Lease Settings ────────────────────────────────────────
  LEASE_DEFAULT_LATE_FEE_FLAT:  50,
  LEASE_DEFAULT_LATE_FEE_DAILY: 10,
  LEASE_DEFAULT_EXPIRY_DAYS:    7,

  // ── Feature Flags ─────────────────────────────────────────
  FEATURES: {
    CO_APPLICANT:       true,
    VEHICLE_INFO:       true,
    DOCUMENT_UPLOAD:    true,
    MESSAGING:          true,
    REALTIME_UPDATES:   true,
  },

};

// ── Derived helpers ────────────────────────────────────────
CONFIG.isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
CONFIG.baseUrl     = location.origin;

// ── ImageKit delivery helper ───────────────────────────────
CONFIG.img = function(url, preset) {
  const fallback = url || '/assets/placeholder-property.jpg';
  if (!url) return '/assets/placeholder-property.jpg';
  if (!CONFIG.IMAGEKIT_URL || CONFIG.IMAGEKIT_URL.includes('YOUR_IMAGEKIT_ID')) {
    return fallback;
  }
  const transforms = {
    card:      'tr:w-600,q-80,f-webp',
    gallery:   'tr:w-1200,q-90,f-webp',
    thumb:     'tr:w-120,h-120,c-maintain_ratio,q-75,f-webp',
    lightbox:  'tr:q-95,f-webp',
    og:        'tr:w-1200,h-630,c-force,fo-center,q-85,f-webp',
    avatar:    'tr:w-80,h-80,c-force,fo-face,q-80,f-webp',
    avatar_lg: 'tr:w-160,h-160,c-force,fo-face,q-85,f-webp',
  };
  const tr = transforms[preset] || transforms.gallery;
  if (url.startsWith(CONFIG.IMAGEKIT_URL)) {
    const clean = url.replace(/\/tr:[^/]+/, '');
    return clean.replace(CONFIG.IMAGEKIT_URL, `${CONFIG.IMAGEKIT_URL}/${tr}`);
  }
  return `${CONFIG.IMAGEKIT_URL}/${tr}/${encodeURIComponent(url)}`;
};

Object.freeze(CONFIG);
Object.freeze(CONFIG.FEATURES);
