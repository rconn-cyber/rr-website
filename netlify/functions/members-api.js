// netlify/functions/members-api.js
// Full CRUD for rr_members — JWT protected (same SESSION_SECRET as admin-events)
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, SESSION_SECRET

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
    // GET — list all members or single by id
    if (method === 'GET') {
      const params = event.queryStringParameters || {};
      let query = '/rr_members?order=last_name.asc,first_name.asc&limit=1000';
      if (params.id) query += `&id=eq.${params.id}`;
      const r = await sbFetch('GET', query);
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(r.data) };
    }

    const body = event.body ? JSON.parse(event.body) : {};

    // POST — create member
    if (method === 'POST') {
      const r = await sbFetch('POST', '/rr_members', body);
      return { statusCode: r.ok ? 201 : 400, headers: corsHeaders, body: JSON.stringify(r.data) };
    }

    // PUT — update member
    if (method === 'PUT') {
      const { id, created_at, updated_at, ...updates } = body;
      if (!id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'id required' }) };
      updates.updated_at = new Date().toISOString();
      const r = await sbFetch('PATCH', `/rr_members?id=eq.${id}`, updates);
      return { statusCode: r.ok ? 200 : 400, headers: corsHeaders, body: JSON.stringify(r.data) };
    }

    // DELETE — hard delete (use with caution)
    if (method === 'DELETE') {
      const { id } = body;
      if (!id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'id required' }) };
      const r = await sbFetch('DELETE', `/rr_members?id=eq.${id}`);
      return { statusCode: r.ok ? 200 : 400, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    console.error('members-api error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
