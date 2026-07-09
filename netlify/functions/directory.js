// netlify/functions/directory.js
// Public read-only proxy for the member directory
// Returns active members: name, organization, photo_url, member_number, membership_level
// NO email, phone exposed — those are member-only sensitive fields
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=300' // 5-minute cache
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  try {
    // Paginate to get all active members — Supabase max 1000 per request
    let all = [], offset = 0;
    const PAGE = 1000;

    while (true) {
      const url = `${SUPABASE_URL}/rest/v1/rr_members` +
        `?select=first_name,last_name,organization,photo_url,member_number,membership_level,email,phone,status` +
        `&status=in.(Active,PendingRenewal)` +
        `&order=last_name.asc,first_name.asc` +
        `&limit=${PAGE}&offset=${offset}`;

      const res = await fetch(url, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Accept: 'application/json'
        }
      });

      if (!res.ok) {
        const err = await res.text();
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Database error', detail: err }) };
      }

      const batch = await res.json();
      all = all.concat(batch);
      if (batch.length < PAGE) break;
      offset += PAGE;
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ members: all, count: all.length })
    };

  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
