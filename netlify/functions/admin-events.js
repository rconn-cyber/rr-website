// admin-events.js
// Netlify function — Events CRUD
// Writes to Supabase AND Wild Apricot simultaneously

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WA_API_KEY   = process.env.WA_API_KEY;
const WA_ACCOUNT_ID = process.env.WA_ACCOUNT_ID;
const WA_BASE      = 'https://api.wildapricot.org/v2.2';

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

// ── AUTH ──────────────────────────────────────────────────────────────────────
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

// ── SUPABASE ──────────────────────────────────────────────────────────────────
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

// ── WILD APRICOT ──────────────────────────────────────────────────────────────
let waTokenCache = null;
let waTokenExpiry = 0;

async function getWAToken() {
  if (waTokenCache && Date.now() < waTokenExpiry) return waTokenCache;
  const creds = Buffer.from('APIKEY:' + WA_API_KEY).toString('base64');
  const resp = await fetch('https://oauth.wildapricot.org/auth/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + creds,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials&scope=auto'
  });
  if (!resp.ok) throw new Error('WA auth failed: ' + resp.status);
  const data = await resp.json();
  waTokenCache = data.access_token;
  waTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return waTokenCache;
}

// Map Supabase event → WA event body
function mapToWA(ev) {
  const body = {
    Name: ev.title,
    StartDate: ev.date_start || null,
    EndDate:   ev.date_end   || ev.date_start || null,
    Location:  ev.location   || '',
    Description: ev.body_html || '',
    AccessLevel: ev.is_public !== false ? 'Public' : 'AdminOnly',
    IsDraft: ev.is_active === false,
  };
  // Tags: array of strings → WA Tags array of {Label}
  if (Array.isArray(ev.tags) && ev.tags.length) {
    body.Tags = ev.tags.map(t => ({ Label: t }));
  }
  return body;
}

// Create new WA event, return numeric WA ID
async function createWAEvent(ev) {
  try {
    const token = await getWAToken();
    const resp = await fetch(`${WA_BASE}/accounts/${WA_ACCOUNT_ID}/events`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(mapToWA(ev))
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error('WA create event failed:', err);
      return null;
    }
    const data = await resp.json();
    return String(data.Id);
  } catch (e) {
    console.error('WA create event error:', e.message);
    return null;
  }
}

// Update existing WA event
async function updateWAEvent(waId, ev) {
  try {
    const token = await getWAToken();
    const resp = await fetch(`${WA_BASE}/accounts/${WA_ACCOUNT_ID}/events/${waId}`, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ Id: parseInt(waId), ...mapToWA(ev) })
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error('WA update event failed:', err);
      return false;
    }
    return true;
  } catch (e) {
    console.error('WA update event error:', e.message);
    return false;
  }
}

// Archive WA event (set as draft)
async function archiveWAEvent(waId) {
  try {
    const token = await getWAToken();
    // First fetch existing event to get full object
    const getResp = await fetch(`${WA_BASE}/accounts/${WA_ACCOUNT_ID}/events/${waId}`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!getResp.ok) return false;
    const existing = await getResp.json();
    existing.IsDraft = true;
    const resp = await fetch(`${WA_BASE}/accounts/${WA_ACCOUNT_ID}/events/${waId}`, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(existing)
    });
    return resp.ok;
  } catch (e) {
    console.error('WA archive event error:', e.message);
    return false;
  }
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }
  if (!verifyToken(event.headers.authorization)) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const method = event.httpMethod;

  try {
    // ── GET — fetch all events ──────────────────────────────────────────────
    if (method === 'GET') {
      const r = await sbFetch('GET', '/rr_events?order=date_start.asc.nullslast,created_at.asc');
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(r.data) };
    }

    const body = event.body ? JSON.parse(event.body) : {};

    // ── POST — create new event ─────────────────────────────────────────────
    if (method === 'POST') {
      const { created_at, ...payload } = body;
      payload.updated_at = new Date().toISOString();

      // 1. Save to Supabase first
      const r = await sbFetch('POST', '/rr_events', payload);
      if (!r.ok) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(r.data) };

      const savedEvent = Array.isArray(r.data) ? r.data[0] : r.data;

      // 2. Create in WA, get back wa_id
      const waId = await createWAEvent(payload);
      if (waId) {
        // 3. Store wa_id back in Supabase
        await sbFetch('PATCH', `/rr_events?id=eq.${savedEvent.id}`, { wa_id: waId });
        savedEvent.wa_id = waId;
      }

      return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(savedEvent) };
    }

    // ── PUT — update existing event ─────────────────────────────────────────
    if (method === 'PUT') {
      const { id, created_at, ...updates } = body;
      if (!id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'id required' }) };

      updates.updated_at = new Date().toISOString();

      // 1. Update Supabase
      const r = await sbFetch('PATCH', `/rr_events?id=eq.${id}`, updates);
      if (!r.ok) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(r.data) };

      const savedEvent = Array.isArray(r.data) ? r.data[0] : r.data;

      // 2. Sync to WA
      if (savedEvent?.wa_id) {
        // Update existing WA event
        await updateWAEvent(savedEvent.wa_id, updates);
      } else if (updates.wa_id) {
        await updateWAEvent(updates.wa_id, updates);
      } else {
        // No wa_id yet — create in WA and store id
        const waId = await createWAEvent(updates);
        if (waId) {
          await sbFetch('PATCH', `/rr_events?id=eq.${id}`, { wa_id: waId });
          if (savedEvent) savedEvent.wa_id = waId;
        }
      }

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(savedEvent) };
    }

    // ── DELETE — archive event ──────────────────────────────────────────────
    if (method === 'DELETE') {
      const { id } = body;
      if (!id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'id required' }) };

      // 1. Get event to find wa_id
      const getR = await sbFetch('GET', `/rr_events?id=eq.${id}`);
      const existing = Array.isArray(getR.data) ? getR.data[0] : null;

      // 2. Archive in Supabase (set is_active false)
      const r = await sbFetch('PATCH', `/rr_events?id=eq.${id}`, {
        is_active: false,
        updated_at: new Date().toISOString()
      });

      // 3. Archive in WA
      if (existing?.wa_id) {
        await archiveWAEvent(existing.wa_id);
      }

      return { statusCode: r.ok ? 200 : 400, headers: corsHeaders, body: JSON.stringify(r.data) };
    }

    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    console.error('admin-events error:', err.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
