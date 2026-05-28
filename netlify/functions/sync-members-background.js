// sync-members-background.js
// Background function — 15 min timeout, returns 202 immediately

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const WA_API_KEY    = process.env.WA_API_KEY;
const WA_ACCOUNT_ID = process.env.WA_ACCOUNT_ID;
const WA_BASE       = 'https://api.wildapricot.org/v2.2';

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

async function fetchWAMembers(token) {
  let members = [], skip = 0;
  while (true) {
    const resp = await fetch(
  `${WA_BASE}/accounts/${WA_ACCOUNT_ID}/contacts?$top=100&$skip=${skip}&$async=false&$filter=Status+in+[Active,PendingRenewal,Lapsed]`,
  { headers: { 'Authorization': 'Bearer ' + token } }
);
    if (!resp.ok) throw new Error('WA members fetch failed: ' + resp.status);
    const data = await resp.json();
    const batch = data.Contacts || [];
    members = members.concat(batch);
    if (batch.length < 100) break;
    skip += 100;
  }
  return members;
}

function mapWAMemberToSupabase(m) {
  const fields = {};
  if (m.FieldValues) for (const f of m.FieldValues) fields[f.FieldName] = f.Value;
  return {
    member_number:    String(m.Id || ''),
    first_name:       m.FirstName || '',
    last_name:        m.LastName  || '',
    email:            m.Email     || '',
    status:           m.Status    || '',
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
  if (!sbMember.member_number) return { skipped: true };
  const resp = await fetch(`${WA_BASE}/accounts/${WA_ACCOUNT_ID}/contacts/${sbMember.member_number}`, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      FirstName: sbMember.first_name,
      LastName:  sbMember.last_name,
      Email:     sbMember.email,
      FieldValues: [
        { FieldName: 'Phone', Value: sbMember.phone || '' },
        { FieldName: 'Address', Value: {
          Street: sbMember.address || '', City: sbMember.city || '',
          StateProvince: sbMember.state || '', ZipCode: sbMember.zip || '', Country: 'USA'
        }}
      ]
    })
  });
  return { ok: resp.ok, status: resp.status };
}

async function syncMembers() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const results  = { wa_to_sb: 0, sb_to_wa: 0, skipped: 0, errors: [] };

  const token = await getWAToken();
  const [waMembers, { data: sbMembers, error: sbErr }] = await Promise.all([
    fetchWAMembers(token),
    supabase.from('rr_members').select('*')
  ]);
  if (sbErr) throw new Error('Supabase members fetch: ' + sbErr.message);

  const sbByNum = {};
  for (const m of sbMembers || []) sbByNum[String(m.member_number)] = m;

// WA → Supabase (batched)
  const toUpsert = [];
  for (const waMember of waMembers) {
    try {
      const mapped   = mapWAMemberToSupabase(waMember);
      const existing = sbByNum[mapped.member_number];
      const waTime   = new Date(mapped.updated_at).getTime();
      const sbTime   = existing ? new Date(existing.updated_at).getTime() : 0;
      if (!existing || waTime > sbTime) toUpsert.push(mapped);
      else results.skipped++;
    } catch (e) { results.errors.push('WA→SB map error: ' + e.message); }
  }
  // Upsert in batches of 50
  for (let i = 0; i < toUpsert.length; i += 50) {
    const batch = toUpsert.slice(i, i + 50);
    const { error } = await supabase.from('rr_members').upsert(batch, { onConflict: 'member_number' });
    if (error) results.errors.push('WA→SB batch ' + i + ': ' + error.message);
    else results.wa_to_sb += batch.length;
  }

  // Supabase → WA
  const waByNum = {};
  for (const m of waMembers) waByNum[String(m.Id)] = m;
  for (const sbMember of sbMembers || []) {
    try {
      const waMatch = waByNum[String(sbMember.member_number)];
      if (!waMatch) { results.skipped++; continue; }
      const waTime = waMatch.LastUpdated ? new Date(waMatch.LastUpdated).getTime() : 0;
      const sbTime = sbMember.updated_at ? new Date(sbMember.updated_at).getTime() : 0;
      if (sbTime > waTime) {
        const res = await pushMemberToWA(token, sbMember);
        if (res.skipped) results.skipped++;
        else if (res.ok)  results.sb_to_wa++;
        else results.errors.push('SB→WA ' + sbMember.member_number + ': HTTP ' + res.status);
      } else results.skipped++;
    } catch (e) { results.errors.push('SB→WA error: ' + e.message); }
  }

  return results;
}

exports.handler = async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data: logRow } = await supabase
    .from('sync_log')
    .insert({ sync_type: 'members', status: 'running' })
    .select('id')
    .single();
  const logId = logRow?.id;

  try {
    const results = await syncMembers();
    if (logId) {
      await supabase.from('sync_log').update({
        status: 'complete',
        results: { members: results },
        finished_at: new Date().toISOString()
      }).eq('id', logId);
    }
    console.log('Members sync complete:', JSON.stringify(results));
  } catch (err) {
    console.error('Members sync error:', err.message);
    if (logId) {
      await supabase.from('sync_log').update({
        status: 'error',
        results: { error: err.message },
        finished_at: new Date().toISOString()
      }).eq('id', logId);
    }
  }
};
