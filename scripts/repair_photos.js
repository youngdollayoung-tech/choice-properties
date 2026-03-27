/**
 * Choice Properties — Photo Repair Script
 *
 * Fetches all properties from Supabase that have photo_urls pointing to
 * external sources (Redfin, Craigslist, etc.), re-uploads each photo to
 * ImageKit, and updates the record with the permanent CDN URL.
 *
 * Safe to run multiple times — already-fixed ImageKit URLs are skipped.
 *
 * Run: node scripts/repair_photos.js
 */

const https  = require('https');
const { canUseImageKit, uploadPhotosToImageKit } = require('./imagekit-helper');

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const IMAGEKIT_URL   = process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('✗ SUPABASE_URL and SUPABASE_SERVICE_KEY are required.');
  process.exit(1);
}
if (!canUseImageKit()) {
  console.error('✗ IMAGEKIT_PRIVATE_KEY is required.');
  process.exit(1);
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

function sbGet(path) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(SUPABASE_URL + path);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Accept': 'application/json',
      },
    };
    let raw = '';
    https.get(opts, r => {
      r.on('data', c => raw += c);
      r.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(_) { resolve(raw); }
      });
    }).on('error', reject);
  });
}

function sbPatch(path, body) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(SUPABASE_URL + path);
    const payload = JSON.stringify(body);
    const opts = {
      method: 'PATCH',
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    let raw = '';
    const req = https.request(opts, r => {
      r.on('data', c => raw += c);
      r.on('end', () => resolve({ status: r.statusCode, body: raw }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function needsRepair(photoUrls) {
  if (!photoUrls || photoUrls.length === 0) return false;
  // Skip if already on ImageKit
  if (photoUrls.every(u => u.includes('ik.imagekit.io'))) return false;
  return true;
}

async function main() {
  const batchLimit = parseInt(process.argv[2]) || Infinity;
  console.log('=== Choice Properties — Photo Repair ===\n');

  // Fetch all properties with photo_urls in batches
  let allProps = [];
  let offset   = 0;
  const limit  = 100;

  while (true) {
    const rows = await sbGet(
      `/rest/v1/properties?select=id,photo_urls&photo_urls=not.is.null&order=created_at.asc&limit=${limit}&offset=${offset}`
    );
    if (!Array.isArray(rows) || rows.length === 0) break;
    allProps.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }

  console.log(`Found ${allProps.length} properties with photo_urls in database.`);

  const allToRepair = allProps.filter(p => needsRepair(p.photo_urls));
  const toRepair   = allToRepair.slice(0, batchLimit);
  const alreadyOk  = allProps.length - allToRepair.length;

  console.log(`  ${alreadyOk} already on ImageKit — skipping`);
  console.log(`  ${allToRepair.length} need repair (processing ${toRepair.length} this run)\n`);

  if (toRepair.length === 0) {
    console.log('✓ Nothing to repair — all photos are already on ImageKit!');
    return;
  }

  let fixed = 0;
  let failed = 0;
  let noPhotos = 0;
  const CONCURRENCY = 10;

  async function processOne(prop, idx) {
    process.stdout.write(`[${idx + 1}/${toRepair.length}] ${prop.id.slice(0, 8)}: `);

    const ikUrls = await uploadPhotosToImageKit(
      prop.photo_urls.filter(u => !u.includes('ik.imagekit.io')),
      prop.id,
      '/properties/repaired'
    );

    if (ikUrls.length > 0) {
      const preserved = (prop.photo_urls || []).filter(u => u.includes('ik.imagekit.io'));
      const merged    = [...preserved, ...ikUrls];

      const res = await sbPatch(`/rest/v1/properties?id=eq.${prop.id}`, {
        photo_urls: merged,
        updated_at: new Date().toISOString(),
      });

      if (res.status >= 200 && res.status < 300) {
        process.stdout.write(` → saved ${merged.length} URL(s)\n`);
        fixed++;
      } else {
        process.stdout.write(` → DB update FAILED (${res.status})\n`);
        failed++;
      }
    } else {
      process.stdout.write(` → no photos\n`);
      noPhotos++;
    }
  }

  // Process in parallel batches
  for (let i = 0; i < toRepair.length; i += CONCURRENCY) {
    const batch = toRepair.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((prop, j) => processOne(prop, i + j)));
    await sleep(100);
  }

  console.log('\n=== Repair complete ===');
  console.log(`  ✓ Fixed:     ${fixed}`);
  console.log(`  ✗ Failed DB: ${failed}`);
  console.log(`  — No photos: ${noPhotos} (source blocked — original URLs were expired/dead)`);
}

main().catch(console.error);
