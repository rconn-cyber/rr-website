// sync-scheduled.js
// Netlify scheduled function — fires every hour

const { schedule } = require("@netlify/functions");
const { handler: syncHandler } = require("./sync-wa-supabase");

exports.handler = schedule("0 * * * *", async (event) => {
  console.log("Scheduled WA <-> Supabase sync triggered at", new Date().toISOString());
  return syncHandler(event);
});
