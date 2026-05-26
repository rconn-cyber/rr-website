// netlify/functions/admin-login.js
// Accepts { password } in POST body, returns { token } if correct.
// Token is simply the password itself used as a Bearer token —
// matches the checkAdmin() pattern in events-api.js.

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { password } = JSON.parse(event.body || '{}');
    const ADMIN_PASS = process.env.EVENTS_ADMIN_PASSWORD;

    if (!password || !ADMIN_PASS || password.trim() !== ADMIN_PASS.trim()) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Incorrect password' }) };
    }

    // Token = the password itself; events-api.js checks Bearer === ADMIN_PASS
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ token: ADMIN_PASS })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
