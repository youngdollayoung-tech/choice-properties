const https = require('https');

function get(path) {
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
      r.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { resolve(raw); } });
    }).on('error', reject);
  });
}

async function main() {
  const landlords = await get('/rest/v1/landlords?select=id,name,email&limit=10');
  console.log('Landlords:', JSON.stringify(landlords, null, 2));

  const sample = await get('/rest/v1/properties?select=landlord_id&limit=3');
  console.log('\nSample landlord_ids from properties:', JSON.stringify(sample));
}

main().catch(console.error);
