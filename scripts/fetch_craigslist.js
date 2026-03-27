/**
 * Fetches real rental listings from Craigslist RSS feeds (completely free, no auth).
 * Targets single-family homes and townhouses in the specified markets.
 *
 * Photos are automatically uploaded to ImageKit so they are permanently hosted
 * on your own CDN instead of pointing to Craigslist's expiring/hotlink-blocked URLs.
 *
 * Required env vars:
 *   SUPABASE_URL          — your Supabase project URL
 *   SUPABASE_SERVICE_KEY  — service role key (bypass RLS)
 *   IMAGEKIT_PRIVATE_KEY  — ImageKit private key (for photo upload)
 *
 * Run: node scripts/fetch_craigslist.js
 */

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');
const { canUseImageKit, uploadPhotosToImageKit } = require('./imagekit-helper');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const LANDLORD_ID   = '53c17b61-2deb-4ab4-bed5-31ad4da85d39';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('✗ SUPABASE_URL and SUPABASE_SERVICE_KEY env vars are required.');
  process.exit(1);
}

if (!canUseImageKit()) {
  console.warn('⚠  IMAGEKIT_PRIVATE_KEY / IMAGEKIT_URL_ENDPOINT not set.');
  console.warn('   Photos will be skipped. Set both env vars to enable photo upload.\n');
}

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
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && redirects > 0) {
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

    const title  = get('title');
    const desc   = get('description');
    const link   = get('link') || get('guid');
    const price  = extractPrice(title + ' ' + desc);
    const beds   = extractBeds(title + ' ' + desc);
    const baths  = extractBaths(title + ' ' + desc);
    const addr   = extractAddress(title + ' ' + desc);
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
  const m = text.match(/\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Ave|Blvd|Dr|Ln|Rd|Way|Ct|Pl|Cir|Ter|Trail|Loop)\b/i);
  return m ? m[0].trim() : null;
}

function extractPhotos(html) {
  const imgs = html.match(/https?:\/\/[^"'\s>]+\.(?:jpg|jpeg|png|webp)/gi) || [];
  return imgs.slice(0, 5);
}

// ── Determine property type ───────────────────────────────────────────────────

function getPropertyType(text) {
  const t = text.toLowerCase();
  if (t.includes('townhouse') || t.includes('townhome')) return 'townhouse';
  return 'house';
}

// ── Craigslist city subdomains ────────────────────────────────────────────────

const MARKETS = [
  { sub: 'houston',      city: 'Houston',          state: 'TX' },
  { sub: 'austin',       city: 'Austin',           state: 'TX' },
  { sub: 'sanantonio',   city: 'San Antonio',      state: 'TX' },
  { sub: 'dallas',       city: 'Dallas',           state: 'TX' },
  { sub: 'fortworth',    city: 'Fort Worth',       state: 'TX' },
  { sub: 'arlington',    city: 'Arlington',        state: 'TX' },
  { sub: 'atlanta',      city: 'Atlanta',          state: 'GA' },
  { sub: 'atlanta',      city: 'Marietta',         state: 'GA', area: 'mar' },
  { sub: 'charlotte',    city: 'Charlotte',        state: 'NC' },
  { sub: 'raleigh',      city: 'Raleigh',          state: 'NC' },
  { sub: 'triangle',     city: 'Durham',           state: 'NC' },
  { sub: 'nashville',    city: 'Nashville',        state: 'TN' },
  { sub: 'memphis',      city: 'Memphis',          state: 'TN' },
  { sub: 'knoxville',    city: 'Knoxville',        state: 'TN' },
  { sub: 'chattanooga',  city: 'Chattanooga',      state: 'TN' },
  { sub: 'stlouis',      city: 'St. Louis',        state: 'MO' },
  { sub: 'kansascity',   city: 'Kansas City',      state: 'MO' },
  { sub: 'albuquerque',  city: 'Albuquerque',      state: 'NM' },
  { sub: 'santafe',      city: 'Santa Fe',         state: 'NM' },
  { sub: 'phoenix',      city: 'Phoenix',          state: 'AZ' },
  { sub: 'tucson',       city: 'Tucson',           state: 'AZ' },
  { sub: 'denver',       city: 'Denver',           state: 'CO' },
  { sub: 'cosprings',    city: 'Colorado Springs', state: 'CO' },
  { sub: 'tampa',        city: 'Tampa',            state: 'FL' },
  { sub: 'orlando',      city: 'Orlando',          state: 'FL' },
  { sub: 'jacksonville', city: 'Jacksonville',     state: 'FL' },
  { sub: 'columbus',     city: 'Columbus',         state: 'OH' },
  { sub: 'cleveland',    city: 'Cleveland',        state: 'OH' },
  { sub: 'cincinnati',   city: 'Cincinnati',       state: 'OH' },
];

function mapToProperty(item, city, state) {
  if (!item.price) return null;
  if (item.beds && (item.beds < 1 || item.beds > 6)) return null;

  const titleText = (item.title + ' ' + item.desc).toLowerCase();
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
    photo_urls:           null,        // filled in after ImageKit upload below
    _raw_photos:          item.photos, // temp field — stripped before DB insert
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
  console.log(canUseImageKit()
    ? '✓ ImageKit configured — photos will be uploaded to your CDN\n'
    : '⚠  ImageKit not configured — properties will be inserted without photos\n'
  );

  let all = [];

  for (const m of MARKETS) {
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

  // ── Upload photos to ImageKit ─────────────────────────────────────────────
  if (canUseImageKit()) {
    console.log('\n=== Uploading photos to ImageKit ===');
    for (const prop of unique) {
      if (prop._raw_photos && prop._raw_photos.length > 0) {
        process.stdout.write(`  ${prop.id.slice(0, 8)} (${prop.city}): `);
        const ikUrls = await uploadPhotosToImageKit(prop._raw_photos, prop.id);
        prop.photo_urls = ikUrls.length > 0 ? ikUrls : null;
        process.stdout.write('\n');
        await sleep(300);
      }
    }
    console.log('✓ Photo upload complete');
  }

  // Strip temp field before DB insert
  const toInsert = unique.map(({ _raw_photos, ...rest }) => rest);

  // Sample
  console.log('\nSample:');
  console.log(JSON.stringify(toInsert[0], null, 2));

  // Insert in batches of 50
  console.log('\n=== Inserting into Supabase ===');
  let inserted = 0;
  const BATCH = 50;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const res = await supabaseUpsert(batch);
    if (res.status >= 200 && res.status < 300) {
      inserted += batch.length;
      process.stdout.write(`\r  Inserted: ${inserted}/${toInsert.length}`);
    } else {
      console.log(`\n  Batch failed (${res.status}): ${(res.body || '').slice(0, 200)}`);
    }
  }

  console.log(`\n\n✓ Done — inserted/updated ${inserted} properties`);
}

main().catch(console.error);
