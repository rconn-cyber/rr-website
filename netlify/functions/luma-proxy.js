// netlify/functions/luma-proxy.js
// Proxies Luma calendar API to avoid CORS issues

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const params = event.queryStringParameters || {};
  const cursor = params.cursor || '';
  const slug   = 'cal-8UAsjnn9qBmt8nK';

  let url = `https://api.lu.ma/calendar/get-items?calendarSlug=${slug}&pagination_limit=50&sort_column=start_at&sort_direction=asc`;
  if (cursor) url += `&pagination_cursor=${encodeURIComponent(cursor)}`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    const text = await res.text();
    return {
      statusCode: res.status,
      headers: corsHeaders,
      body: text
    };
  } catch(e) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: e.message })
    };
  }
};
