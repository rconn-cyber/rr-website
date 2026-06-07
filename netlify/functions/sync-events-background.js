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
  const time_display = waEvent.StartDate
    ? new Date(waEvent.StartDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
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
    photo_urls:  waEvent.EventImage ? [waEvent.EventImage] : [],
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
  const results  = { wa_to_sb: 0, sb_to_wa: 0, skipped: 0, errors: [] };

  const token = await getWAToken();
  const [waEvents, { data: sbEvents, error: sbErr }] = await Promise.all([
    fetchWAEvents(token),
    supabase.from('rr_events').select('*')
  ]);
  if (sbErr) throw new Error('Supabase events fetch: ' + sbErr.message);

  const sbByWaId = {};
  for (const e of sbEvents || []) { if (e.wa_id) sbByWaId[e.wa_id] = e; }
  const waById = {};
  for (const e of waEvents) waById[String(e.Id)] = e;

  // WA → Supabase
  for (const waEvent of waEvents) {
    try {
      const mapped   = mapWAEventToSupabase(waEvent);
      const existing = sbByWaId[mapped.wa_id];
      const waTime   = new Date(mapped.updated_at).getTime();
      const sbTime   = existing ? new Date(existing.updated_at).getTime() : 0;
      if (!existing || waTime > sbTime) {
        if (existing) {
          const { error } = await supabase.from('rr_events').update(mapped).eq('id', existing.id);
          if (error) results.errors.push('WA→SB update ' + mapped.wa_id + ': ' + error.message);
          else results.wa_to_sb++;
        } else {
          const { error } = await supabase.from('rr_events').insert(mapped);
          if (error) results.errors.push('WA→SB insert ' + mapped.wa_id + ': ' + error.message);
          else results.wa_to_sb++;
        }
      } else results.skipped++;
    } catch (e) { results.errors.push('WA→SB error: ' + e.message); }
  }

 // Supabase → WA disabled — WA is source of truth for events
  // New events created in events-admin.html push to WA directly via admin-events.js

  return results;
}

exports.handler = async (event) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data: logRow } = await supabase
    .from('sync_log')
    .insert({ sync_type: 'events', status: 'running' })
    .select('id')
    .single();
  const logId = logRow?.id;

  try {
    const results = await syncEvents();
    if (logId) {
      await supabase.from('sync_log').update({
        status: 'complete',
        results: { events: results },
        finished_at: new Date().toISOString()
      }).eq('id', logId);
    }
    console.log('Events sync complete:', JSON.stringify(results));
  } catch (err) {
    console.error('Events sync error:', err.message);
    if (logId) {
      await supabase.from('sync_log').update({
        status: 'error',
        results: { error: err.message },
        finished_at: new Date().toISOString()
      }).eq('id', logId);
    }
  }
};
