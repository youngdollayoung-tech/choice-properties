/**
 * Choice Properties — Delete All Properties
 *
 * Removes every property row from Supabase so we can start fresh.
 * Applications that reference a property will have their property_id
 * left in place (the FK may already be SET NULL or CASCADE — this script
 * does not touch the applications table).
 *
 * Required env vars:
 *   SUPABASE_URL         — your Supabase project URL
 *   SUPABASE_SERVICE_KEY — service role key (bypass RLS)
 *
 * Run: node scripts/delete_properties.js
 */

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('✗ SUPABASE_URL and SUPABASE_SERVICE_KEY are required.');
  process.exit(1);
}

function supabaseReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const url     = new URL(SUPABASE_URL + path);
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: url.hostname,
      path:     url.pathname + url.search,
      headers: {
        'apikey':        SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    let raw = '';
    const req = https.request(opts, r => {
      r.on('data', c => raw += c);
      r.on('end', () => resolve({ status: r.statusCode, body: raw || null }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('=== Choice Properties — Delete All Properties ===\n');

  // Step 1: count existing properties
  const countRes = await supabaseReq('GET', '/rest/v1/properties?select=id&limit=1&offset=0');
  console.log(`Supabase response status: ${countRes.status}`);

  // Step 2: delete ALL — filter on created_at >= epoch (always true)
  console.log('Deleting all properties...');
  const delRes = await supabaseReq(
    'DELETE',
    '/rest/v1/properties?created_at=gte.1900-01-01T00:00:00.000Z'
  );

  if (delRes.status >= 200 && delRes.status < 300) {
    console.log('✓ All properties deleted successfully.');
  } else {
    console.error(`✗ Delete failed (HTTP ${delRes.status}):`);
    console.error(delRes.body);
    process.exit(1);
  }

  // Step 3: confirm zero rows remain
  const verifyRes = await supabaseReq('GET', '/rest/v1/properties?select=id&limit=1');
  let remaining = [];
  try { remaining = JSON.parse(verifyRes.body || '[]'); } catch (_) {}
  if (remaining.length === 0) {
    console.log('✓ Verified — properties table is now empty.');
  } else {
    console.warn('⚠  Some rows may still remain. Check Supabase dashboard.');
  }
}

main().catch(console.error);
