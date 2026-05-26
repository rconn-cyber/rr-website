// netlify/functions/admin-login.js
// Verifies password, returns a signed token that admin-events.js verifyToken() accepts.
// Token format: base64url(payload).hmac-sha256(payload, SESSION_SECRET)
// Payload: { exp: <8hr from now> }

const crypto = require('crypto');

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
    const ADMIN_PASS    = process.env.EVENTS_ADMIN_PASSWORD;
    const SESSION_SECRET = process.env.SESSION_SECRET;

    if (!password || !ADMIN_PASS || password.trim() !== ADMIN_PASS.trim()) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Incorrect password' }) };
    }

    // Build token exactly as verifyToken() in admin-events.js expects:
    // payload = base64url({ exp: now + 8hr })
    // token   = payload + '.' + HMAC-SHA256(payload, SESSION_SECRET)
    const payload = Buffer.from(JSON.stringify({
      exp: Date.now() + 8 * 60 * 60 * 1000
    })).toString('base64url');

    const sig = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(payload)
      .digest('base64url');

    const token = `${payload}.${sig}`;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ token })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
