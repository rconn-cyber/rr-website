// netlify/functions/events-api.js
// Public events feed from Supabase rr_events table.
// Returns all active events; is_public flag lets the client hide members-only ones.
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY (same as admin-events.js)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return json(500, { error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars' });
  }

  try {
    // Fetch all active events ordered by start date ascending
    const query = '/rr_events?is_active=eq.true&order=date_start.asc.nullslast,created_at.asc&limit=500';

    const res = await fetch(`${SUPABASE_URL}/rest/v1${query}`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      }
    });

    if (!res.ok) {
      const text = await res.text();
      return json(502, { error: `Supabase ${res.status}`, detail: text });
    }

    const rows = await res.json();

    // Normalise each row so events.html gets the same shape it already expects
    const events = rows.map(normalise);

    return json(200, events);

  } catch (err) {
    console.error('events-api error:', err.message);
    return json(500, { error: err.message });
  }
};

/**
 * Map an rr_events row to the shape events.html already consumes:
 *   id, title, description, body_html, date_start, date_end,
 *   time_display, location, tags, is_public, photo_urls, luma_url
 */
function normalise(row) {
  // photo_urls may be stored as a JSON string or already an array
  let photos = row.photo_urls;
  if (typeof photos === 'string') {
    try { photos = JSON.parse(photos); } catch { photos = photos ? [photos] : []; }
  }
  if (!Array.isArray(photos)) photos = [];

  // tags may be stored as a Postgres array string like {"Social","Museum"} or JSON
  let tags = row.tags;
  if (typeof tags === 'string') {
    // Postgres text[] comes back as {"tag1","tag2"}
    const pg = tags.match(/^\{(.*)\}$/);
    if (pg) {
      tags = pg[1].split(',').map(t => t.replace(/"/g, '').trim()).filter(Boolean);
    } else {
      try { tags = JSON.parse(tags); } catch { tags = [tags]; }
    }
  }
  if (!Array.isArray(tags)) tags = tags ? [String(tags)] : ['General'];

  // Build a human-readable time string from time_display or start/end times
  const timeDisplay = row.time_display
    || (row.time_start ? buildTime(row.time_start, row.time_end) : '');

  return {
    id:           String(row.id),
    title:        row.title        || 'Untitled Event',
    description:  row.description  || '',
    body_html:    row.body_html    || '',
    date_start:   row.date_start   || null,   // "YYYY-MM-DD"
    date_end:     row.date_end     || null,
    time_display: timeDisplay,
    location:     row.location     || '',
    tags,
    is_public:    row.is_public !== false,     // default true if null
    photo_urls:   photos,
    luma_url:     row.luma_url     || row.rsvp_url || null,
    rsvp_url:     row.rsvp_url     || row.luma_url || null,
  };
}

/** "09:00:00" + "17:00:00" → "9:00 AM – 5:00 PM ET" */
function buildTime(startStr, endStr) {
  const fmt = str => {
    if (!str) return '';
    const [h, m] = str.split(':').map(Number);
    const d = new Date(2000, 0, 1, h, m);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };
  const s = fmt(startStr);
  const e = fmt(endStr);
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
