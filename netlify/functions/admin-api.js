/**
 * admin-api.js
 * Netlify serverless function — holds the Supabase service role key
 * and EVENTS_ADMIN_PASSWORD server-side so they never appear in browser code.
 *
 * All requests must include { password } in the JSON body.
 * Routes are selected by the ?action= query param or body.action.
 *
 * Actions:
 *   verify          — just confirm the password is correct
 *   members-get     — SELECT * FROM rr_members ORDER BY last_name
 *   member-upsert   — INSERT/PATCH a member row
 *   member-delete   — DELETE a member row by id
 *   photos-get      — SELECT * FROM museum_photos ORDER BY sort_order
 *   photo-insert    — INSERT a museum_photos metadata row
 *   photo-patch     — PATCH caption/sort_order on a museum_photos row
 *   photo-delete    — DELETE a museum_photos row + storage object
 */

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
  }

  const ADMIN_PASSWORD  = process.env.EVENTS_ADMIN_PASSWORD;
  const SUPABASE_URL    = process.env.SUPABASE_URL;
  const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;   // service role — server only
  const BUCKET          = 'museum-images';

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: 'Invalid JSON' }; }

  // ── Auth check ──────────────────────────────────────────────
  if (!body.password || body.password !== ADMIN_PASSWORD) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const action = body.action || (event.queryStringParameters?.action);

  // ── Helper: call Supabase REST ───────────────────────────────
  async function sb(path, opts = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...opts,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...(opts.headers || {}),
      },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text);
    return text ? JSON.parse(text) : null;
  }

  const ok  = (data)  => ({ statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const err = (msg, status = 500) => ({ statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) });

  try {
    // ── verify ─────────────────────────────────────────────────
    if (action === 'verify') {
      return ok({ ok: true });
    }

    // ── members-get ────────────────────────────────────────────
    if (action === 'members-get') {
      const data = await sb('rr_members?select=*&order=last_name.asc');
      return ok(data);
    }

    // ── member-upsert ──────────────────────────────────────────
    if (action === 'member-upsert') {
      const { id, payload } = body;
      if (!payload) return err('Missing payload', 400);
      if (id) {
        const data = await sb(`rr_members?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        return ok(data);
      } else {
        const data = await sb('rr_members', { method: 'POST', body: JSON.stringify(payload) });
        return ok(data);
      }
    }

    // ── member-delete ──────────────────────────────────────────
    if (action === 'member-delete') {
      const { id } = body;
      if (!id) return err('Missing id', 400);
      await sb(`rr_members?id=eq.${id}`, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
      return ok({ deleted: true });
    }

    // ── member-import ──────────────────────────────────────────
    if (action === 'member-import') {
      const { rows } = body;
      if (!rows?.length) return err('No rows', 400);
      const BATCH = 50;
      let done = 0;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        await sb('rr_members?on_conflict=member_number', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify(batch),
        });
        done += batch.length;
      }
      return ok({ imported: done });
    }

    // ── photos-get ─────────────────────────────────────────────
    if (action === 'photos-get') {
      const data = await sb('museum_photos?select=*&order=sort_order.asc,created_at.asc');
      return ok(data);
    }

    // ── photo-insert ───────────────────────────────────────────
    if (action === 'photo-insert') {
      const { filename, caption, sort_order } = body;
      if (!filename) return err('Missing filename', 400);
      const data = await sb('museum_photos', {
        method: 'POST',
        body: JSON.stringify({ filename, caption: caption || '', sort_order: sort_order || 0 }),
        headers: { 'Prefer': 'return=minimal' },
      });
      return ok(data);
    }

    // ── photo-patch ────────────────────────────────────────────
    if (action === 'photo-patch') {
      const { id, caption, sort_order } = body;
      if (!id) return err('Missing id', 400);
      await sb(`museum_photos?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ caption, sort_order }),
        headers: { 'Prefer': 'return=minimal' },
      });
      return ok({ updated: true });
    }

    // ── photo-delete ───────────────────────────────────────────
    if (action === 'photo-delete') {
      const { id, filename } = body;
      if (!id || !filename) return err('Missing id or filename', 400);
      // Delete from storage
      await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      });
      // Delete metadata row
      await sb(`museum_photos?id=eq.${id}`, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
      return ok({ deleted: true });
    }

    // ── photo-upload-url (signed upload) ───────────────────────
    if (action === 'photo-upload-url') {
      const { filename, contentType } = body;
      if (!filename) return err('Missing filename', 400);
      // Return a signed upload URL so the browser can PUT directly without exposing the service key
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${encodeURIComponent(filename)}`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contentType, expiresIn: 300 }),
      });
      const data = await res.json();
      if (!res.ok) return err(JSON.stringify(data), 500);
      return ok(data); // { signedURL, token, ... }
    }

    return err('Unknown action: ' + action, 400);

  } catch (e) {
    console.error('[admin-api]', e);
    return err(e.message);
  }
};
