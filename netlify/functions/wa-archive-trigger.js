export default async (req) => {
  const ADMIN_KEY = Netlify.env.get("EVENTS_ADMIN_PASSWORD");
  const WA_API_KEY = Netlify.env.get("WA_API_KEY");
  const ACCOUNT_ID = Netlify.env.get("WA_ACCOUNT_ID") || "279468";
  const BASE = "https://api.wildapricot.org/v2";

  if (req.method === "POST") {
    const form = await req.formData();
    const key = form.get("key");
    if (key !== ADMIN_KEY) {
      return new Response(buildHtml(null, "Wrong password.", null), { headers: { "Content-Type": "text/html" } });
    }

    // Get OAuth bearer token
    const tokenRes = await fetch("https://oauth.wildapricot.org/auth/token", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from("APIKEY:" + WA_API_KEY).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials&scope=auto"
    });
    const tokenData = await tokenRes.json();
    const access_token = tokenData.access_token;
    if (!access_token) {
      return new Response(buildHtml(null, "WA auth failed: " + JSON.stringify(tokenData), null), { headers: { "Content-Type": "text/html" } });
    }
    const authHeader = "Bearer " + access_token;

    const ARCHIVE_IDS = [
      [96198707,"Brian Castor (dup)","Brian Castor #512"],
      [87048299,"Chris Franks (blank)","Chris Franks #1418"],
      [82809521,"Chris Macionski (alt)","Chris Macionski #899"],
      [96037824,"Chris Macionski (alt2)","Chris Macionski #899"],
      [64675438,"Christopher Paige (alt)","Christopher Paige #878"],
      [85507993,"Chuck Hollweg (blank)","Chuck Hollweg #689"],
      [94714467,"Cody Whitworth (alt)","Cody Whitworth #1361"],
      [98335867,"dan rosensteel (alt)","Dan Rosensteel #641"],
      [96125633,"David Cornell (blank)","David Cornell #282"],
      [72366812,"David Jones (alt)","David Jones #1263"],
      [52876985,"George Conlan (old)","George Conlan #450"],
      [95726819,"George Conlan (typo)","George Conlan #450"],
      [95901445,"Herb Moore (alt)","Herb Moore #1283"],
      [82384819,"Hunter Gunderson (alt)","Hunter Gunderson #1300"],
      [70624748,"jeff britt (alt)","Jeff Britt #1140"],
      [76385175,"Jeff Britt (alt2)","Jeff Britt #1140"],
      [98160966,"Jeff Mainger (blank)","Jeff Mainger #801"],
      [98160996,"Jeff Mainger (blank2)","Jeff Mainger #801"],
      [76305299,"Jeffrey Fillon (alt)","Jeffrey Fillon #1237"],
      [96626716,"Jim Milinchuk (alt)","Jim Milinchuk #1324"],
      [96246676,"Joe Rossiter (blank)","Joe Rossiter #517"],
      [96125621,"Joe Travis (blank)","Joe Travis #1061"],
      [96125948,"John Martin (blank)","John Martin #537"],
      [95967366,"Joshua Zudar (alt)","Joshua Zudar #1428"],
      [79496503,"Keith Campbell (blank)","Keith Campbell #683"],
      [79517076,"Keith Campbell (alt)","Keith Campbell #683"],
      [95584866,"Keith Rose (typo)","Keith Rose #1270"],
      [98160970,"Kent Gallamore (blank)","Kent Gallamore #982"],
      [98243924,"Lawrence Pace (alt)","Lawrence Pace #1395"],
      [96154529,"Lynne Harmon (blank)","Lynne Harmon #147"],
      [94508089,"Max Garcia (blank)","Max Garcia #333"],
      [98160993,"Michael Baker (blank)","Michael Baker #1008"],
      [95939738,"Rod Sullivan (alt)","Rod Sullivan #1152"],
      [77884185,"Sabrena Bondari (alt)","Sabrena Bondari #1412"],
      [95845426,"Scott Szulga (blank)","Scott Szulga #864"],
      [96125904,"Tom Martin (blank)","Tom Martin #227"],
      [49095319,"Tom Nales (old)","Tom Nales #1189"],
      [79496489,"William Gifford (blank)","William Gifford #1255"],
      [69455886,"jim Orchard (alt)","James A. Orchard #713"],
      [74599594,"Chad Suders (alt)","Wesley (Chad) Suders #1328"],
      [69497660,"Ed Schmoll (alt)","Edward Schmoll #1277"],
      [98235737,"Phil Saladino (typo)","Phillip Saladino #396"],
      [96123603,"Bill Geyer (blank)","William Geyer #35"],
      [98336679,"Micahel Cauger (typo)","Michael Cauger #1086"],
      [94186983,"Michael Howard (phone)","JoLynn Howard #128"],
      [79590181,"Lisa Reeves (phone)","Kevin Reeves #1117"],
      [62905252,"Derek Del Rosal (alt)","Derek Del-Rosal #501"],
    ];

    // Dedupe
    const seen = new Set();
    const deduped = ARCHIVE_IDS.filter(([id]) => { if (seen.has(id)) return false; seen.add(id); return true; });

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const fetchWithRetry = async (url, opts, retries = 3) => {
      for (let i = 0; i < retries; i++) {
        const res = await fetch(url, opts);
        if (res.status === 429) {
          await sleep(3000 * (i + 1));
          continue;
        }
        return res;
      }
      return { ok: false, status: 429 };
    };

    const results = { success: [], skipped: [], failed: [] };

    for (const [userId, name, keeping] of deduped) {
      try {
        // GET contact
        const getRes = await fetchWithRetry(
          `${BASE}/accounts/${ACCOUNT_ID}/contacts/${userId}`,
          { headers: { Authorization: authHeader, Accept: "application/json" } }
        );
        if (!getRes.ok) { results.failed.push({ userId, name, reason: `GET ${getRes.status}` }); await sleep(1000); continue; }
        const contact = await getRes.json();
        await sleep(600);

        // Safety check
        const memberIdField = contact.FieldValues?.find(f => f.SystemCode === "MemberId");
        if (contact.MembershipEnabled && memberIdField?.Value) {
          results.skipped.push({ userId, name, reason: `Active member #${memberIdField.Value}` }); continue;
        }
        if (contact.Archived) {
          results.skipped.push({ userId, name, reason: "already archived" }); continue;
        }

        // PUT archive
        contact.Archived = true;
        const putRes = await fetchWithRetry(
          `${BASE}/accounts/${ACCOUNT_ID}/contacts/${userId}`,
          {
            method: "PUT",
            headers: { Authorization: authHeader, "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(contact)
          }
        );
        await sleep(600);

        if (!putRes.ok) { results.failed.push({ userId, name, reason: `PUT ${putRes.status}` }); continue; }
        results.success.push({ userId, name, keeping });

      } catch (e) {
        results.failed.push({ userId, name, reason: String(e) });
      }
    }

    return new Response(buildHtml(results, null, new Date().toISOString()), { headers: { "Content-Type": "text/html" } });
  }

  return new Response(buildHtml(null, null, null), { headers: { "Content-Type": "text/html" } });
};

function buildHtml(results, errMsg, runAt) {
  const rows = results ? [
    ...results.success.map(r => `<tr><td style="color:#1a7a3a">&#10003; Archived</td><td>${r.userId}</td><td>${r.name}</td><td style="color:#555">${r.keeping}</td></tr>`),
    ...results.skipped.map(r => `<tr><td style="color:#888">&mdash; Skipped</td><td>${r.userId}</td><td>${r.name}</td><td style="color:#888">${r.reason}</td></tr>`),
    ...results.failed.map(r => `<tr><td style="color:#c00">&#10007; Failed</td><td>${r.userId}</td><td>${r.name}</td><td style="color:#c00">${r.reason}</td></tr>`),
  ].join("") : "";

  const summary = results
    ? `<div style="background:#e8f5e9;padding:12px 16px;border-radius:6px;margin:16px 0;font-size:14px">
        Run completed: ${runAt}<br>
        <strong>${results.success.length} archived</strong> &nbsp;&bull;&nbsp;
        ${results.skipped.length} skipped &nbsp;&bull;&nbsp;
        ${results.failed.length} failed
       </div>` : "";

  const errBox = errMsg ? `<div style="background:#fff3cd;padding:12px 16px;border-radius:6px;margin:16px 0">${errMsg}</div>` : "";

  const table = rows ? `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px">
    <thead><tr style="background:#f5f5f5">
      <th style="padding:8px;text-align:left">Result</th><th style="padding:8px;text-align:left">User ID</th>
      <th style="padding:8px;text-align:left">Name</th><th style="padding:8px;text-align:left">Note</th>
    </tr></thead><tbody>${rows}</tbody></table>` : "";

  return `<!DOCTYPE html><html><head><title>WA Archive Duplicates</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial,sans-serif;max-width:960px;margin:40px auto;padding:0 20px;color:#222}
  h2{color:#0d1f3c}input[type=password]{padding:8px 12px;border:1px solid #ccc;border-radius:4px;width:240px;margin-right:8px}
  button{padding:8px 20px;background:#0d1f3c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px}
  button:hover{background:#1a3a6c}td,th{padding:7px 10px;border-bottom:1px solid #eee;text-align:left}</style>
  </head><body>
  <h2>WA Duplicate Contact Archiver</h2>
  <p style="color:#555;font-size:14px">Archives duplicate contacts where the active member record is kept. Safe — uses WA archive (reversible), not delete.<br>
  <strong>Note:</strong> This processes ~47 contacts with rate-limiting delays. The page will load for 60-90 seconds — do not close it.</p>
  <form method="POST">
    <input type="password" name="key" placeholder="Admin password" required>
    <button type="submit">Run Archive Job</button>
  </form>
  ${errBox}${summary}${table}
  </body></html>`;
}

export const config = {
  path: "/admin/wa-archive",
  timeout: 90
};
