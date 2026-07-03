import { getStore } from "@netlify/blobs";

export default async (req) => {
  const ADMIN_KEY = Netlify.env.get("EVENTS_ADMIN_PASSWORD");

  if (req.method === "POST") {
    const form = await req.formData();
    const key = form.get("key");
    if (key !== ADMIN_KEY) {
      return new Response(buildHtml("Wrong password. Try again.", false, null), {
        headers: { "Content-Type": "text/html" }
      });
    }
    const origin = new URL(req.url).origin;
    fetch(`${origin}/.netlify/functions/wa-archive-duplicates-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: ADMIN_KEY })
    });
    return new Response(buildHtml("Job started! Processing ~47 contacts — takes about 30 seconds. Refresh this page to see results.", true, null), {
      headers: { "Content-Type": "text/html" }
    });
  }

  let results = null;
  try {
    const store = getStore("wa-archive-results");
    results = await store.get("latest", { type: "json" });
  } catch (e) {}

  return new Response(buildHtml(null, false, results), {
    headers: { "Content-Type": "text/html" }
  });
};

function buildHtml(msg, started, results) {
  const rows = results ? [
    ...results.success.map(r =>
      `<tr><td style="color:#1a7a3a">&#10003; Archived</td><td>${r.userId}</td><td>${r.name}</td><td style="color:#555">${r.keeping}</td></tr>`),
    ...results.skipped.map(r =>
      `<tr><td style="color:#888">&mdash; Skipped</td><td>${r.userId}</td><td>${r.name}</td><td style="color:#888">${r.reason}</td></tr>`),
    ...results.failed.map(r =>
      `<tr><td style="color:#c00">&#10007; Failed</td><td>${r.userId}</td><td>${r.name}</td><td style="color:#c00">${r.reason}</td></tr>`),
  ].join("") : "";

  const summary = results
    ? `<div style="background:#e8f5e9;padding:12px 16px;border-radius:6px;margin:16px 0;font-size:14px">
        Last run: ${results.runAt}<br>
        <strong>${results.success.length} archived</strong> &nbsp;&bull;&nbsp;
        ${results.skipped.length} skipped &nbsp;&bull;&nbsp;
        ${results.failed.length} failed
       </div>` : "";

  const msgBox = msg
    ? `<div style="background:${started ? '#e8f5e9' : '#fff3cd'};padding:12px 16px;border-radius:6px;margin:16px 0;font-size:14px">${msg}</div>`
    : "";

  const table = rows
    ? `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px">
        <thead><tr style="background:#f5f5f5">
          <th style="padding:8px;text-align:left">Result</th>
          <th style="padding:8px;text-align:left">User ID</th>
          <th style="padding:8px;text-align:left">Name</th>
          <th style="padding:8px;text-align:left">Note</th>
        </tr></thead>
        <tbody>${rows}</tbody>
       </table>` : "";

  return `<!DOCTYPE html><html><head><title>WA Archive Duplicates</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body{font-family:Arial,sans-serif;max-width:960px;margin:40px auto;padding:0 20px;color:#222}
    h2{color:#0d1f3c}
    input[type=password]{padding:8px 12px;border:1px solid #ccc;border-radius:4px;width:240px;margin-right:8px}
    button{padding:8px 20px;background:#0d1f3c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px}
    button:hover{background:#1a3a6c}
    td,th{padding:7px 10px;border-bottom:1px solid #eee;text-align:left}
  </style></head><body>
  <h2>&#128464; WA Duplicate Contact Archiver</h2>
  <p style="color:#555;font-size:14px">Archives 47 duplicate contacts where the active member record is kept. Safe &mdash; uses WA archive (reversible), not delete.</p>
  <form method="POST">
    <input type="password" name="key" placeholder="Admin password" required>
    <button type="submit">Run Archive Job</button>
  </form>
  ${msgBox}${summary}${table}
  </body></html>`;
}

export const config = { path: "/admin/wa-archive" };
