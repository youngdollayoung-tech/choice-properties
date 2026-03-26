/**
 * Fetches real rental listings from Craigslist RSS feeds (completely free, no auth).
 * Targets single-family homes and townhouses in the specified markets.
 * 
 * Run: node scripts/fetch_craigslist.js
 */

const https = require('https');
const http  = require('http');
const crypto = require('crypto');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const LANDLORD_ID   = '53c17b61-2deb-4ab4-bed5-31ad4da85d39';

// ── HTTP helper ───────────────────────────────────────────────────────────────

function httpGet(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, text/xml, application/xml, */*'
      }
    };
    lib.get(opts, r => {
      if ([301,302,303,307,308].includes(r.statusCode) && r.headers.location && redirects > 0) {
        return resolve(httpGet(r.headers.location, redirects - 1));
      }
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => resolve(raw));
    }).on('error', reject);
  });
}

function supabaseUpsert(rows) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(rows);
    const parsed = new URL(SUPABASE_URL + '/rest/v1/properties?on_conflict=id');
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
      r.on('end', () => resolve({ status: r.statusCode, body: raw || null }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Parse Craigslist RSS XML ──────────────────────────────────────────────────

function parseRSS(xml) {
  const items = [];
  const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

  for (const block of itemBlocks) {
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    };

    const title = get('title');
    const desc  = get('description');
    const link  = get('link') || get('guid');
    const price = extractPrice(title + ' ' + desc);
    const beds  = extractBeds(title + ' ' + desc);
    const baths = extractBaths(title + ' ' + desc);
    const addr  = extractAddress(title + ' ' + desc);
    const photos = extractPhotos(desc);

    if (price) {
      items.push({ title, desc, link, price, beds, baths, addr, photos });
    }
  }
  return items;
}

function extractPrice(text) {
  const m = text.match(/\$\s*([\d,]+)/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ''));
  return (n >= 400 && n <= 15000) ? n : null;
}

function extractBeds(text) {
  const m = text.match(/(\d)\s*(?:br|bed|bedroom)/i);
  return m ? parseInt(m[1]) : null;
}

function extractBaths(text) {
  const m = text.match(/(\d(?:\.\d)?)\s*(?:ba|bath|bathroom)/i);
  return m ? parseFloat(m[1]) : null;
}

function extractAddress(text) {
  // Look for patterns like "123 Main St" or "near Main & Elm"
  const m = text.match(/\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Ave|Blvd|Dr|Ln|Rd|Way|Ct|Pl|Cir|Ter|Trail|Loop)\b/i);
  return m ? m[0].trim() : null;
}

function extractPhotos(html) {
  const imgs = html.match(/https?:\/\/[^"'\s>]+\.(?:jpg|jpeg|png|webp)/gi) || [];
  return imgs.slice(0, 5);
}

// ── Determine property type from title/desc ───────────────────────────────────

function getPropertyType(text) {
  const t = text.toLowerCase();
  if (t.includes('townhouse') || t.includes('townhome')) return 'townhouse';
  if (t.includes('single family') || t.includes('single-family') || t.includes('house') || t.includes('home')) return 'house';
  return 'house'; // default for sf category
}

// ── Craigslist city subdomains ────────────────────────────────────────────────
// Category: 'sfc' = sublets/temporary, 'sfr' = rooms, 'hhh' = housing (ALL)
// We use category 6 = single family housing specifically

const MARKETS = [
  // Texas
  { sub: 'houston',       city: 'Houston',           state: 'TX' },
  { sub: 'austin',        city: 'Austin',             state: 'TX' },
  { sub: 'sanantonio',    city: 'San Antonio',        state: 'TX' },
  { sub: 'dallas',        city: 'Dallas',             state: 'TX' },
  { sub: 'fortworth',     city: 'Fort Worth',         state: 'TX' },
  { sub: 'arlington',     city: 'Arlington',          state: 'TX' },
  // Georgia
  { sub: 'atlanta',       city: 'Atlanta',            state: 'GA' },
  { sub: 'atlanta',       city: 'Marietta',           state: 'GA', area: 'mar' },
  // North Carolina
  { sub: 'charlotte',     city: 'Charlotte',          state: 'NC' },
  { sub: 'raleigh',       city: 'Raleigh',            state: 'NC' },
  { sub: 'triangle',      city: 'Durham',             state: 'NC' },
  // Tennessee
  { sub: 'nashville',     city: 'Nashville',          state: 'TN' },
  { sub: 'memphis',       city: 'Memphis',            state: 'TN' },
  { sub: 'knoxville',     city: 'Knoxville',          state: 'TN' },
  { sub: 'chattanooga',   city: 'Chattanooga',        state: 'TN' },
  // Missouri
  { sub: 'stlouis',       city: 'St. Louis',          state: 'MO' },
  { sub: 'kansascity',    city: 'Kansas City',        state: 'MO' },
  // New Mexico
  { sub: 'albuquerque',   city: 'Albuquerque',        state: 'NM' },
  { sub: 'santafe',       city: 'Santa Fe',           state: 'NM' },
  // Arizona
  { sub: 'phoenix',       city: 'Phoenix',            state: 'AZ' },
  { sub: 'tucson',        city: 'Tucson',             state: 'AZ' },
  // Colorado
  { sub: 'denver',        city: 'Denver',             state: 'CO' },
  { sub: 'cosprings',     city: 'Colorado Springs',   state: 'CO' },
  // Florida
  { sub: 'tampa',         city: 'Tampa',              state: 'FL' },
  { sub: 'orlando',       city: 'Orlando',            state: 'FL' },
  { sub: 'jacksonville',  city: 'Jacksonville',       state: 'FL' },
  // Ohio
  { sub: 'columbus',      city: 'Columbus',           state: 'OH' },
  { sub: 'cleveland',     city: 'Cleveland',          state: 'OH' },
  { sub: 'cincinnati',    city: 'Cincinnati',         state: 'OH' },
];

function makeId(addr, city, state) {
  return crypto.createHash('md5').update((addr || '') + city + state + Math.random()).digest('hex');
}

function mapToProperty(item, city, state) {
  if (!item.price) return null;
  if (item.beds && (item.beds < 1 || item.beds > 6)) return null;

  const titleText = (item.title + ' ' + item.desc).toLowerCase();
  // Skip apartments and condos
  if (titleText.includes('apartment') || titleText.includes('condo') || titleText.includes(' apt ')) return null;

  const property_type = getPropertyType(item.title + ' ' + item.desc);
  const id = crypto.createHash('md5').update(item.link || (item.addr + city + state)).digest('hex');

  const bedsLabel = item.beds ? `${item.beds}BR` : '';
  const typeLabel = property_type === 'townhouse' ? 'Townhouse' : 'House';

  return {
    id,
    landlord_id:          LANDLORD_ID,
    status:               'active',
    title:                item.title.slice(0, 150) || `${bedsLabel} ${typeLabel} for Rent in ${city}, ${state}`,
    description:          item.desc ? item.desc.replace(/<[^>]*>/g, '').slice(0, 1000) : null,
    address:              item.addr || null,
    city,
    state,
    property_type,
    bedrooms:             item.beds,
    bathrooms:            item.baths,
    monthly_rent:         item.price,
    security_deposit:     item.price,
    photo_urls:           item.photos.length ? item.photos : null,
    pets_allowed:         titleText.includes('pet') && !titleText.includes('no pet'),
    smoking_allowed:      false,
    available_date:       new Date().toISOString().split('T')[0],
    minimum_lease_months: 12,
    virtual_tour_url:     item.link || null,
    created_at:           new Date().toISOString(),
    updated_at:           new Date().toISOString()
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== Choice Properties — Craigslist Rental Fetcher ===\n');

  let all = [];

  for (const m of MARKETS) {
    // Single-family homes RSS: category sfh (single family housing)
    const url = `https://${m.sub}.craigslist.org/search/sfh?format=rss&hasPic=1&min_price=500&max_price=10000`;
    console.log(`[${m.city}, ${m.state}] ${url}`);
    try {
      const xml = await httpGet(url);
      if (!xml || xml.length < 100) { console.log('  Empty response'); continue; }
      const items = parseRSS(xml);
      const props = items.map(i => mapToProperty(i, m.city, m.state)).filter(Boolean);
      console.log(`  Found ${items.length} items → ${props.length} valid`);
      all.push(...props);
    } catch(e) {
      console.log(`  Error: ${e.message}`);
    }
    await sleep(800);
  }

  // Deduplicate by id
  const seen = new Set();
  const unique = all.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });

  console.log(`\n=== Total unique properties: ${unique.length} ===`);
  if (unique.length === 0) { console.log('Nothing to insert.'); return; }

  // Sample
  console.log('\nSample:');
  console.log(JSON.stringify(unique[0], null, 2));

  // Insert in batches of 50
  let inserted = 0;
  const BATCH = 50;
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const res = await supabaseUpsert(batch);
    if (res.status >= 200 && res.status < 300) {
      inserted += batch.length;
      process.stdout.write(`\r  Inserted: ${inserted}/${unique.length}`);
    } else {
      console.log(`\n  Batch failed (${res.status}): ${(res.body || '').slice(0, 200)}`);
    }
  }

  console.log(`\n\n✓ Done — inserted/updated ${inserted} properties`);
}

main().catch(console.error);
