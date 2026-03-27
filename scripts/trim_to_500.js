/**
 * Choice Properties — Trim to 500 with geographic spread
 *
 * Keeps the most recent N listings per major city so the total
 * across all cities lands at exactly 500. Small cities (< 10
 * listings) are kept in full.
 *
 * Run: node scripts/trim_to_500.js
 */

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.');
  process.exit(1);
}

// How many to keep per major city
const CITY_QUOTAS = {
  'Dallas, TX':      60,
  'Atlanta, GA':     60,
  'Las Vegas, NV':   60,
  'Phoenix, AZ':     60,
  'Orlando, FL':     59,
  'Charlotte, NC':   59,
  'San Antonio, TX': 59,
  'Houston, TX':     59,
};

function sbGet(path) {
  return new Promise((resolve) => {
    const url = new URL(SUPABASE_URL + path);
    https.get({
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
      },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch(_) { resolve([]); } });
    }).on('error', () => resolve([]));
  });
}

function sbDelete(path) {
  return new Promise((resolve) => {
    const url = new URL(SUPABASE_URL + path);
    const opts = {
      method: 'DELETE',
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Prefer': 'return=minimal',
      },
    };
    let d = '';
    const req = https.request(opts, r => {
      r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode }));
    });
    req.on('error', () => resolve({ status: 0 }));
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getAllIdsForCity(city, state) {
  const ids = [];
  let offset = 0;
  while (true) {
    const rows = await sbGet(
      `/rest/v1/properties?select=id,created_at&city=eq.${encodeURIComponent(city)}&state=eq.${encodeURIComponent(state)}&order=created_at.desc&limit=500&offset=${offset}`
    );
    if (!Array.isArray(rows) || rows.length === 0) break;
    ids.push(...rows.map(r => r.id));
    if (rows.length < 500) break;
    offset += 500;
  }
  return ids;
}

async function deleteIds(ids) {
  // Supabase REST: DELETE with in filter, batch 50 at a time
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const filter = batch.map(id => `"${id}"`).join(',');
    const res = await sbDelete(`/rest/v1/properties?id=in.(${batch.join(',')})`);
    if (res.status >= 200 && res.status < 300) {
      deleted += batch.length;
    } else {
      console.warn(`  ⚠ Delete batch failed (status ${res.status})`);
    }
    await sleep(150);
  }
  return deleted;
}

async function main() {
  console.log('=== Choice Properties — Trim to 500 ===\n');

  let totalDeleted = 0;
  let totalKept    = 0;

  for (const [cityState, quota] of Object.entries(CITY_QUOTAS)) {
    const [city, state] = cityState.split(', ');
    process.stdout.write(`${cityState}: fetching IDs... `);

    const ids = await getAllIdsForCity(city, state);
    const toDelete = ids.slice(quota);
    const kept     = Math.min(ids.length, quota);

    process.stdout.write(`${ids.length} found, keeping ${kept}, deleting ${toDelete.length}\n`);

    if (toDelete.length > 0) {
      const deleted = await deleteIds(toDelete);
      totalDeleted += deleted;
    }
    totalKept += kept;
  }

  // Count small-city properties (kept in full)
  console.log('\nFetching final count...');
  const remaining = await sbGet('/rest/v1/properties?select=id&limit=1');
  // Use count header via a HEAD-like approach
  const countRes = await new Promise((resolve) => {
    const url = new URL(SUPABASE_URL + '/rest/v1/properties?select=id');
    https.get({
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Prefer': 'count=exact',
        'Range': '0-0',
      },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => resolve(r.headers['content-range'] || '?'));
    }).on('error', () => resolve('?'));
  });

  console.log('\n=== Done ===');
  console.log(`  Deleted:          ${totalDeleted}`);
  console.log(`  Content-Range:    ${countRes}`);
}

main().catch(console.error);
