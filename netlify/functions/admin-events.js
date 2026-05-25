const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service role — bypasses RLS
);

// Verify your custom JWT on every request
function verifyToken(authHeader) {
  const crypto = require('crypto');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET)
    .update(payload).digest('base64url');
  if (sig !== expected) return false;
  const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return Date.now() < exp;
}

exports.handler = async (event) => {
  if (!verifyToken(event.headers.authorization)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const method = event.httpMethod;

  if (method === 'GET') {
    const { data, error } = await supabase
      .from('rr_events').select('*').order('date_start');
    return { statusCode: 200, body: JSON.stringify(data) };
  }

  if (method === 'POST') {
    const body = JSON.parse(event.body);
    const { data, error } = await supabase
      .from('rr_events').insert(body).select().single();
    return { statusCode: 200, body: JSON.stringify(data) };
  }

  if (method === 'PUT') {
    const body = JSON.parse(event.body);
    const { id, ...fields } = body;
    const { data, error } = await supabase
      .from('rr_events').update(fields).eq('id', id).select().single();
    return { statusCode: 200, body: JSON.stringify(data) };
  }

  if (method === 'DELETE') {
    const { id } = JSON.parse(event.body);
    await supabase.from('rr_events').delete().eq('id', id);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
