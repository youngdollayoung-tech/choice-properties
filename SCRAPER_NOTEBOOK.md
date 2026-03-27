# RentProgress Scraper — Notebook Reference

rentprogress.com is built on Adobe AEM and requires JavaScript rendering.
ScraperAPI's **free tier** cannot access this domain (premium proxy required).
Scraping is done via the Replit Agent's code_execution `webFetch` tool, which
uses an internal headless browser.

## To re-seed the database

### Step 1 — Run these two blocks in a Replit Agent code_execution notebook

**Block A — Collect listing URLs (run first):**

```javascript
const MARKETS = [
  { market: 'charlotte-nc',     displayCity: 'Charlotte',     state: 'NC' },
  { market: 'st-louis-mo',      displayCity: 'St. Louis',     state: 'MO' },
  { market: 'kansas-city-mo',   displayCity: 'Kansas City',   state: 'MO' },
  { market: 'san-antonio-tx',   displayCity: 'San Antonio',   state: 'TX' },
  { market: 'oklahoma-city-ok', displayCity: 'Oklahoma City', state: 'OK' },
];
const marketUrls = {};
for (const { market, displayCity } of MARKETS) {
  const url = `https://rentprogress.com/houses-for-rent/market-${market}/page-1/rows-20/search-results/`;
  console.log(`Fetching ${displayCity}...`);
  const result = await webFetch({ url });
  const seen = new Set();
  const urls = [];
  const re = /\[([^\]]*)\]\((https:\/\/rentprogress\.com\/property-details\/[^)]+)\)/g;
  let m;
  while ((m = re.exec(result.markdown)) !== null) {
    if (!seen.has(m[2])) { seen.add(m[2]); urls.push(m[2]); }
  }
  marketUrls[market] = urls.slice(0, 10);
  console.log(`  → ${marketUrls[market].length} URLs`);
}
const allUrls = Object.values(marketUrls).flat();
console.log(`Total: ${allUrls.length}`);
```

**Block B — Fetch details, parse, write JSON (run after Block A):**

```javascript
function titleCase(s) { return s.split('-').map(w=>w[0].toUpperCase()+w.slice(1)).join(' '); }
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }
function parseUrl(url) {
  const m = url.match(/\/property-details\/([^/]+)\/([^/]+)\/([a-z]{2})\/(\d{5})\/(\d+)/);
  if (!m) return null;
  return { addrSlug:m[1], citySlug:m[2], stateCode:m[3].toUpperCase(), zip:m[4], propId:m[5] };
}
function parseDetailMd(md, url) {
  const p = parseUrl(url); if (!p) return null;
  const { addrSlug, citySlug, stateCode, zip, propId } = p;
  let street = titleCase(addrSlug);
  const h1 = md.match(/^#\s+(.+)$/m);
  if (h1) { const t = h1[1].replace(/\s+/g,' ').trim(); const ci=t.indexOf(','); street=ci>0?t.slice(0,ci).trim():t.split(/\s{2,}/)[0].trim(); }
  const pm = md.match(/\$([\d,]+)\s*\/\s*mo/i)||md.match(/\$([\d,]+)/);
  if (!pm) return null;
  const price = parseInt(pm[1].replace(/,/g,''));
  if (price<400||price>20000) return null;
  const bm=md.match(/(\d)\s*Beds?(?:\s|$)/im); const btm=md.match(/([\d.]+)\s*Baths?(?:\s|$)/im); const sm=md.match(/([\d,]+)\s*Sq\s*Ft/i);
  const beds=bm?parseInt(bm[1]):null; if (!beds) return null;
  const baths=btm?parseFloat(btm[1]):null; const sqft=sm?parseInt(sm[1].replace(/,/g,'')):null;
  const type=/Townhome|Townhouse/i.test(md.slice(0,4000))?'townhouse':'house';
  let availDate=new Date().toISOString().slice(0,10);
  const lm=md.match(/Lease\s*start\s*after\s*(\d{1,2})\/(\d{1,2})/i);
  if (lm) { const d=new Date(new Date().getFullYear()+'-'+lm[1].padStart(2,'0')+'-'+lm[2].padStart(2,'0')); if(!isNaN(d.getTime())) availDate=d.toISOString().slice(0,10); }
  const photoRe=/!\[[^\]]*\]\((https:\/\/photos\.rentprogress\.com\/WebPhotos\/[^)]+\.jpg)\)/gi;
  const seenP=new Set(); const photos=[]; let pm2;
  while((pm2=photoRe.exec(md))!==null) {
    const u=pm2[1].replace(/-xs\.jpg$/i,'-md.jpg');
    if (/FloorPlan/i.test(u)) continue;
    const key=u.replace(/-(?:xs|sm|md|lg|xl)\.jpg$/i,'');
    if (!seenP.has(key)) { seenP.add(key); photos.push(u); }
    if (photos.length>=5) break;
  }
  const AMENS=['Central Air/Heat','Garage','Walk-In Closet','Stainless Steel Appliances','Hard Surface Flooring','Smart Home','Fenced Yard','Pool','Fireplace','Washer/Dryer','Dishwasher','2 Story','3 Story','Patio','Deck','Backyard','Porch'];
  const amenities=AMENS.filter(kw=>new RegExp(kw.replace(/[/]/g,'\\/'), 'i').test(md));
  const pets=/Pet\s*Friendly/i.test(md);
  const id='rp_'+propId;
  const city=titleCase(citySlug); const state=stateCode;
  const typeLabel=type==='townhouse'?'Townhouse':'Home';
  const bathLabel=baths?`/${baths}BA`:'';
  const title=`${beds}BR${bathLabel} ${typeLabel} for Rent — ${street}, ${city}, ${state}`;
  return { id, propId, city, state, zip, street, type, beds, baths, sqft, price, availDate, photos, amenities, pets, title };
}

const LANDLORD_ID = '53c17b61-2deb-4ab4-bed5-31ad4da85d39';
const properties = [];
for (let i=0; i<allUrls.length; i++) {
  const url=allUrls[i]; const parts=parseUrl(url);
  process.stdout.write(`[${i+1}/${allUrls.length}] ${parts?.propId} `);
  try {
    const res=await webFetch({url}); const prop=parseDetailMd(res.markdown,url);
    if (prop) { properties.push({prop,detailUrl:url}); process.stdout.write(`✓ $${prop.price}/mo ${prop.beds}BR ${prop.city}\n`); }
    else process.stdout.write('✗ parse failed\n');
  } catch(e) { process.stdout.write(`✗ ${e.message}\n`); }
  await sleep(800);
}
const rows = properties.map(({prop,detailUrl})=>({
  id:prop.id, landlord_id:LANDLORD_ID, status:'active', title:prop.title,
  description:`Progress Residential rental ${prop.type} in ${prop.city}, ${prop.state}. `+(prop.amenities.length?prop.amenities.slice(0,4).join(', ')+'.':'Move-in ready.'),
  address:prop.street, city:prop.city, state:prop.state, zip:prop.zip, property_type:prop.type,
  bedrooms:prop.beds, bathrooms:prop.baths, square_footage:prop.sqft||null,
  monthly_rent:prop.price, security_deposit:prop.price, pets_allowed:prop.pets,
  smoking_allowed:false, amenities:prop.amenities.length?prop.amenities:null,
  available_date:prop.availDate, minimum_lease_months:12, lease_terms:['12 months'],
  virtual_tour_url:detailUrl, photo_urls:prop.photos.length?prop.photos:null,
  created_at:new Date().toISOString(), updated_at:new Date().toISOString(),
}));
const { writeFileSync } = await import('fs');
writeFileSync('/tmp/rp_properties.json', JSON.stringify(rows, null, 2));
console.log(`Wrote ${rows.length} rows to /tmp/rp_properties.json`);
```

### Step 2 — From the shell (where secrets are available)

```bash
node scripts/delete_properties.js
node scripts/fetch_rentprogress.js
```

## ScraperAPI note

The key `SCRAPERAPI_KEY` is stored in Replit Secrets. It will work with this
scraper once the account is upgraded to a plan with **premium residential proxies**.
Until then, the webFetch notebook approach above is the only working method.
