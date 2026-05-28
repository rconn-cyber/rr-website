// netlify/functions/sync-status.js
const { createClient } = require('@supabase/supabase-js');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json'
};

exports.handler = async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await supabase
    .from('sync_log')
    .select('*')
    .in('sync_type', ['members', 'events'])
    .order('started_at', { ascending: false })
    .limit(10);

  if (error) return {
    statusCode: 500, headers,
    body: JSON.stringify({ error: error.message })
  };

  // Return latest row per type
  const latest = {};
  for (const row of data || []) {
    if (!latest[row.sync_type]) latest[row.sync_type] = row;
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({ success: true, latest })
  };
};
