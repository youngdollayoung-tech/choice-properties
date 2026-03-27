/**
 * Reclassifies existing apartment listings as houses / townhouses
 * with realistic bedroom counts, bathrooms, sqft, and titles.
 * Photos, addresses, prices, and all other data are preserved.
 *
 * Run: node scripts/reclassify_properties.js
 */

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

// ── HTTP helpers ───────────────────────────────────────────────────────────────

function supabaseGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Accept': 'application/json'
      }
    };
    let raw = '';
    https.get(opts, r => {
      r.on('data', c => raw += c);
      r.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { resolve(raw); } });
    }).on('error', reject);
  });
}

function supabasePatch(id, fields) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(fields);
    const encodedId = encodeURIComponent(id);
    const parsed  = new URL(SUPABASE_URL + `/rest/v1/properties?id=eq.${encodedId}`);
    const opts = {
      method: 'PATCH',
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    let raw = '';
    const req = https.request(opts, r => {
      r.on('data', c => raw += c);
      r.on('end', () => resolve({ status: r.statusCode, body: raw || null, id }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Weighted random helpers ────────────────────────────────────────────────────

function seededRand(seed) {
  // Simple deterministic pseudo-random based on string seed
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  h = ((h >>> 16) ^ h) * 0x45d9f3b | 0;
  h = ((h >>> 16) ^ h) * 0x45d9f3b | 0;
  h = (h >>> 16) ^ h;
  return Math.abs(h) / 2147483647;
}

function pickWeighted(seed, options) {
  const r = seededRand(seed);
  let cumulative = 0;
  for (const { value, weight } of options) {
    cumulative += weight;
    if (r < cumulative) return value;
  }
  return options[options.length - 1].value;
}

function randInt(seed, min, max) {
  return Math.floor(seededRand(seed) * (max - min + 1)) + min;
}

// ── Reclassification logic ────────────────────────────────────────────────────

const TITLE_PREFIXES = [
  'Charming', 'Spacious', 'Cozy', 'Beautiful', 'Lovely', 'Stunning',
  'Renovated', 'Modern', 'Updated', 'Well-Maintained', 'Move-In Ready',
  'Gorgeous', 'Bright', 'Comfortable', 'Elegant', 'Quiet'
];

const HOUSE_FEATURES = [
  'with Backyard', 'with Garage', 'with Fenced Yard', 'near Top Schools',
  'in Great Neighborhood', 'with Large Yard', 'with Patio', 'with Deck',
  'with Carport', 'in Quiet Cul-de-sac', 'with Storage', 'with Open Floor Plan'
];

const TOWNHOUSE_FEATURES = [
  'with Rooftop Deck', 'with Attached Garage', 'End Unit', 'Corner Unit',
  'with Private Patio', 'with Modern Finishes', 'near Shopping', 'near Transit',
  'in Gated Community', 'with Community Pool', 'with Low HOA', 'with Balcony'
];

function buildTitle(id, beds, baths, type, city, state) {
  const prefix  = TITLE_PREFIXES[randInt(id + 'prefix', 0, TITLE_PREFIXES.length - 1)];
  const features = type === 'townhouse' ? TOWNHOUSE_FEATURES : HOUSE_FEATURES;
  const feature  = features[randInt(id + 'feat', 0, features.length - 1)];
  const bedsLabel  = beds  ? `${beds}BR` : '';
  const bathsLabel = baths ? `/${baths}BA` : '';
  const typeLabel  = type === 'townhouse' ? 'Townhouse' : 'Home';
  return `${prefix} ${bedsLabel}${bathsLabel} ${typeLabel} ${feature} — ${city}, ${state}`;
}

const AMENITY_POOLS = {
  house: [
    'Backyard', 'Garage', 'Driveway', 'Fenced Yard', 'Patio', 'Deck',
    'Washer/Dryer', 'Dishwasher', 'Central Air', 'Fireplace', 'Storage',
    'Sprinkler System', 'Garden', 'Dog-Friendly Yard', 'Basement', 'Attic'
  ],
  townhouse: [
    'Attached Garage', 'Private Patio', 'Rooftop Deck', 'Balcony',
    'Washer/Dryer In Unit', 'Dishwasher', 'Central Air', 'Community Pool',
    'Fitness Center', 'Gated Entry', 'Guest Parking', 'Package Lockers'
  ]
};

function pickAmenities(id, type, count) {
  const pool = AMENITY_POOLS[type];
  const picked = [];
  const used = new Set();
  for (let i = 0; i < count * 3 && picked.length < count; i++) {
    const idx = randInt(id + 'am' + i, 0, pool.length - 1);
    if (!used.has(idx)) { used.add(idx); picked.push(pool[idx]); }
  }
  return picked;
}

function reclassify(prop) {
  const id = prop.id;

  // Property type: 65% house, 35% townhouse
  const property_type = pickWeighted(id + 'type', [
    { value: 'house',     weight: 0.65 },
    { value: 'townhouse', weight: 0.35 }
  ]);

  // Bedrooms: 1(8%), 2(22%), 3(38%), 4(22%), 5(10%)
  const bedrooms = pickWeighted(id + 'beds', [
    { value: 1, weight: 0.08 },
    { value: 2, weight: 0.22 },
    { value: 3, weight: 0.38 },
    { value: 4, weight: 0.22 },
    { value: 5, weight: 0.10 }
  ]);

  // Bathrooms: based on bedrooms
  const bathMap = {
    1: [{ value: 1,   weight: 0.7  }, { value: 1.5, weight: 0.3  }],
    2: [{ value: 1,   weight: 0.2  }, { value: 1.5, weight: 0.3  }, { value: 2, weight: 0.5 }],
    3: [{ value: 2,   weight: 0.5  }, { value: 2.5, weight: 0.3  }, { value: 3, weight: 0.2 }],
    4: [{ value: 2,   weight: 0.2  }, { value: 2.5, weight: 0.3  }, { value: 3, weight: 0.3 }, { value: 3.5, weight: 0.2 }],
    5: [{ value: 3,   weight: 0.4  }, { value: 3.5, weight: 0.3  }, { value: 4, weight: 0.3 }]
  };
  const bathrooms = pickWeighted(id + 'bath', bathMap[bedrooms]);

  // Square footage by bedroom count
  const sqftRanges = { 1: [650, 950], 2: [950, 1400], 3: [1350, 2100], 4: [2000, 2800], 5: [2600, 3800] };
  const [sqMin, sqMax] = sqftRanges[bedrooms];
  const square_footage = randInt(id + 'sqft', sqMin, sqMax);

  // Lot size (houses only)
  const lot_size_sqft = property_type === 'house'
    ? randInt(id + 'lot', 3500, 12000)
    : null;

  // Garage spaces
  const garage_spaces = property_type === 'house'
    ? pickWeighted(id + 'gar', [{ value: 0, weight: 0.2 }, { value: 1, weight: 0.4 }, { value: 2, weight: 0.4 }])
    : pickWeighted(id + 'gar', [{ value: 0, weight: 0.3 }, { value: 1, weight: 0.6 }, { value: 2, weight: 0.1 }]);

  // Year built
  const year_built = randInt(id + 'yr', 1970, 2020);

  // Floors
  const floors = property_type === 'townhouse'
    ? pickWeighted(id + 'fl', [{ value: 2, weight: 0.6 }, { value: 3, weight: 0.4 }])
    : pickWeighted(id + 'fl', [{ value: 1, weight: 0.5 }, { value: 2, weight: 0.5 }]);

  // Pets
  const pets_allowed = seededRand(id + 'pet') > 0.45;

  // Amenities
  const amenities = pickAmenities(id, property_type, randInt(id + 'namc', 4, 8));

  // Appliances
  const baseAppliances = ['Refrigerator', 'Stove', 'Oven', 'Dishwasher'];
  if (seededRand(id + 'mw') > 0.4) baseAppliances.push('Microwave');
  if (seededRand(id + 'wd') > 0.5) baseAppliances.push('Washer', 'Dryer');

  // Flooring
  const flooring = pickWeighted(id + 'floor', [
    { value: 'Hardwood',     weight: 0.30 },
    { value: 'Carpet',       weight: 0.20 },
    { value: 'Luxury Vinyl', weight: 0.25 },
    { value: 'Tile',         weight: 0.15 },
    { value: 'Mixed',        weight: 0.10 }
  ]);

  // Heating / cooling
  const heating_type = pickWeighted(id + 'heat', [
    { value: 'Central',    weight: 0.60 },
    { value: 'Forced Air', weight: 0.25 },
    { value: 'Electric',   weight: 0.15 }
  ]);
  const cooling_type = 'Central Air';

  // Laundry
  const laundry_type = pickWeighted(id + 'laund', [
    { value: 'In Unit',   weight: 0.55 },
    { value: 'Hook-Ups',  weight: 0.30 },
    { value: 'Community', weight: 0.15 }
  ]);

  // Parking
  const parking = property_type === 'house'
    ? (garage_spaces > 0 ? 'Garage' : 'Driveway')
    : pickWeighted(id + 'park', [
        { value: 'Attached Garage', weight: 0.5 },
        { value: 'Assigned Spot',   weight: 0.3 },
        { value: 'Street',          weight: 0.2 }
      ]);

  // Lease terms
  const leaseTermRaw = pickWeighted(id + 'lease', [
    { value: '12 months',      weight: 0.60 },
    { value: '6-12 months',    weight: 0.20 },
    { value: 'Month-to-month', weight: 0.10 },
    { value: '24 months',      weight: 0.10 }
  ]);
  const lease_terms = [leaseTermRaw];

  const title = buildTitle(id, bedrooms, bathrooms, property_type, prop.city, prop.state);

  return {
    id,
    property_type,
    bedrooms,
    bathrooms,
    half_bathrooms: 0,
    square_footage,
    lot_size_sqft,
    garage_spaces,
    year_built,
    floors,
    pets_allowed,
    amenities,
    appliances: baseAppliances,
    flooring: [flooring],
    heating_type,
    cooling_type,
    laundry_type,
    parking,
    lease_terms,
    minimum_lease_months: leaseTermRaw === 'Month-to-month' ? 1 : leaseTermRaw === '6-12 months' ? 6 : 12,
    title,
    updated_at: new Date().toISOString()
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Choice Properties — Property Reclassifier ===\n');

  // Fetch all active properties with pagination
  console.log('Fetching existing properties...');
  let props = [], offset = 0;
  const PAGE = 1000;
  while (true) {
    const page = await supabaseGet(
      `/rest/v1/properties?status=eq.active&select=id,city,state&limit=${PAGE}&offset=${offset}`
    );
    if (!Array.isArray(page)) { console.log('Error fetching page:', JSON.stringify(page)); break; }
    props.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  if (!props.length) { console.log('No properties found.'); return; }
  console.log(`Fetched ${props.length} properties\n`);

  // Reclassify each
  const updated = props.map(reclassify);

  // Show distribution preview
  const typeCounts = {}, bedCounts = {};
  updated.forEach(p => {
    typeCounts[p.property_type] = (typeCounts[p.property_type] || 0) + 1;
    bedCounts[p.bedrooms]       = (bedCounts[p.bedrooms]       || 0) + 1;
  });
  console.log('Distribution preview:');
  console.log('  Types:', JSON.stringify(typeCounts));
  console.log('  Beds:', JSON.stringify(bedCounts));
  console.log();

  // PATCH in parallel batches of 20
  const CONCURRENCY = 20;
  let done = 0, failed = 0;
  for (let i = 0; i < updated.length; i += CONCURRENCY) {
    const batch   = updated.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(p => supabasePatch(p.id, p)));
    for (const res of results) {
      if (res.status >= 200 && res.status < 300) {
        done++;
      } else {
        failed++;
        if (failed <= 3) console.log(`\n  PATCH failed (${res.status}) for ${res.id}: ${(res.body || '').slice(0, 200)}`);
      }
    }
    process.stdout.write(`\r  Updated: ${done} | Failed: ${failed} / ${updated.length}`);
  }

  console.log(`\n\n✓ Done — reclassified ${done} properties as houses and townhouses`);
  console.log('  Refresh /listings.html to see the changes.');
}

main().catch(console.error);
