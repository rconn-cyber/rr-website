// sync-wa-supabase.js
// Bidirectional sync — Wild Apricot <-> Supabase
// Members: WA is source of truth
// Events: most recent updated_at wins; wa_id is the link key

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;
const WA_API_KEY       = process.env.WA_API_KEY;
const WA_ACCOUNT_ID    = process.env.WA_ACCOUNT_ID;
const WA_BASE          = 'https://api.wildapricot.org/v2.2';

// ── WA AUTH ───────────────────────────────────────────────────────────────────
async function getWAToken() {
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
  return data.access_token;
}

// ── WA MEMBERS ────────────────────────────────────────────────────────────────
async function fetchWAMembers(token) {
  let members = [];
  let skip = 0;
  const top = 100;
  while (true) {
    const url = `${WA_BASE}/accounts/${WA_ACCOUNT_ID}/contacts?$top=${top}&$skip=${skip}&$async=false`;
    const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    if (!resp.ok) throw new Error('WA members fetch failed: ' + resp.status);
    const data = await resp.json();
    const batch = data.Contacts || [];
    members = members.concat(batch);
    if (batch.length < top) break;
    skip += top;
  }
  return members;
}

function mapWAMemberToSupabase(m) {
  const fields = {};
  if (m.FieldValues) {
    for (const f of m.FieldValues) fields[f.FieldName] = f.Value;
  }
  return {
    member_number: String(m.Id || ''),
    first_name:    m.FirstName || '',
    last_name:     m.LastName  || '',
    email:         m.Email     || '',
    status:        m.Status    || '',
    membership_level: m.MembershipLevel ? m.MembershipLevel.Name : '',
    level:            m.MembershipLevel ? m.MembershipLevel.Name : '',
    phone:   fields['Phone'] || fields['Cell Phone'] || '',
    address: fields['Address'] ? (fields['Address'].Street        || '') : '',
    city:    fields['Address'] ? (fields['Address'].City          || '') : '',
    state:   fields['Address'] ? (fields['Address'].StateProvince || '') : '',
    zip:     fields['Address'] ? (fields['Address'].ZipCode       || '') : '',
    date_joined: m.MemberSince || null,
    rank:        fields['Rank'] || '',
    admin_type:  fields['Admin role'] || '',
    updated_at:  m.LastUpdated ? new Date(m.LastUpdated).toISOString() : new Date().toISOString()
  };
}

async function pushMemberToWA(token, sbMember) {
  const contactId = sbMember.member_number;
  if (!contactId) return { skipped: true };
  const body = {
    FirstName: sbMember.first_name,
    LastName:  sbMember.last_name,
    Email:     sbMember.email,
    FieldValues: [
      { FieldName: 'Phone', Value: sbMember.phone || '' },
      {
        FieldName: 'Address',
        Value: {
          Street:        sbMember.address || '',
          City:          sbMember.city    || '',
          StateProvince: sbMember.state   || '',
          ZipCode:       sbMember.zip     || '',
          Country:       'USA'
        }
      }
    ]
  };
  const resp = await fetch(`${WA_BASE}/accounts/${WA_ACCOUNT_ID}/contacts/${contactId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return { ok: resp.ok, status: resp.status };
}

// ── WA EVENTS ─────────────────────────────────────────────────────────────────
async function fetchWAEvents(token) {
  const url = `${WA_BASE}/accounts/${WA_ACCOUNT_ID}/events?$top=200&$async=false`;
  const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
  if (!resp.ok) throw new Error('WA events fetch failed: ' + resp.status);
  const data = await resp.json();
  return data.Events || [];
}

function mapWAEventToSupabase(waEvent) {
  // Extract tags as array of label strings
  const tags = Array.isArray(waEvent.Tags)
    ? waEvent.Tags.map(t => t.Label || t).filter(Boolean)
    : [];

  // Derive plain text description from HTML (first 500 chars)
  const description = waEvent.Description
    ? waEvent.Description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
    : '';

  // Derive time_display from StartDate
  const time_display = waEvent.StartDate
    ? new Date(waEvent.StartDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';

  return {
    wa_id:       String(waEvent.Id),
    title:       waEvent.Name     || '',
    date_start:  waEvent.StartDate ? waEvent.StartDate.split('T')[0] : null,
    date_end:    waEvent.EndDate   ? waEvent.EndDate.split('T')[0]   : null,
    time_display,
    location:    waEvent.Location  || '',
    description,
    body_html:   waEvent.Description || '',
    rsvp_url:    waEvent.RegistrationEnabled
                   ? `https://tamparoughriders.org/event-${waEvent.Id}`
                   : '',
    is_public:   waEvent.AccessLevel === 'Public',
    is_active:   !waEvent.IsDraft,
    tags,
    photo_urls:  waEvent.EventImage ? [waEvent.EventImage] : [],
    updated_at:  waEvent.LastUpdated
                   ? new Date(waEvent.LastUpdated).toISOString()
                   : new Date().toISOString()
  };
}

function mapSBEventToWA(sbEvent, existingWaId) {
  const body = {
    Name:        sbEvent.title      || '',
    StartDate:   sbEvent.date_start || null,
    EndDate:     sbEvent.date_end   || sbEvent.date_start || null,
    Location:    sbEvent.location   || '',
    Description: sbEvent.body_html  || '',
    AccessLevel: sbEvent.is_public !== false ? 'Public' : 'AdminOnly',
    IsDraft:     sbEvent.is_active  === false,
    Tags:        Array.isArray(sbEvent.tags)
                   ? sbEvent.tags.map(t => ({ Label: t }))
                   : []
  };
  if (existingWaId) body.Id = parseInt(existingWaId);
  return body;
}

async function pushEventToWA(token, sbEvent) {
  const waId = sbEvent.wa_id;
  if (waId) {
    // Update existing WA event
    const resp = await fetch(`${WA_BASE}/accounts/${WA_ACCOUNT_ID}/events/${waId}`, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(mapSBEventToWA(sbEvent, waId))
    });
    return { ok: resp.ok, status: resp.status, action: 'update' };
  } else {
    // Create new WA event
    const resp = await fetch(`${WA_BASE}/accounts/${WA_ACCOUNT_ID}/events`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(mapSBEventToWA(sbEvent, null))
    });
    if (!resp.ok) return { ok: false, status: resp.status, action: 'create' };
    const data = await resp.json();
    return { ok: true, status: resp.status, action: 'create', newWaId: String(data.Id) };
  }
}

// ── SYNC MEMBERS ──────────────────────────────────────────────────────────────
async function syncMembers(supabase, token) {
  const results = { wa_to_sb: 0, sb_to_wa: 0, skipped: 0, errors: [] };

  const [waMembers, { data: sbMembers, error: sbErr }] = await Promise.all([
    fetchWAMembers(token),
    supabase.from('rr_members').select('*')
  ]);
  if (sbErr) throw new Error('Supabase members fetch failed: ' + sbErr.message);

  const sbByMemberNum = {};
  for (const m of sbMembers || []) sbByMemberNum[String(m.member_number)] = m;

  // WA → Supabase
  for (const waMember of waMembers) {
    try {
      const mapped  = mapWAMemberToSupabase(waMember);
      const existing = sbByMemberNum[mapped.member_number];
      const waTime  = new Date(mapped.updated_at).getTime();
      const sbTime  = existing ? new Date(existing.updated_at).getTime() : 0;
      if (!existing || waTime > sbTime) {
        const { error } = await supabase
          .from('rr_members')
          .upsert(mapped, { onConflict: 'member_number' });
        if (error) results.errors.push('WA→SB member ' + mapped.member_number + ': ' + error.message);
        else results.wa_to_sb++;
      } else {
        results.skipped++;
      }
    } catch (e) {
      results.errors.push('WA→SB member error: ' + e.message);
    }
  }

  // Supabase → WA (only if SB is newer)
  const waByMemberNum = {};
  for (const m of waMembers) waByMemberNum[String(m.Id)] = m;

  for (const sbMember of sbMembers || []) {
    try {
      const waMatch = waByMemberNum[String(sbMember.member_number)];
      if (!waMatch) { results.skipped++; continue; }
      const waTime = waMatch.LastUpdated ? new Date(waMatch.LastUpdated).getTime() : 0;
      const sbTime = sbMember.updated_at ? new Date(sbMember.updated_at).getTime() : 0;
      if (sbTime > waTime) {
        const res = await pushMemberToWA(token, sbMember);
        if (res.skipped) results.skipped++;
        else if (res.ok)  results.sb_to_wa++;
        else results.errors.push('SB→WA member ' + sbMember.member_number + ': HTTP ' + res.status);
      }
    } catch (e) {
      results.errors.push('SB→WA member error: ' + e.message);
    }
  }

  return results;
}

// ── SYNC EVENTS ───────────────────────────────────────────────────────────────
async function syncEvents(supabase, token) {
  const results = { wa_to_sb: 0, sb_to_wa: 0, skipped: 0, errors: [] };

  const [waEvents, { data: sbEvents, error: sbErr }] = await Promise.all([
    fetchWAEvents(token),
    supabase.from('rr_events').select('*')
  ]);
  if (sbErr) throw new Error('Supabase events fetch failed: ' + sbErr.message);

  // Index SB events by wa_id for fast lookup
  const sbByWaId = {};
  const sbByUuid = {};
  for (const e of sbEvents || []) {
    if (e.wa_id) sbByWaId[e.wa_id] = e;
    sbByUuid[e.id] = e;
  }

  // Index WA events by Id
  const waById = {};
  for (const e of waEvents) waById[String(e.Id)] = e;

  // ── WA → Supabase ──────────────────────────────────────────────────────────
  for (const waEvent of waEvents) {
    try {
      const mapped   = mapWAEventToSupabase(waEvent);
      const existing = sbByWaId[mapped.wa_id];
      const waTime   = new Date(mapped.updated_at).getTime();
      const sbTime   = existing ? new Date(existing.updated_at).getTime() : 0;

      if (!existing || waTime > sbTime) {
        if (existing) {
          // Update existing Supabase record
          const { error } = await supabase
            .from('rr_events')
            .update(mapped)
            .eq('id', existing.id);
          if (error) results.errors.push('WA→SB event ' + mapped.wa_id + ': ' + error.message);
          else results.wa_to_sb++;
        } else {
          // Insert new record
          const { error } = await supabase
            .from('rr_events')
            .insert(mapped);
          if (error) results.errors.push('WA→SB event insert ' + mapped.wa_id + ': ' + error.message);
          else results.wa_to_sb++;
        }
      } else {
        results.skipped++;
      }
    } catch (e) {
      results.errors.push('WA→SB event error: ' + e.message);
    }
  }

  // ── Supabase → WA ──────────────────────────────────────────────────────────
  for (const sbEvent of sbEvents || []) {
    try {
      const waMatch  = sbEvent.wa_id ? waById[sbEvent.wa_id] : null;
      const waTime   = waMatch?.LastUpdated ? new Date(waMatch.LastUpdated).getTime() : 0;
      const sbTime   = sbEvent.updated_at ? new Date(sbEvent.updated_at).getTime() : 0;

      // Only push if SB is newer than WA (or WA match doesn't exist)
      if (!waMatch || sbTime > waTime) {
        const res = await pushEventToWA(token, sbEvent);
        if (res.ok) {
          results.sb_to_wa++;
          // If a new WA event was created, store the wa_id back in Supabase
          if (res.action === 'create' && res.newWaId) {
            await supabase
              .from('rr_events')
              .update({ wa_id: res.newWaId })
              .eq('id', sbEvent.id);
          }
        } else {
          results.errors.push('SB→WA event ' + sbEvent.id + ': HTTP ' + res.status);
        }
      } else {
        results.skipped++;
      }
    } catch (e) {
      results.errors.push('SB→WA event error: ' + e.message);
    }
  }

  return results;
}

// ── NETLIFY HANDLER ───────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const token    = await getWAToken();

    const [memberResults, eventResults] = await Promise.all([
      syncMembers(supabase, token),
      syncEvents(supabase, token)
    ]);

    const summary = {
      success:   true,
      timestamp: new Date().toISOString(),
      members:   memberResults,
      events:    eventResults
    };
    console.log('Sync complete:', JSON.stringify(summary));
    return { statusCode: 200, headers, body: JSON.stringify(summary) };
  } catch (err) {
    console.error('Sync error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
