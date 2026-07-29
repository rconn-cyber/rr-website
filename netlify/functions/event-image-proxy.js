// netlify/functions/event-image-proxy.js
// Proxies WA event images that require authentication.
// Usage: /.netlify/functions/event-image-proxy?url=<encoded-wa-image-url>
// On first call: fetches from WA, uploads to Supabase Storage, redirects to public URL.
// On subsequent calls: Supabase Storage URL is already stored, this proxy isn't called.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WA_CLIENT_ID = process.env.WA_CLIENT_ID;
const WA_CLIENT_SECRET = process.env.WA_CLIENT_SECRET;
const WA_ACCOUNT_ID = process.env.WA_ACCOUNT_ID;
const WA_BASE = 'https://api.wildapricot.org/v2.2';

const HEADERS = { 'Access-Control-Allow-Origin': '*' };

async function getWAToken() {
  const creds = Buffer.from(`APIKEY:${WA_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://oauth.wildapricot.org/auth/token', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + creds, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=auto'
  });
  const d = await res.json();
  return d.access_token;
}

exports.handler = async (event) => {
  const rawUrl = event.queryStringParameters?.url;
  if (!rawUrl) return { statusCode: 400, headers: HEADERS, body: 'Missing url param' };

  const imageUrl = decodeURIComponent(rawUrl);

  // Derive a stable storage path from the URL
  const hash = imageUrl.replace(/[^a-z0-9]/gi, '_').slice(-80);
  const ext = imageUrl.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || 'jpg';
  const storagePath = `event-images/${hash}.${ext}`;

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Check if already cached in Supabase Storage
  const { data: existing } = supabase.storage.from('museum-images').getPublicUrl(storagePath);
  if (existing?.publicUrl) {
    // Try a HEAD to see if it actually exists
    try {
      const check = await fetch(existing.publicUrl, { method: 'HEAD' });
      if (check.ok) {
        return { statusCode: 302, headers: { ...HEADERS, Location: existing.publicUrl }, body: '' };
      }
    } catch {}
  }

  // Fetch from WA with auth
  try {
    const waToken = await getWAToken();
    const imgRes = await fetch(imageUrl, {
      headers: { 'Authorization': 'Bearer ' + waToken }
    });
    if (!imgRes.ok) {
      return { statusCode: imgRes.status, headers: HEADERS, body: 'WA fetch failed: ' + imgRes.status };
    }

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    // Upload to Supabase Storage
    const { error } = await supabase.storage
      .from('museum-images')
      .upload(storagePath, buffer, { contentType, upsert: true });

    if (error) {
      // Fall back: stream directly
      return {
        statusCode: 200,
        headers: { ...HEADERS, 'Content-Type': contentType },
        body: buffer.toString('base64'),
        isBase64Encoded: true
      };
    }

    const { data: pub } = supabase.storage.from('museum-images').getPublicUrl(storagePath);
    return { statusCode: 302, headers: { ...HEADERS, Location: pub.publicUrl }, body: '' };

  } catch (err) {
    return { statusCode: 500, headers: HEADERS, body: err.message };
  }
};
