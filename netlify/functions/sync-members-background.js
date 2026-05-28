// sync-members-background.js  (replaces sync-members.js)
// Background function — 15 min timeout, returns 202 immediately

const { createClient } = require('@supabase/supabase-js');
// ... (keep all your existing helper functions identical) ...

exports.handler = async (event) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Insert a 'running' log row and get its ID
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
  // Background functions must return nothing (or 202)
};
