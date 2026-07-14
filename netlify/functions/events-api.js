// netlify/functions/events-api.js
// Fetches campaigns from Zeffy and returns upcoming events.
// Set ZEFFY_API_KEY in Netlify → Site configuration → Environment variables.

const ZEFFY_API = 'https://api.zeffy.com/api/v1/campaigns';

// Map Zeffy campaign types to human-friendly tags shown on the event cards.
// Adjust these to match your actual Zeffy campaign titles / types.
const TYPE_TAG_MAP = {
  'ticketing':  'Social',
  'donation':   'General',
  'membership': 'General',
};

exports.handler = async () => {
  const apiKey = process.env.ZEFFY_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'ZEFFY_API_KEY environment variable is not set.' }),
    };
  }

  try {
    // Fetch all campaigns (Zeffy paginates; we'll collect up to 200).
    const campaigns = await fetchAllCampaigns(apiKey);

    // Filter to event-type campaigns only and shape them for the front-end.
    const events = campaigns
      .filter(isEventCampaign)
      .map(toEvent)
      .filter(e => e !== null);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // Cache for 5 minutes so the page stays snappy without hammering Zeffy.
        'Cache-Control': 'public, max-age=300',
      },
      body: JSON.stringify(events),
    };
  } catch (err) {
    console.error('events-api error:', err);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Failed to fetch events from Zeffy.' }),
    };
  }
};

// ── Pagination ────────────────────────────────────────────────────────────────

async function fetchAllCampaigns(apiKey) {
  const results = [];
  let cursor = null;
  let pages   = 0;

  do {
    const url = new URL(ZEFFY_API);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('starting_after', cursor);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Zeffy API ${res.status}: ${body}`);
    }

    const data = await res.json();
    const items = Array.isArray(data) ? data : (data.data ?? []);
    results.push(...items);

    cursor = data.next_cursor ?? null;
    pages++;
    // Safety cap — 200 campaigns is plenty for a small nonprofit.
  } while (cursor && pages < 2);

  return results;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true for campaigns that are event / ticketing forms.
 * Zeffy uses `type` values like "ticketing", "event", etc.
 */
function isEventCampaign(c) {
  const t = (c.type ?? '').toLowerCase();
  return t === 'ticketing' || t === 'event';
}

/**
 * Converts a raw Zeffy campaign object into the shape expected by events.html.
 *
 * Your HTML reads: id, title, description, body_html, date_start, date_end,
 * time_display, location, tags, is_public, photo_urls, luma_url / rsvp_url.
 */
function toEvent(c) {
  // Extract the first occurrence date (Zeffy stores occurrences in an array).
  const occurrence = (c.occurrences ?? [])[0] ?? {};
  const dateStart  = isoDate(occurrence.start_at ?? c.start_at ?? c.created_at);
  const dateEnd    = isoDate(occurrence.end_at   ?? c.end_at);

  // Build a human-readable time string, e.g. "2:00 PM – 5:00 PM".
  const timeDisplay = buildTimeDisplay(occurrence.start_at ?? c.start_at, occurrence.end_at ?? c.end_at);

  // Tags drive the filter buttons (Social / Museum / General / etc.).
  // We derive them from the campaign type; you can also add a custom field in
  // Zeffy's description like "[tag:Museum]" and parse it here if you prefer.
  const rawType  = (c.type ?? '').toLowerCase();
  const autoTag  = TYPE_TAG_MAP[rawType] ?? 'General';
  const tags     = [autoTag];

  // photo_urls — Zeffy may expose a banner/cover image.
  const photoUrls = [c.image_url, c.cover_image_url].filter(Boolean);

  // The RSVP link goes to the campaign's public Zeffy page.
  const rsvpUrl = c.url ?? c.public_url ?? null;

  return {
    id:           c.id,
    title:        c.title ?? 'Untitled Event',
    description:  c.description ?? '',
    body_html:    c.body_html ?? '',
    date_start:   dateStart,
    date_end:     dateEnd,
    time_display: timeDisplay,
    location:     c.location ?? c.address ?? '',
    tags,
    is_public:    c.is_public !== false,   // default true unless Zeffy marks it private
    photo_urls:   photoUrls,
    rsvp_url:     rsvpUrl,
  };
}

/** Returns "YYYY-MM-DD" from an ISO timestamp, or null. */
function isoDate(ts) {
  if (!ts) return null;
  return ts.slice(0, 10);
}

/** Returns e.g. "2:00 PM – 5:00 PM" from ISO timestamps, or ''. */
function buildTimeDisplay(startTs, endTs) {
  if (!startTs) return '';
  const fmt = ts => new Date(ts).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
  });
  const s = fmt(startTs);
  if (!endTs) return s;
  return `${s} – ${fmt(endTs)}`;
}
