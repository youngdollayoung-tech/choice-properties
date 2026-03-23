// ============================================================
// Choice Properties — ImageKit Upload Client
// js/imagekit.js
//
// All photo uploads (property photos, avatars) go through
// this module. It calls the Supabase Edge Function which
// holds the ImageKit private key securely server-side.
//
// Usage:
//   import { uploadToImageKit } from '../js/imagekit.js';
//
//   const url = await uploadToImageKit(file, {
//     folder:   '/properties/PROP-ABC123',
//     onProgress: (pct) => console.log(pct + '%'),
//   });
// ============================================================

/**
 * Convert a File object to a base64 data URI string.
 * ImageKit's upload API accepts base64 strings directly.
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result); // full data URI
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Upload a single file to ImageKit via the Supabase Edge Function.
 *
 * @param {File}   file             - The file to upload
 * @param {object} options
 * @param {string} options.folder        - ImageKit folder path, e.g. '/properties/PROP-XYZ'
 * @param {function} options.onProgress  - Optional callback(percent: number)
 * @param {string} options.supabaseUrl   - CONFIG.SUPABASE_URL
 * @param {string} options.anonKey       - CONFIG.SUPABASE_ANON_KEY
 *
 * @returns {Promise<string>} The ImageKit CDN URL of the uploaded file
 */
export async function uploadToImageKit(file, options = {}) {
  const {
    folder      = '/properties',
    onProgress  = null,
    supabaseUrl = CONFIG.SUPABASE_URL,
    anonKey     = CONFIG.SUPABASE_ANON_KEY,
  } = options;

  // Resolve the authenticated user's JWT so the Edge Function can verify
  // the caller is a real logged-in user (not just the public anon key).
  const session = await window.CP?.Auth?.getSession?.();
  const userToken = session?.access_token || anonKey;

  // Validate file type client-side
  if (!file.type.startsWith('image/')) {
    throw new Error(`${file.name} is not an image file.`);
  }

  // Soft size cap — warn but still upload (ImageKit handles large files fine)
  if (file.size > 20 * 1024 * 1024) {
    throw new Error(`${file.name} exceeds 20MB. Please use a smaller file.`);
  }

  // Signal start (10%)
  onProgress?.(10);

  // Convert to base64
  const base64DataUri = await fileToBase64(file);
  onProgress?.(30);

  // Build a clean filename
  const ext      = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const safeName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;

  onProgress?.(50);

  // Call the Edge Function — use the authenticated user JWT, not the anon key,
  // so the server-side auth check can verify a real user session.
  const res = await fetch(`${supabaseUrl}/functions/v1/imagekit-upload`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':        anonKey,
      'Authorization': `Bearer ${userToken}`,
    },
    body: JSON.stringify({
      fileBase64: base64DataUri,
      fileName:   safeName,
      folder,
    }),
  });

  onProgress?.(85);

  const data = await res.json();

  if (!data.success) {
    throw new Error(data.error || 'Upload failed');
  }

  onProgress?.(100);
  return data.url;
}

/**
 * Upload multiple files in sequence with aggregate progress.
 *
 * @param {File[]}  files
 * @param {object}  options  - Same as uploadToImageKit, plus:
 * @param {function} options.onFileProgress  - callback(fileIndex, percent)
 * @param {function} options.onTotalProgress - callback(overallPercent)
 *
 * @returns {Promise<string[]>} Array of ImageKit CDN URLs in order
 */
export async function uploadMultipleToImageKit(files, options = {}) {
  const { onFileProgress, onTotalProgress, ...baseOptions } = options;
  const urls = [];

  for (let i = 0; i < files.length; i++) {
    const url = await uploadToImageKit(files[i], {
      ...baseOptions,
      onProgress: (pct) => {
        onFileProgress?.(i, pct);
        const overall = Math.round(((i + pct / 100) / files.length) * 100);
        onTotalProgress?.(overall);
      },
    });
    urls.push(url);
  }

  return urls;
}
