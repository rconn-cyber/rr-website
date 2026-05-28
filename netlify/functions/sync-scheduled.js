// sync-scheduled.js
// Netlify scheduled function — fires every hour
// Place in netlify/functions/

const { schedule } = require("@netlify/functions");

exports.handler = schedule("0 * * * *", async (event) => {
  console.log("Scheduled WA <-> Supabase sync triggered at", new Date().toISOString());

  // Dynamically call the sync handler
  const { handler } = require("./sync-wa-supabase");
  return handler(event);
});
