// sync-scheduled.js
// Runs every hour — calls members and events sync functions separately

const { schedule } = require('@netlify/functions');

exports.handler = schedule('0 * * * *', async () => {
  console.log('Scheduled sync triggered at', new Date().toISOString());

  const base = process.env.URL || 'https://rr-home-page.netlify.app';

  const [membersResp, eventsResp] = await Promise.allSettled([
    fetch(`${base}/.netlify/functions/sync-members`, { method: 'POST' }),
    fetch(`${base}/.netlify/functions/sync-events`,  { method: 'POST' })
  ]);

  const memberResult = membersResp.status === 'fulfilled' ? await membersResp.value.json() : { error: membersResp.reason };
  const eventResult  = eventsResp.status  === 'fulfilled' ? await eventsResp.value.json()  : { error: eventsResp.reason  };

  console.log('Members sync:', JSON.stringify(memberResult));
  console.log('Events sync:',  JSON.stringify(eventResult));

  return { statusCode: 200 };
});
