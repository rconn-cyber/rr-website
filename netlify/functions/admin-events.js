// netlify/functions/admin-events.js
// Pure Supabase CRUD for rr_events — no WA sync
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, EVENTS_ADMIN_PASSWORD, SESSION_SECRET

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PASS   = process.env.EVENTS_ADMIN_PASSWORD;
const JWT_SECRET   = process.env.SESSION_SECRET || process.env.JWT_SECRET || ADMIN_PASS;

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

// ── JWT helpers ────────────────────────────────────────────────────────────
const crypto = require('crypto');

function makeToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 8 * 3600_000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  if (expected !== sig) return false;
  const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return Date.now() < exp;
}

function checkAuth(event) {
  const auth = (event.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (auth === ADMIN_PASS) return true;   // raw password (login step)
  return verifyToken(auth);               // JWT token (subsequent calls)
}

// ── Supabase fetch ─────────────────────────────────────────────────────────
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

// ── Storage upload ─────────────────────────────────────────────────────────
async function uploadPhoto(base64Data, mimeType, filename) {
  const buffer = Buffer.from(base64Data, 'base64');
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/event-photos/${filename}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': mimeType,
      'x-upsert': 'true'
    },
    body: buffer
  });
  if (!res.ok) throw new Error(`Storage upload failed: ${res.status}`);
  return `${SUPABASE_URL}/storage/v1/object/public/event-photos/${filename}`;
}

// ── Handler ────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };

  const method = event.httpMethod;
  const params = event.queryStringParameters || {};

  const respond = (status, data) => ({
    statusCode: status,
    headers: corsHeaders,
    body: JSON.stringify(data)
  });

  try {

    // ── POST /login ─────────────────────────────────────────────────────
    if (method === 'POST' && params.action === 'login') {
      const { password } = JSON.parse(event.body || '{}');
      if (password !== ADMIN_PASS) return respond(401, { error: 'Invalid password' });
      return respond(200, { token: makeToken() });
    }

    // ── GET: list all events (admin only) ───────────────────────────────
    if (method === 'GET') {
      if (!checkAuth(event)) return respond(401, { error: 'Unauthorized' });
      let query = '/rr_events?order=date_start.asc.nullslast,created_at.asc';
      if (params.all !== 'true') query += '&is_active=eq.true';
      if (params.id) query += `&id=eq.${params.id}`;
      const r = await sbFetch('GET', query);
      return respond(r.ok ? 200 : r.status, r.data);
    }

    // All remaining methods require auth
    if (!checkAuth(event)) return respond(401, { error: 'Unauthorized' });

    const body = event.body ? JSON.parse(event.body) : {};

    // ── POST: create event ──────────────────────────────────────────────
    if (method === 'POST') {
      // Handle photo uploads if present
      if (body._photos) {
        const urls = [];
        for (const p of body._photos) {
          const ext = p.mimeType.split('/')[1] || 'jpg';
          const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const url = await uploadPhoto(p.data, p.mimeType, filename);
          urls.push(url);
        }
        body.photo_urls = [...(body.photo_urls || []), ...urls];
        delete body._photos;
      }
      const { id, created_at, ...payload } = body;
      const r = await sbFetch('POST', '/rr_events', payload);
      return respond(r.ok ? 201 : 400, r.data);
    }

    // ── PUT: update event ───────────────────────────────────────────────
    if (method === 'PUT') {
      if (!params.id && !body.id) return respond(400, { error: 'id required' });
      const eventId = params.id || body.id;
      if (body._photos) {
        const urls = [];
        for (const p of body._photos) {
          const ext = p.mimeType.split('/')[1] || 'jpg';
          const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const url = await uploadPhoto(p.data, p.mimeType, filename);
          urls.push(url);
        }
        body.photo_urls = [...(body.photo_urls || []), ...urls];
        delete body._photos;
      }
      const { id, created_at, ...updates } = body;
      const r = await sbFetch('PATCH', `/rr_events?id=eq.${eventId}`, updates);
      return respond(r.ok ? 200 : 400, r.data);
    }

    // ── DELETE: soft-archive event ──────────────────────────────────────
    if (method === 'DELETE') {
      if (!params.id) return respond(400, { error: 'id required' });
      const r = await sbFetch('PATCH', `/rr_events?id=eq.${params.id}`, { is_active: false });
      return respond(r.ok ? 200 : 400, r.data);
    }

    return respond(405, { error: 'Method not allowed' });

  } catch (err) {
    console.error('admin-events error:', err);
    return respond(500, { error: err.message });
  }
};
