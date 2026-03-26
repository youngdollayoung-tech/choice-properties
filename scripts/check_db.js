const https = require('https');

function makeReq(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(process.env.SUPABASE_URL + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + process.env.SUPABASE_ANON_KEY
      }
    };
    let raw = '';
    https.get(options, r => {
      r.on('data', c => raw += c);
      r.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { resolve(raw); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== Checking full database ===\n');

  const all = await makeReq('/rest/v1/properties?select=property_type,bedrooms,city,state,status&limit=5000');
  console.log('Total rows returned:', all.length);

  const byStatus = {}, byType = {}, byBeds = {}, byCityState = {};
  all.forEach(p => {
    const s = p.status || 'null';
    byStatus[s] = (byStatus[s] || 0) + 1;
    const t = p.property_type || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
    const b = String(p.bedrooms ?? 'null');
    byBeds[b] = (byBeds[b] || 0) + 1;
    const cs = (p.city || '?') + ', ' + (p.state || '?');
    byCityState[cs] = (byCityState[cs] || 0) + 1;
  });

  console.log('\nBy status:');
  Object.entries(byStatus).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${k}: ${v}`));
  console.log('\nBy property_type:');
  Object.entries(byType).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${k}: ${v}`));
  console.log('\nBy bedrooms:');
  Object.entries(byBeds).sort((a,b)=>Number(a[0])-Number(b[0])).forEach(([k,v])=>console.log(`  ${k} bed: ${v}`));
  console.log('\nAll cities (sorted by count):');
  Object.entries(byCityState).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${k}: ${v}`));

  // Sample one full property record
  const sample = await makeReq('/rest/v1/properties?select=*&limit=1');
  console.log('\n=== Sample property columns ===');
  if(sample.length) console.log(Object.keys(sample[0]).join(', '));
}

main().catch(console.error);
