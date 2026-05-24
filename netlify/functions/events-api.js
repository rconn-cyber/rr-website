// netlify/functions/events-api.js
// CRUD for rr_events — public GET, admin-only POST/PUT/DELETE
// Env vars needed:
//   SUPABASE_URL        = https://qyoqyeaqacdjstvkonwx.supabase.co
//   SUPABASE_SERVICE_KEY = your service_role key (bypasses RLS)
//   EVENTS_ADMIN_PASSWORD = your chosen admin password

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PASS   = process.env.EVENTS_ADMIN_PASSWORD;

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

function checkAdmin(event) {
  const auth = event.headers['authorization'] || '';
  const pass = auth.replace('Bearer ', '').trim();
  return pass === ADMIN_PASS;
}

async function supabase(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const method = event.httpMethod;
  const params = event.queryStringParameters || {};

  try {

    // ── GET: list events (public) ──────────────────────────────────────────
    if (method === 'GET') {
      const isAdmin = checkAdmin(event);
      let query = '/rr_events?order=date_start.asc.nullslast,created_at.asc';

      if (!isAdmin) {
        // public: only active public events
        query += '&is_active=eq.true&is_public=eq.true';
      } else {
        // admin: all events regardless of state
        if (params.all !== 'true') query += '&is_active=eq.true';
      }

      if (params.id) query += `&id=eq.${params.id}`;

      const r = await supabase('GET', query);
      return { statusCode: 200, headers, body: JSON.stringify(r.data) };
    }

    // ── All write ops require admin ────────────────────────────────────────
    if (!checkAdmin(event)) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const body = event.body ? JSON.parse(event.body) : {};

    // ── POST: create event ─────────────────────────────────────────────────
    if (method === 'POST') {
      const r = await supabase('POST', '/rr_events', body);
      return { statusCode: r.ok ? 201 : 400, headers, body: JSON.stringify(r.data) };
    }

    // ── PUT: update event ──────────────────────────────────────────────────
    if (method === 'PUT') {
      if (!params.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) };
      // remove immutable fields
      const { id, created_at, ...updates } = body;
      const r = await supabase('PATCH', `/rr_events?id=eq.${params.id}`, updates);
      return { statusCode: r.ok ? 200 : 400, headers, body: JSON.stringify(r.data) };
    }

    // ── DELETE: archive event (soft delete) ───────────────────────────────
    if (method === 'DELETE') {
      if (!params.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) };
      const r = await supabase('PATCH', `/rr_events?id=eq.${params.id}`, { is_active: false });
      return { statusCode: r.ok ? 200 : 400, headers, body: JSON.stringify(r.data) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    console.error('events-api error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
