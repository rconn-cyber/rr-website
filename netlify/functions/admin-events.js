const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

function verifyToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET)
    .update(payload).digest('base64url');
  if (sig !== expected) return false;
  const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return Date.now() < exp;
}

async function sbFetch(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };

  if (!verifyToken(event.headers.authorization)) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const method = event.httpMethod;

  try {
    if (method === 'GET') {
      const r = await sbFetch('GET', '/rr_events?order=date_start.asc.nullslast,created_at.asc');
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(r.data) };
    }

    const body = event.body ? JSON.parse(event.body) : {};

    if (method === 'POST') {
      const r = await sbFetch('POST', '/rr_events', body);
      return { statusCode: r.ok ? 201 : 400, headers: corsHeaders, body: JSON.stringify(r.data) };
    }

    if (method === 'PUT') {
      const { id, created_at, ...updates } = body;
      if (!id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'id required' }) };
      const r = await sbFetch('PATCH', `/rr_events?id=eq.${id}`, updates);
      return { statusCode: r.ok ? 200 : 400, headers: corsHeaders, body: JSON.stringify(r.data) };
    }

    if (method === 'DELETE') {
      const { id } = body;
      if (!id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'id required' }) };
      const r = await sbFetch('PATCH', `/rr_events?id=eq.${id}`, { is_active: false });
      return { statusCode: r.ok ? 200 : 400, headers: corsHeaders, body: JSON.stringify(r.data) };
    }

    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
