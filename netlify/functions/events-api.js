// netlify/functions/events-api.js
// Public events feed from Supabase rr_events.
// ?debug=1 returns raw diagnostics (row count, first row, env check).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  const debug = event.queryStringParameters?.debug === '1';

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return json(500, { error: 'Missing env vars', SUPABASE_URL: !!SUPABASE_URL, SUPABASE_KEY: !!SUPABASE_KEY });
  }

  try {
    // First try: active events only
    const query = '/rr_events?is_active=eq.true&order=date_start.asc.nullslast,created_at.asc&limit=500';

    const res = await fetch(`${SUPABASE_URL}/rest/v1${query}`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      }
    });

    const text = await res.text();

    if (!res.ok) {
      // Try without the is_active filter — maybe column doesn't exist or RLS blocks it
      const res2 = await fetch(`${SUPABASE_URL}/rest/v1/rr_events?order=date_start.asc.nullslast&limit=500`, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        }
      });
      const text2 = await res2.text();
      return json(502, {
        error: `Supabase ${res.status}`,
        detail: text.slice(0, 300),
        fallback_status: res2.status,
        fallback_body: text2.slice(0, 300)
      });
    }

    let rows;
    try { rows = JSON.parse(text); } catch(e) {
      return json(500, { error: 'JSON parse failed', raw: text.slice(0, 200) });
    }

    if (debug) {
      return json(200, {
        count: rows.length,
        env_ok: true,
        supabase_url: SUPABASE_URL,
        first_row: rows[0] || null,
        sample_dates: rows.slice(0,5).map(r => ({ title: r.title, date_start: r.date_start, is_public: r.is_public, is_active: r.is_active }))
      });
    }

    const events = rows.map(normalise);
    return json(200, events);

  } catch (err) {
    console.error('events-api error:', err.message);
    return json(500, { error: err.message });
  }
};

function normalise(row) {
  let photos = row.photo_urls;
  if (typeof photos === 'string') {
    try { photos = JSON.parse(photos); } catch { photos = photos ? [photos] : []; }
  }
  if (!Array.isArray(photos)) photos = [];

  let tags = row.tags;
  if (typeof tags === 'string') {
    const pg = tags.match(/^\{(.*)\}$/);
    if (pg) {
      tags = pg[1].split(',').map(t => t.replace(/"/g, '').trim()).filter(Boolean);
    } else {
      try { tags = JSON.parse(tags); } catch { tags = [tags]; }
    }
  }
  if (!Array.isArray(tags)) tags = tags ? [String(tags)] : ['General'];

  const timeDisplay = row.time_display || (row.time_start ? buildTime(row.time_start, row.time_end) : '');

  return {
    id:           String(row.id),
    title:        row.title        || 'Untitled Event',
    description:  row.description  || '',
    body_html:    row.body_html    || '',
    date_start:   row.date_start   || null,
    date_end:     row.date_end     || null,
    time_display: timeDisplay,
    location:     row.location     || '',
    tags,
    is_public:    row.is_public !== false,
    photo_urls:   photos,
    luma_url:     row.luma_url  || row.rsvp_url || null,
    rsvp_url:     row.rsvp_url || row.luma_url  || null,
  };
}

function buildTime(startStr, endStr) {
  const fmt = str => {
    if (!str) return '';
    const [h, m] = str.split(':').map(Number);
    const d = new Date(2000, 0, 1, h, m);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };
  const s = fmt(startStr), e = fmt(endStr);
  return e ? `${s} – ${e} ET` : s ? `${s} ET` : '';
}

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': status === 200 ? 'public, max-age=180' : 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}
