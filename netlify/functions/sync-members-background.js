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

  // Address can come back as object or string
  const addr = fields['Address'];
  const addrObj = addr && typeof addr === 'object' ? addr : {};
  const addrStr = addr && typeof addr === 'string' ? addr : '';

  // Photo URL from WA profile
  const photoUrl = m.Photo?.Url
    ? (m.Photo.Url.startsWith('http') ? m.Photo.Url : 'https://tamparoughriders.org' + m.Photo.Url)
    : '';

  return {
    member_number:    fields['Member #'] || String(m.Id || ''),
    wa_id:            String(m.Id || ''),
    first_name:       m.FirstName || '',
    last_name:        m.LastName  || '',
    email:            m.Email     || '',
    status:           m.Status    || '',
    membership_level: m.MembershipLevel ? m.MembershipLevel.Name : '',
    level:            m.MembershipLevel ? m.MembershipLevel.Name : '',
    phone:            fields['Phone'] || fields['Cell Phone'] || '',
    address:          addrObj.Street        || addrStr || '',
    city:             addrObj.City          || '',
    state:            addrObj.StateProvince || '',
    zip:              addrObj.ZipCode       || '',
    date_joined:      m.MemberSince || null,
    rank:             fields['Rank'] || fields['2025-2026 Rank'] || '',
    admin_type:       fields['Admin role'] || '',
    photo_url:        photoUrl,
    updated_at:       m.LastUpdated ? new Date(m.LastUpdated).toISOString() : new Date().toISOString()
  };
}
