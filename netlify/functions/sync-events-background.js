// sync-events.js
// Syncs events only between Wild Apricot and Supabase

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const WA_API_KEY    = process.env.WA_API_KEY;
const WA_ACCOUNT_ID = process.env.WA_ACCOUNT_ID;
const WA_BASE       = 'https://api.wildapricot.org/v2.2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json'
};

async function getWAToken() {
  const creds = Buffer.from('APIKEY:' + WA_API_KEY).toString('base64');
  const resp = await fetch('https://oauth.wildapricot.org/auth/token', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + creds, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=auto'
  });
  if (!resp.ok) throw new Error('WA auth failed: ' + resp.status);
  return (await resp.json()).access_token;
}

async function fetchWAEvents(token) {
  const resp = await fetch(`${WA_BASE}/accounts/${WA_ACCOUNT_ID}/events?$top=200&$async=false`, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  if (!resp.ok) throw new Error('WA events fetch failed: ' + resp.status);
  return (await resp.json()).Events || [];
}

function toWADate(d) {
  if (!d) return null;
  return d.includes('T') ? d : d + 'T00:00:00';
}

function mapWAEventToSupabase(waEvent) {
  const tags = Array.isArray(waEvent.Tags)
    ? waEvent.Tags.map(t => t.Label || t).filter(Boolean) : [];
  const description = waEvent.Description
    ? waEvent.Description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) : '';
  // Parse date+time from WA's ISO string without UTC conversion
  // WA sends e.g. "2026-07-23T18:00:00-05:00" — extract time directly from the string
  let time_display = '';
  if (waEvent.StartDate) {
    const timePart = waEvent.StartDate.match(/T(\d{2}):(\d{2})/);
    if (timePart) {
      const h = parseInt(timePart[1]), m = parseInt(timePart[2]);
      const d = new Date(2000, 0, 1, h, m);
      const start = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      if (waEvent.EndDate) {
        const eTimePart = waEvent.EndDate.match(/T(\d{2}):(\d{2})/);
        if (eTimePart) {
          const eh = parseInt(eTimePart[1]), em = parseInt(eTimePart[2]);
          const ed = new Date(2000, 0, 1, eh, em);
          const end = ed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
          time_display = `${start} – ${end}`;
        } else { time_display = start; }
      } else { time_display = start; }
    }
  }
  return {
    wa_id:       String(waEvent.Id),
    title:       waEvent.Name     || '',
    date_start:  waEvent.StartDate ? waEvent.StartDate.split('T')[0] : null,
    date_end:    waEvent.EndDate   ? waEvent.EndDate.split('T')[0]   : null,
    time_display,
    location:    waEvent.Location  || '',
    description,
    body_html:   waEvent.Description || '',
    rsvp_url:         waEvent.RegistrationEnabled ? `https://tamparoughriders.org/event-${waEvent.Id}` : '',
    registration_type: waEvent.EventType === 'Regular' ? 'ticketed' : 'rsvp',
   // NEW
  // is_public = true when WA AccessLevel is 'Public'
  is_public:   waEvent.AccessLevel === 'Public',
    is_active:   !waEvent.IsDraft,
    tags,
    photo_urls:  (() => {
      // Prefer EventImage field
      if (waEvent.EventImage) {
        const url = typeof waEvent.EventImage === 'object'
          ? (waEvent.EventImage.Url || waEvent.EventImage.url || '')
          : waEvent.EventImage;
        if (url) return [url];
      }
      // Fall back to first <img src="..."> in Description HTML
      if (waEvent.Description) {
        const m = waEvent.Description.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (m && m[1]) return [m[1]];
      }
      return [];
    })(),
    updated_at:  waEvent.LastUpdated ? new Date(waEvent.LastUpdated).toISOString() : new Date().toISOString()
  };
}

function mapSBEventToWA(sbEvent) {
  return {
    Name:        sbEvent.title      || 'Untitled Event',
    StartDate:   toWADate(sbEvent.date_start),
    EndDate:     toWADate(sbEvent.date_end || sbEvent.date_start),
    Location:    sbEvent.location   || '',
    Description: sbEvent.body_html  || sbEvent.description || '',
    AccessLevel: sbEvent.is_public !== false ? 'Public' : 'AdminOnly',
    IsDraft:     sbEvent.is_active  === false,
    RegistrationEnabled: false,
    Tags: Array.isArray(sbEvent.tags) ? sbEvent.tags.map(t => ({ Label: t })) : []
  };
}

async function pushEventToWA(token, sbEvent) {
  const waId = sbEvent.wa_id;
  if (waId) {
    const resp = await fetch(`${WA_BASE}/accounts/${WA_ACCOUNT_ID}/events/${waId}`, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ Id: parseInt(waId), ...mapSBEventToWA(sbEvent) })
    });
    return { ok: resp.ok, status: resp.status, action: 'update' };
  } else {
    const resp = await fetch(`${WA_BASE}/accounts/${WA_ACCOUNT_ID}/events`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(mapSBEventToWA(sbEvent))
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error('WA create event failed:', err);
      return { ok: false, status: resp.status, action: 'create' };
    }
    const data = await resp.json();
    return { ok: true, status: resp.status, action: 'create', newWaId: String(data.Id) };
  }
}

async function syncEvents() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const results  = { upserted: 0, errors: [], image_samples: [] };

  const token = await getWAToken();
  const waEvents = await fetchWAEvents(token);

  // collect image diagnostics
  for (const e of waEvents) {
    if (e.EventImage || (e.Description && /<img/i.test(e.Description))) {
      const srcMatch = e.Description && e.Description.match(/<img[^>]+src=["']([^"']+)["']/i);
      results.image_samples.push({
        id: e.Id, title: e.Name,
        EventImage: e.EventImage,
        desc_img_src: srcMatch ? srcMatch[1] : null
      });
    }
  }

  // Map all events and upsert in ONE call using wa_id as the conflict key
  const rows = waEvents.map(mapWAEventToSupabase);

  const { error, count } = await supabase
    .from('rr_events')
    .upsert(rows, { onConflict: 'wa_id', ignoreDuplicates: false })
    .select('id', { count: 'exact', head: true });

  if (error) {
    // wa_id may not have a unique constraint yet — fall back to individual upserts
    console.warn('Bulk upsert failed, falling back:', error.message);
    results.errors.push('bulk: ' + error.message);
    for (const row of rows) {
      const { error: e2 } = await supabase
        .from('rr_events')
        .upsert(row, { onConflict: 'wa_id', ignoreDuplicates: false });
      if (e2) results.errors.push(row.wa_id + ': ' + e2.message);
      else results.upserted++;
    }
  } else {
    results.upserted = count ?? rows.length;
  }

  return results;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Netlify background functions (-background.js) get 15 min but must return quickly.
  // We run the sync inline but cap each Supabase chunk so it stays fast.
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data: logRow } = await supabase
    .from('sync_log')
    .insert({ sync_type: 'events', status: 'running' })
    .select('id')
    .single();
  const logId = logRow?.id;

  try {
    const results = await syncEvents();
    console.log('Sync complete:', results.upserted, 'rows');
    if (logId) await supabase.from('sync_log').update({
      status: 'complete',
      results: { upserted: results.upserted, errors: results.errors, image_samples: results.image_samples },
      finished_at: new Date().toISOString()
    }).eq('id', logId);
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, upserted: results.upserted, errors: results.errors?.length, image_samples: results.image_samples?.slice(0,5) })
    };
  } catch (err) {
    console.error('Sync error:', err.message);
    if (logId) await supabase.from('sync_log').update({ status: 'error', results: { error: err.message }, finished_at: new Date().toISOString() }).eq('id', logId);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
