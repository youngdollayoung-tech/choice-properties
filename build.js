// Choice Properties — Build script for Cloudflare Pages (and any CI/CD)
// Generates config.js from environment variables, then exits.
// In Cloudflare Pages dashboard: set Build command = "node build.js", Output directory = "."

const fs   = require('fs');
const path = require('path');

const SUPABASE_URL      = (process.env.SUPABASE_URL      || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY =  process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL)      console.warn('⚠  SUPABASE_URL is not set — Supabase features will not work');
if (!SUPABASE_ANON_KEY) console.warn('⚠  SUPABASE_ANON_KEY is not set — Supabase features will not work');

const configJs = `// Auto-generated at build time — do not edit manually
const CONFIG = {
  SUPABASE_URL:      '${SUPABASE_URL}',
  SUPABASE_ANON_KEY: '${SUPABASE_ANON_KEY}',

  IMAGEKIT_URL:        '${process.env.IMAGEKIT_URL        || ''}',
  IMAGEKIT_PUBLIC_KEY: '${process.env.IMAGEKIT_PUBLIC_KEY || ''}',

  GEOAPIFY_API_KEY: '${process.env.GEOAPIFY_API_KEY || ''}',

  COMPANY_NAME:    '${process.env.COMPANY_NAME    || 'Choice Properties'}',
  COMPANY_EMAIL:   '${process.env.COMPANY_EMAIL   || ''}',
  COMPANY_PHONE:   '${process.env.COMPANY_PHONE   || ''}',
  COMPANY_TAGLINE: '${process.env.COMPANY_TAGLINE || 'Your trust is our standard.'}',
  COMPANY_ADDRESS: '${process.env.COMPANY_ADDRESS || ''}',

  ADMIN_EMAILS: ${JSON.stringify((process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean))},

  LEASE_DEFAULT_LATE_FEE_FLAT:  ${Number(process.env.LEASE_DEFAULT_LATE_FEE_FLAT)  || 50},
  LEASE_DEFAULT_LATE_FEE_DAILY: ${Number(process.env.LEASE_DEFAULT_LATE_FEE_DAILY) || 10},
  LEASE_DEFAULT_EXPIRY_DAYS:    ${Number(process.env.LEASE_DEFAULT_EXPIRY_DAYS)    || 7},

  FEATURES: {
    CO_APPLICANT:     ${process.env.FEATURE_CO_APPLICANT     !== 'false'},
    VEHICLE_INFO:     ${process.env.FEATURE_VEHICLE_INFO     !== 'false'},
    DOCUMENT_UPLOAD:  ${process.env.FEATURE_DOCUMENT_UPLOAD  !== 'false'},
    MESSAGING:        ${process.env.FEATURE_MESSAGING        !== 'false'},
    REALTIME_UPDATES: ${process.env.FEATURE_REALTIME_UPDATES !== 'false'},
  },
};

CONFIG.isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
CONFIG.baseUrl     = location.origin;

CONFIG.img = function(url, preset) {
  const fallback = url || '/assets/placeholder-property.jpg';
  if (!url) return '/assets/placeholder-property.jpg';
  if (!CONFIG.IMAGEKIT_URL || CONFIG.IMAGEKIT_URL === '') return fallback;
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
    const clean = url.replace(/\\/tr:[^/]+/, '');
    return clean.replace(CONFIG.IMAGEKIT_URL, CONFIG.IMAGEKIT_URL + '/' + tr);
  }
  return CONFIG.IMAGEKIT_URL + '/' + tr + '/' + encodeURIComponent(url);
};

Object.freeze(CONFIG.FEATURES);
`;

fs.writeFileSync(path.join(__dirname, 'config.js'), configJs);
console.log('✓ config.js generated successfully');
