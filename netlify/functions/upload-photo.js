// netlify/functions/upload-photo.js
// Accepts multipart form data, uploads to Supabase Storage event-photos bucket
// Returns the public URL

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PASS   = process.env.EVENTS_ADMIN_PASSWORD;

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };

  const auth = (event.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (auth !== ADMIN_PASS) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    // Body is base64-encoded binary from the browser
    const body = JSON.parse(event.body);
    const { filename, contentType, data } = body;  // data = base64 string

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
