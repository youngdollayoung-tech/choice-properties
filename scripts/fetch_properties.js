/**
 * Fetches real rental listings from Redfin's public search endpoint (no API key needed)
 * and upserts them into Supabase as single-family / townhouse properties.
 * 
 * Run: node scripts/fetch_properties.js
 */

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

// ── Helpers ───────────────────────────────────────────────────────────────────

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ChoicePropertiesBot/1.0)',
        'Accept': 'application/json',
        ...headers
      }
    };
    let raw = '';
    https.get(opts, r => {
      r.on('data', c => raw += c);
      r.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { resolve(raw); } });
    }).on('error', reject);
  });
}

function supabasePost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(SUPABASE_URL + endpoint);
    const payload = JSON.stringify(body);
    const opts = {
      method: 'POST',
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    let raw = '';
    const req = https.request(opts, r => {
      r.on('data', c => raw += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: raw ? JSON.parse(raw) : null }); }
        catch(e) { resolve({ status: r.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Redfin Rental Search ──────────────────────────────────────────────────────
// Uses Redfin's internal CSV/JSON endpoint – publicly accessible, no auth needed

async function fetchRedfinRentals(city, state, maxResults = 50) {
  const regionUrl = `https://www.redfin.com/stingray/do/location-autocomplete?location=${encodeURIComponent(city + ', ' + state)}&v=2`;
  console.log(`  Looking up region for ${city}, ${state}...`);

  let regionId, regionType;
  try {
    const region = await httpGet(regionUrl);
    // Redfin returns "{}&&[...]" – strip the prefix
    const cleaned = typeof region === 'string' ? region.replace(/^[^[{]*/, '') : JSON.stringify(region);
    const parsed  = JSON.parse(cleaned);
    const payload = parsed.payload || parsed;
    const result  = Array.isArray(payload.exactMatch) && payload.exactMatch.length
      ? payload.exactMatch[0]
      : (payload.sections && payload.sections[0] && payload.sections[0].rows && payload.sections[0].rows[0]);

    if (!result) { console.log(`  No region found for ${city}, ${state}`); return []; }
    regionId   = result.id.split('_')[1];
    regionType = result.type || 6;
  } catch(e) {
    console.log(`  Region lookup failed for ${city}, ${state}:`, e.message);
    return [];
  }

  console.log(`  Region: ${regionId} type:${regionType}`);

  // Redfin rental search: propertyType 3=single-family, 4=townhouse, 6=multifamily
  const searchUrl = [
    'https://www.redfin.com/stingray/api/gis-csv?',
    `al=1&market=national&min_listing_approx_size=500`,
    `&num_homes=${maxResults}`,
    `&ord=days-on-redfin-asc&page_number=1`,
    `&property_type=3,4`,   // single-family + townhouse only
    `&region_id=${regionId}&region_type=${regionType}`,
    `&sf=1,2,3,5,6,7&status=9`,  // for_rent active
    `&uipt=1,2&v=8`
  ].join('');

  console.log(`  Fetching rentals...`);

  try {
    const csv = await httpGet(searchUrl);
    if (typeof csv !== 'string' || !csv.includes(',')) {
      console.log(`  No CSV data for ${city}, ${state}`);
      return [];
    }
    const lines = csv.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase().replace(/ /g, '_'));
    const rows = lines.slice(1).map(line => {
      const cols = line.split(',').map(c => c.replace(/"/g, '').trim());
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i] || null);
      return obj;
    });
    console.log(`  Got ${rows.length} raw rows`);
    return rows;
  } catch(e) {
    console.log(`  Fetch failed:`, e.message);
    return [];
  }
}

// ── Map Redfin row → Supabase property ───────────────────────────────────────

const LANDLORD_ID = '53c17b61-2deb-4ab4-bed5-31ad4da85d39'; // existing landlord in DB

function mapRow(row, city, state) {
  const price = parseInt((row.price || '').replace(/[^0-9]/g, '')) || 0;
  if (price < 500 || price > 15000) return null;

  const beds  = parseInt(row.beds) || null;
  const baths = parseFloat(row.baths) || null;
  const sqft  = parseInt((row.sq_ft || row.sqft || '').replace(/[^0-9]/g, '')) || null;
  const addr  = row.address || row.street_address || '';
  const zip   = row.zip || row.zip_code || '';

  if (!addr || !price) return null;
  if (beds && (beds < 1 || beds > 6)) return null;

  const propTypeRaw = (row.property_type || '').toLowerCase();
  let property_type = 'house';
  if (propTypeRaw.includes('townhouse') || propTypeRaw.includes('townhome')) property_type = 'townhouse';

  const lat = parseFloat(row.latitude) || null;
  const lng = parseFloat(row.longitude) || null;

  const mls = row.mls || row.listing_id || row.redfin_estimate || '';
  const id  = require('crypto').createHash('md5').update(addr + zip).digest('hex');

  // Build photo array from Redfin listing photo URL if available
  const photos = [];
  const url = row.url || '';
  if (url) {
    photos.push('https://www.redfin.com' + url.replace('/home/', '/photo/') + '/0.jpg');
  }

  return {
    id,
    landlord_id:       LANDLORD_ID,
    status:            'active',
    title:             `${beds || '?'}BR ${property_type === 'townhouse' ? 'Townhouse' : 'House'} in ${city}, ${state}`,
    address:           addr,
    city,
    state,
    zip,
    lat,
    lng,
    property_type,
    bedrooms:          beds,
    bathrooms:         baths,
    square_footage:    sqft,
    monthly_rent:      price,
    security_deposit:  price,
    photo_urls:        photos.length ? photos : null,
    pets_allowed:      false,
    smoking_allowed:   false,
    available_date:    new Date().toISOString().split('T')[0],
    minimum_lease_months: 12,
    created_at:        new Date().toISOString(),
    updated_at:        new Date().toISOString()
  };
}

// ── Target markets ────────────────────────────────────────────────────────────

const MARKETS = [
  // Texas
  { city: 'Houston',      state: 'TX' },
  { city: 'Austin',       state: 'TX' },
  { city: 'San Antonio',  state: 'TX' },
  { city: 'Dallas',       state: 'TX' },
  { city: 'Fort Worth',   state: 'TX' },
  // Georgia
  { city: 'Atlanta',      state: 'GA' },
  { city: 'Marietta',     state: 'GA' },
  { city: 'Douglasville', state: 'GA' },
  // North Carolina
  { city: 'Charlotte',    state: 'NC' },
  { city: 'Raleigh',      state: 'NC' },
  { city: 'Durham',       state: 'NC' },
  // Tennessee
  { city: 'Nashville',    state: 'TN' },
  { city: 'Memphis',      state: 'TN' },
  { city: 'Knoxville',    state: 'TN' },
  // Missouri
  { city: 'St. Louis',    state: 'MO' },
  { city: 'Kansas City',  state: 'MO' },
  // New Mexico
  { city: 'Albuquerque',  state: 'NM' },
  { city: 'Santa Fe',     state: 'NM' },
  // Arizona
  { city: 'Phoenix',      state: 'AZ' },
  { city: 'Tucson',       state: 'AZ' },
  // Colorado
  { city: 'Denver',       state: 'CO' },
  { city: 'Colorado Springs', state: 'CO' },
  // Florida
  { city: 'Tampa',        state: 'FL' },
  { city: 'Orlando',      state: 'FL' },
  { city: 'Jacksonville', state: 'FL' },
  // Ohio
  { city: 'Columbus',     state: 'OH' },
  { city: 'Cleveland',    state: 'OH' },
  { city: 'Cincinnati',   state: 'OH' },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== Choice Properties — Redfin Rental Fetcher ===\n');
  let totalInserted = 0;
  let allProperties = [];

  for (const { city, state } of MARKETS) {
    console.log(`\n[ ${city}, ${state} ]`);
    const rows = await fetchRedfinRentals(city, state, 30);

    const mapped = rows.map(r => mapRow(r, city, state)).filter(Boolean);
    console.log(`  Mapped ${mapped.length} valid properties`);
    allProperties.push(...mapped);

    await sleep(1500); // be polite to Redfin
  }

  // Deduplicate by id
  const seen = new Set();
  const unique = allProperties.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  console.log(`\n=== Total unique properties to insert: ${unique.length} ===`);

  if (unique.length === 0) {
    console.log('Nothing to insert — Redfin may be blocking. Try running again or check the CSV endpoint.');
    return;
  }

  // Insert in batches of 50
  const BATCH = 50;
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const res = await supabasePost('/rest/v1/properties?on_conflict=id', batch);
    if (res.status >= 200 && res.status < 300) {
      totalInserted += batch.length;
      console.log(`  Inserted batch ${Math.ceil(i/BATCH)+1}: ${batch.length} rows (status ${res.status})`);
    } else {
      console.log(`  Batch ${Math.ceil(i/BATCH)+1} FAILED (status ${res.status}):`, JSON.stringify(res.body).slice(0, 300));
    }
  }

  console.log(`\n✓ Done — inserted/updated ${totalInserted} properties`);
}

main().catch(console.error);
