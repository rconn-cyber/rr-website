// sync-scheduled.js
// Netlify scheduled function — fires every hour
// This simply calls the main sync function on a cron schedule

const { schedule } = require("@netlify/functions");
const { handler: syncHandler } = require("./sync-wa-supabase");

const scheduledSync = schedule("0 * * * *", async (event) => {
  console.log("Scheduled WA <-> Supabase sync triggered at", new Date().toISOString());
  return syncHandler(event);
});

exports.handler = scheduledSync;
