/**
 * Choice Properties — ImageKit Upload Helper (Node.js / scraper use)
 *
 * Uploads a photo from a source URL directly to ImageKit using the
 * ImageKit Upload API. ImageKit fetches the image server-side so we
 * never have to download it ourselves first.
 *
 * Required env vars:
 *   IMAGEKIT_PRIVATE_KEY   — from ImageKit → Developer Options
 *   IMAGEKIT_URL_ENDPOINT  — e.g. https://ik.imagekit.io/yourID
 *
 * Usage:
 *   const { uploadPhotoToImageKit, canUseImageKit } = require('./imagekit-helper');
 *   const ikUrl = await uploadPhotoToImageKit(sourceUrl, 'scraped/my-photo.jpg');
 *   // Returns the ImageKit CDN URL, or null if upload failed / not configured.
 */

const https = require('https');
const http  = require('http');

const IMAGEKIT_PRIVATE_KEY = process.env.IMAGEKIT_PRIVATE_KEY;

/**
 * Returns true if the ImageKit private key is present in env.
 * The URL endpoint is not needed for uploads — ImageKit returns the full
 * CDN URL in the upload API response.
 */
function canUseImageKit() {
  return !!IMAGEKIT_PRIVATE_KEY;
}

/**
 * Download raw bytes from a URL and return as a Buffer.
 * Follows up to 3 redirects.
 */
function downloadBuffer(url, redirects = 3) {
  return new Promise((resolve) => {
    const lib    = url.startsWith('https') ? https : http;
    let parsed;
    try { parsed = new URL(url); } catch (_) { return resolve(null); }
    const opts   = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      headers:  {
        'User-Agent': 'Mozilla/5.0 (compatible; ChoicePropertiesBot/1.0)',
        'Accept':     'image/*,*/*',
        'Referer':    parsed.origin + '/',
      },
    };
    let resolved = false;
    const done = (val) => { if (!resolved) { resolved = true; resolve(val); } };

    const req = lib.get(opts, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return downloadBuffer(res.headers.location, redirects - 1).then(done);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return done(null);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => done(Buffer.concat(chunks)));
      res.on('error', () => done(null));
    });
    req.on('error', () => done(null));
    req.setTimeout(10000, () => { req.destroy(); done(null); });
  });
}

/**
 * Upload a single photo to ImageKit.
 *
 * @param {string} sourceUrl   — original URL (Redfin, Craigslist, etc.)
 * @param {string} fileName    — filename to store in ImageKit, e.g. "prop-abc-0.jpg"
 * @param {string} [folder]    — ImageKit folder, default "/properties/scraped"
 * @returns {Promise<string|null>} ImageKit CDN URL, or null on failure
 */
async function uploadPhotoToImageKit(sourceUrl, fileName, folder = '/properties/scraped') {
  if (!canUseImageKit()) return null;
  if (!sourceUrl) return null;

  // ── POST to ImageKit Upload API with URL as `file` ───────────────────────
  // ImageKit fetches the image server-side — no local download needed,
  // no IP-blocking issues from Zillow/Redfin.
  const authHeader = 'Basic ' + Buffer.from(IMAGEKIT_PRIVATE_KEY + ':').toString('base64');

  const body = new URLSearchParams();
  body.append('file',            sourceUrl);   // pass URL directly
  body.append('fileName',        fileName);
  body.append('folder',          folder);
  body.append('useUniqueFileName', 'true');

  const bodyStr = body.toString();

  return new Promise((resolve) => {
    const opts = {
      hostname: 'upload.imagekit.io',
      path:     '/api/v1/files/upload',
      method:   'POST',
      headers:  {
        'Authorization': authHeader,
        'Content-Type':  'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    let raw = '';
    const req = https.request(opts, (res) => {
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json.url) {
            resolve(json.url);
          } else {
            console.warn(`  ⚠ ImageKit upload failed for ${fileName}:`, json.message || raw.slice(0, 120));
            resolve(null);
          }
        } catch (_) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(20000, () => { req.destroy(); resolve(null); });
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Upload an array of photo URLs to ImageKit in sequence.
 * Skips any that fail — returns only successful ImageKit URLs.
 *
 * @param {string[]} sourceUrls
 * @param {string}   propertyId  — used to build unique filenames
 * @param {string}   [folder]
 * @returns {Promise<string[]>}
 */
async function uploadPhotosToImageKit(sourceUrls, propertyId, folder = '/properties/scraped') {
  if (!canUseImageKit() || !sourceUrls || sourceUrls.length === 0) return [];

  const results = [];
  for (let i = 0; i < sourceUrls.length; i++) {
    const src  = sourceUrls[i];
    const ext  = (src.split('?')[0].split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const name = `${propertyId}-${i}.${ext}`;
    const url  = await uploadPhotoToImageKit(src, name, folder);
    if (url) {
      results.push(url);
      process.stdout.write(` ✓`);
    } else {
      process.stdout.write(` ✗`);
    }
  }
  return results;
}

module.exports = { canUseImageKit, uploadPhotoToImageKit, uploadPhotosToImageKit };
