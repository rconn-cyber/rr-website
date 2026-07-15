// netlify/functions/events-api.js
// Fetches campaigns from Zeffy and returns upcoming events for events.html

exports.handler = async (event) => {
  const apiKey = process.env.ZEFFY_API_KEY;
  const debug  = event.queryStringParameters?.debug === '1';

  if (!apiKey) return json(500, { error: 'ZEFFY_API_KEY env var not set' });

  try {
    const res = await fetch('https://api.zeffy.com/api/v1/campaigns?limit=100', {
      headers: { Authorization: `Bearer ${apiKey}` }
    });

    if (!res.ok) {
      const body = await res.text();
      return json(502, { error: `Zeffy ${res.status}`, detail: body });
    }

    const raw = await res.json();
    if (debug) return json(200, { raw });

    // Zeffy returns { object: "list", data: [...] }
    const campaigns = Array.isArray(raw) ? raw : (raw.data ?? []);

    const today = Math.floor(Date.now() / 1000); // Unix timestamp

    const events = campaigns
      .filter(c => !c.is_archived && c.status === 'active')
      .map(toEvent)
      .filter(e => e.sort_ts >= today)
      .sort((a, b) => a.sort_ts - b.sort_ts);

    // Remove internal sort key before sending to client
    events.forEach(e => delete e.sort_ts);

    return json(200, events);

  } catch (err) {
    console.error('events-api error:', err.message);
    return json(500, { error: err.message });
  }
};

function toEvent(c) {
  // occurrences use Unix timestamps: start, end, start_date, end_date
  const occ       = Array.isArray(c.occurrences) && c.occurrences.length ? c.occurrences[0] : null;
  const startTs   = occ?.start      ?? c.start_date ?? null;  // Unix seconds
  const endTs     = occ?.end        ?? c.end_date   ?? null;

  const dateStart = startTs ? unixToDate(startTs) : null;
  const dateEnd   = endTs   ? unixToDate(endTs)   : null;
  const timeDisplay = startTs ? buildTime(startTs, endTs) : '';

  // Strip HTML from description for card preview
  const description = (c.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

  const photos = [c.banner_url, c.logo_url].filter(Boolean);

  return {
    id:           c.id,
    title:        c.title        ?? 'Untitled Event',
    description,
    body_html:    c.description  ?? '',
    date_start:   dateStart,
    date_end:     dateEnd,
    time_display: timeDisplay,
    location:     c.location     ?? '',
    tags:         ['General'],
    is_public:    true,
    photo_urls:   photos,
    rsvp_url:     c.url          ?? null,
    sort_ts:      startTs        ?? 0,
  };
}

// Unix seconds → "YYYY-MM-DD"
function unixToDate(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

// Unix seconds → "2:00 PM – 5:00 PM ET"
function buildTime(startTs, endTs) {
  const fmt = ts => new Date(ts * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York'
  });
  return endTs ? `${fmt(startTs)} – ${fmt(endTs)} ET` : `${fmt(startTs)} ET`;
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
