const https = require('https');

function get(path) {
  return new Promise((resolve, reject) => {
    const url = new URL('https://api.rentcast.io/v1' + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'X-Api-Key': process.env.RENTCAST_API_KEY,
        'accept': 'application/json'
      }
    };
    let raw = '';
    https.get(options, r => {
      console.log('Status:', r.statusCode);
      r.on('data', c => raw += c);
      r.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { resolve(raw); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== Testing Rentcast API ===\n');

  // Test: fetch single-family rentals in Houston, TX
  const result = await get('/listings/rental/long-term?city=Houston&state=TX&propertyType=Single%20Family&limit=5');

  if (result.error || typeof result === 'string') {
    console.log('Error response:', result);
    return;
  }

  const listings = Array.isArray(result) ? result : (result.data || result.listings || result.results || [result]);
  console.log('Response type:', typeof result, Array.isArray(result) ? 'array' : '');
  console.log('Count returned:', listings.length);

  if (listings.length > 0) {
    console.log('\n=== First listing keys ===');
    console.log(Object.keys(listings[0]).join(', '));
    console.log('\n=== First listing sample ===');
    console.log(JSON.stringify(listings[0], null, 2));
  } else {
    console.log('\nFull response:');
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch(console.error);
