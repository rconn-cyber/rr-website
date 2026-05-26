// netlify/functions/upload-photo.js
// Accepts base64 image, uploads to Supabase Storage event-photos bucket
// Auth: verifies JWT signed by SESSION_SECRET (same as admin-events.js)

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function verifyToken(token) {
  if (!token || !SESSION_SECRET) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  if (sig !== expected) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return Date.now() < exp;
  } catch { return false; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };

  const token = (event.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!verifyToken(token)) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const { filename, contentType, data } = JSON.parse(event.body);
    const buffer = Buffer.from(data, 'base64');
    const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    const storagePath = `events/${safeName}`;

    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/event-photos/${storagePath}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': contentType || 'image/jpeg',
        'x-upsert': 'true'
      },
      body: buffer
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: err }) };
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/event-photos/${storagePath}`;
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: publicUrl, path: storagePath })
    };

  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
