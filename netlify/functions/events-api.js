// netlify/functions/events-api.js
// Fetches campaigns from Zeffy API and returns event-shaped JSON.
// Required env var: ZEFFY_API_KEY (Netlify → Site config → Environment variables)

exports.handler = async (event) => {
  const apiKey = process.env.ZEFFY_API_KEY;
  const debug  = event.queryStringParameters?.debug === '1';

  if (!apiKey) {
    return json(500, { error: 'ZEFFY_API_KEY env var not set' });
  }

  try {
    // ── 1. Fetch campaigns from Zeffy ────────────────────────────────────────
    const url = 'https://api.zeffy.com/api/v1/campaigns?limit=100';
    const res  = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('Zeffy API error:', res.status, body);
      return json(502, { error: `Zeffy returned ${res.status}`, detail: body });
    }

    const raw = await res.json();

    // ── 2. Debug mode: return raw response so we can see real field names ────
    if (debug) {
      return json(200, { raw });
    }

    // ── 3. Normalise: Zeffy returns { data: [...], has_more, next_cursor }
    //       or possibly a plain array — handle both.
    const campaigns = Array.isArray(raw) ? raw : (raw.data ?? []);

    // ── 4. Map to the shape events.html expects ──────────────────────────────
    const today = new Date().toISOString().split('T')[0];

    const events = campaigns
      .map(toEvent)
      .filter(e => e.date_start && e.date_start >= today)   // upcoming only
      .sort((a, b) => a.date_start.localeCompare(b.date_start));

    return json(200, events);

  } catch (err) {
    console.error('events-api exception:', err.message);
    return json(500, { error: err.message });
  }
};

// ── Mapping ──────────────────────────────────────────────────────────────────
// Zeffy campaign fields (from their API docs & known responses):
//   id, title, description, type, status, is_published,
//   start_date / end_date  OR  occurrences[].start_at / end_at,
//   location, image_url, url (public page link), goal,
//   raised_amount, currency

function toEvent(c) {
  // Dates — Zeffy uses occurrences[] for ticketed events, top-level for others
  const occ       = Array.isArray(c.occurrences) ? c.occurrences[0] : null;
  const rawStart  = occ?.start_at  ?? c.start_date  ?? c.starts_at  ?? c.date ?? null;
  const rawEnd    = occ?.end_at    ?? c.end_date    ?? c.ends_at    ?? null;
  const dateStart = isoDate(rawStart);
  const dateEnd   = isoDate(rawEnd);

  // Time display e.g. "2:00 PM – 5:00 PM ET"
  const timeDisplay = rawStart ? buildTime(rawStart, rawEnd) : '';

  // Tags — derive from Zeffy campaign type
  const typeMap = {
    ticketing:  'Social',
    event:      'Social',
    donation:   'General',
    membership: 'General',
    raffle:     'General',
  };
  const tags = [typeMap[(c.type ?? '').toLowerCase()] ?? 'General'];

  // Photos
  const photos = [c.image_url, c.banner_url, c.cover_image_url].filter(Boolean);

  // RSVP / registration link — the campaign's public Zeffy page
  const rsvpUrl = c.url ?? c.public_url ?? c.campaign_url ?? null;

  return {
    id:           c.id,
    title:        c.title        ?? 'Untitled Event',
    description:  c.description  ?? '',
    body_html:    c.body_html    ?? c.long_description ?? '',
    date_start:   dateStart,
    date_end:     dateEnd,
    time_display: timeDisplay,
    location:     c.location     ?? c.address ?? '',
    tags,
    is_public:    c.is_published !== false && c.status !== 'draft',
    photo_urls:   photos,
    rsvp_url:     rsvpUrl,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isoDate(ts) {
  if (!ts) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return ts;  // already YYYY-MM-DD
  try { return new Date(ts).toISOString().slice(0, 10); } catch { return null; }
}

function buildTime(start, end) {
  const fmt = ts => new Date(ts).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York'
  });
  try {
    return end ? `${fmt(start)} – ${fmt(end)} ET` : `${fmt(start)} ET`;
  } catch { return ''; }
}

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store',
    },
    body: JSON.stringify(body),
  };
}
