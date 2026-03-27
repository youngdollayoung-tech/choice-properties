/**
 * Choice Properties — RentProgress.com Scraper
 *
 * Scrapes real single-family rental listings from rentprogress.com and inserts
 * them into Supabase.  The script runs inside Replit's code_execution notebook
 * (which has a headless-browser webFetch) because rentprogress.com is an Adobe
 * AEM / JavaScript-rendered site.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * NOTE ON SCRAPERAPI
 * ──────────────────────────────────────────────────────────────────────────────
 * ScraperAPI free tier returns HTTP 500 / "Protected domains may require
 * premium=true" for rentprogress.com.  The paid premium/ultra-premium tiers
 * would work, but the free plan does not support this domain.
 *
 * As a result, live scraping is done inside the Replit code_execution notebook
 * (webFetch with headless browser).  The parsed data is saved to
 * /tmp/rp_properties.json and this Node.js script then reads that file and
 * inserts the rows into Supabase using the service-role key.
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * WORKFLOW
 * --------
 * 1.  Open the Replit Agent chat and run the code_execution scraper block
 *     (see SCRAPER_NOTEBOOK.md for the full snippet).
 *     It writes /tmp/rp_properties.json.
 *
 * 2.  Then run:  node scripts/fetch_rentprogress.js
 *
 * Required env vars (for step 2):
 *   SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_KEY  — service role key (bypasses RLS)
 *
 * Target markets  (10 listings each → 50 total):
 *   Charlotte NC | St. Louis MO | Kansas City MO | San Antonio TX | Oklahoma City OK
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const DATA_FILE    = process.env.DATA_FILE || '/tmp/rp_properties.json';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('✗ SUPABASE_URL and SUPABASE_SERVICE_KEY are required.');
  process.exit(1);
}

if (!fs.existsSync(DATA_FILE)) {
  console.error(`✗ Data file not found: ${DATA_FILE}`);
  console.error('  Run the code_execution scraper block first to generate it.');
  process.exit(1);
}

// ── Load parsed properties ─────────────────────────────────────────────────

const rows = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
console.log(`Loaded ${rows.length} properties from ${DATA_FILE}`);

// ── Supabase upsert ────────────────────────────────────────────────────────

function insertBatch(batch) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(batch);
    const parsed  = new URL(SUPABASE_URL + '/rest/v1/properties?on_conflict=id');
    const opts = {
      method:   'POST',
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      headers: {
        'apikey':         SERVICE_KEY,
        'Authorization':  'Bearer ' + SERVICE_KEY,
        'Content-Type':   'application/json',
        'Prefer':         'resolution=merge-duplicates,return=minimal',
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

async function main() {
  console.log('=== Choice Properties — RentProgress Insert ===\n');

  const BATCH   = 20;
  let inserted  = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const res   = await insertBatch(batch);
    if (res.status >= 200 && res.status < 300) {
      inserted += batch.length;
      console.log(`✓ Batch ${Math.floor(i / BATCH) + 1}: inserted ${batch.length} rows (HTTP ${res.status})`);
    } else {
      console.error(`✗ Batch ${Math.floor(i / BATCH) + 1} FAILED (HTTP ${res.status}):`);
      console.error(`  ${res.body.slice(0, 400)}`);
    }
  }

  console.log(`\n✓ Total inserted/updated: ${inserted}/${rows.length}`);

  // City breakdown
  const cities = {};
  rows.forEach(r => { const k = `${r.city}, ${r.state}`; cities[k] = (cities[k] || 0) + 1; });
  console.log('\nCity breakdown:');
  Object.entries(cities).sort().forEach(([k, v]) => console.log(`  ${k}: ${v}`));
}

main().catch(console.error);
