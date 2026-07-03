export default async (req) => {
  const ADMIN_KEY = Netlify.env.get("EVENTS_ADMIN_PASSWORD");
  const WA_API_KEY = Netlify.env.get("WA_API_KEY");
  const ACCOUNT_ID = Netlify.env.get("WA_ACCOUNT_ID") || "279468";
  const BASE = "https://api.wildapricot.org/v2";

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
  const ALL = ARCHIVE_IDS.filter(([id]) => { if (seen.has(id)) return false; seen.add(id); return true; });
  const BATCH_SIZE = 8;

  if (req.method === "POST") {
    let body;
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      body = await req.json();
    } else {
      const form = await req.formData();
      body = { key: form.get("key"), offset: parseInt(form.get("offset") || "0"), prev: form.get("prev") || "[]" };
    }

    const { key, offset = 0, prev = "[]" } = body;
    if (key !== ADMIN_KEY) {
      return Response.json({ error: "Wrong password" }, { status: 401 });
    }

    // Get OAuth token
    const tokenRes = await fetch("https://oauth.wildapricot.org/auth/token", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from("APIKEY:" + WA_API_KEY).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials&scope=auto"
    });
    const { access_token } = await tokenRes.json();
    if (!access_token) return Response.json({ error: "WA auth failed" }, { status: 500 });

    const authHeader = "Bearer " + access_token;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const batch = ALL.slice(offset, offset + BATCH_SIZE);
    const batchResults = [];

    for (const [userId, name, keeping] of batch) {
      try {
        const getRes = await fetch(`${BASE}/accounts/${ACCOUNT_ID}/contacts/${userId}`, {
          headers: { Authorization: authHeader, Accept: "application/json" }
        });
        await sleep(500);
        if (!getRes.ok) { batchResults.push({ userId, name, status: "failed", reason: `GET ${getRes.status}` }); continue; }
        const contact = await getRes.json();

        const memberIdField = contact.FieldValues?.find(f => f.SystemCode === "MemberId");
        if (contact.MembershipEnabled && memberIdField?.Value) {
          batchResults.push({ userId, name, status: "skipped", reason: `Active member #${memberIdField.Value}` }); continue;
        }
        if (contact.Archived) {
          batchResults.push({ userId, name, status: "skipped", reason: "already archived" }); continue;
        }

        contact.Archived = true;
        const putRes = await fetch(`${BASE}/accounts/${ACCOUNT_ID}/contacts/${userId}`, {
          method: "PUT",
          headers: { Authorization: authHeader, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(contact)
        });
        await sleep(500);
        if (!putRes.ok) { batchResults.push({ userId, name, status: "failed", reason: `PUT ${putRes.status}` }); continue; }
        batchResults.push({ userId, name, status: "archived", keeping });
      } catch (e) {
        batchResults.push({ userId, name, status: "failed", reason: String(e) });
      }
    }

    const nextOffset = offset + BATCH_SIZE;
    const done = nextOffset >= ALL.length;
    return Response.json({ batchResults, nextOffset, done, total: ALL.length });
  }

  // GET — serve the UI page
  return new Response(`<!DOCTYPE html><html><head><title>WA Archive Duplicates</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:Arial,sans-serif;max-width:960px;margin:40px auto;padding:0 20px;color:#222}
  h2{color:#0d1f3c}
  input[type=password]{padding:8px 12px;border:1px solid #ccc;border-radius:4px;width:240px;margin-right:8px}
  button{padding:8px 20px;background:#0d1f3c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px}
  button:disabled{background:#999;cursor:not-allowed}
  #status{padding:12px 16px;border-radius:6px;margin:16px 0;font-size:14px;background:#e8f5e9;display:none}
  #progress{height:8px;background:#eee;border-radius:4px;margin:12px 0;display:none}
  #bar{height:8px;background:#0d1f3c;border-radius:4px;width:0%;transition:width .3s}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
  th,td{padding:7px 10px;border-bottom:1px solid #eee;text-align:left}
  thead tr{background:#f5f5f5}
  .archived{color:#1a7a3a}.skipped{color:#888}.failed{color:#c00}
</style>
</head><body>
<h2>WA Duplicate Contact Archiver</h2>
<p style="color:#555;font-size:14px">Archives 47 duplicate contacts in batches. Processes ~8 at a time automatically.</p>
<div style="display:flex;align-items:center;gap:8px">
  <input type="password" id="pwd" placeholder="Admin password">
  <button id="startBtn" onclick="startJob()">Run Archive Job</button>
</div>
<div id="progress"><div id="bar"></div></div>
<div id="status"></div>
<table id="tbl" style="display:none">
  <thead><tr><th>Result</th><th>User ID</th><th>Name</th><th>Note</th></tr></thead>
  <tbody id="tbody"></tbody>
</table>
<script>
let allResults = [], offset = 0, key = '', total = 47;

function startJob() {
  key = document.getElementById('pwd').value;
  if (!key) { alert('Enter password'); return; }
  document.getElementById('startBtn').disabled = true;
  document.getElementById('progress').style.display = 'block';
  document.getElementById('tbl').style.display = 'table';
  setStatus('Starting...', false);
  runBatch(0);
}

async function runBatch(off) {
  setStatus('Processing contacts ' + (off+1) + '–' + Math.min(off+8, total) + ' of ' + total + '...', false);
  try {
    const res = await fetch('/admin/wa-archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, offset: off })
    });
    if (res.status === 401) { setStatus('Wrong password.', true); document.getElementById('startBtn').disabled=false; return; }
    const data = await res.json();
    if (data.error) { setStatus('Error: ' + data.error, true); document.getElementById('startBtn').disabled=false; return; }

    allResults = allResults.concat(data.batchResults);
    appendRows(data.batchResults);
    document.getElementById('bar').style.width = Math.round(data.nextOffset / data.total * 100) + '%';

    if (data.done) {
      const s = allResults.filter(r=>r.status==='archived').length;
      const sk = allResults.filter(r=>r.status==='skipped').length;
      const f = allResults.filter(r=>r.status==='failed').length;
      setStatus('Done! ' + s + ' archived &nbsp;&bull;&nbsp; ' + sk + ' skipped &nbsp;&bull;&nbsp; ' + f + ' failed', false);
      document.getElementById('startBtn').disabled = false;
      document.getElementById('startBtn').textContent = 'Run Again';
    } else {
      await new Promise(r => setTimeout(r, 500));
      runBatch(data.nextOffset);
    }
  } catch(e) {
    setStatus('Network error: ' + e, true);
    document.getElementById('startBtn').disabled = false;
  }
}

function appendRows(rows) {
  const tbody = document.getElementById('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    const cls = r.status;
    const label = cls==='archived' ? '&#10003; Archived' : cls==='skipped' ? '&mdash; Skipped' : '&#10007; Failed';
    const note = r.keeping || r.reason || '';
    tr.innerHTML = '<td class="'+cls+'">'+label+'</td><td>'+r.userId+'</td><td>'+r.name+'</td><td>'+note+'</td>';
    tbody.appendChild(tr);
  });
}

function setStatus(msg, isErr) {
  const el = document.getElementById('status');
  el.style.display = 'block';
  el.style.background = isErr ? '#fff3cd' : '#e8f5e9';
  el.innerHTML = msg;
}
</script>
</body></html>`, { headers: { "Content-Type": "text/html" } });
};

export const config = { path: "/admin/wa-archive" };
