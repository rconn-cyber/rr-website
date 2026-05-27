// sync-wa-supabase.js
// Bidirectional sync between Wild Apricot and Supabase
// Conflict resolution: most recent updated_at wins

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WA_API_KEY = process.env.WA_API_KEY;
const WA_ACCOUNT_ID = process.env.WA_ACCOUNT_ID;
const WA_BASE = "https://api.wildapricot.org/v2.2";

// --- Wild Apricot Auth ---
async function getWAToken() {
  const creds = Buffer.from("APIKEY:" + WA_API_KEY).toString("base64");
  const resp = await fetch("https://oauth.wildapricot.org/auth/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + creds,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=auto",
  });
  if (!resp.ok) throw new Error("WA auth failed: " + resp.status);
  const data = await resp.json();
  return data.access_token;
}

// --- Wild Apricot Members ---
async function fetchWAMembers(token) {
  let members = [];
  let skip = 0;
  const top = 100;
  while (true) {
    const url = `${WA_BASE}/accounts/${WA_ACCOUNT_ID}/contacts?$top=${top}&$skip=${skip}&$async=false`;
    const resp = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!resp.ok) throw new Error("WA members fetch failed: " + resp.status);
    const data = await resp.json();
    const batch = data.Contacts || [];
    members = members.concat(batch);
    if (batch.length < top) break;
    skip += top;
  }
  return members;
}

function mapWAMemberToSupabase(waMember) {
  const fields = {};
  if (waMember.FieldValues) {
    for (const f of waMember.FieldValues) {
      fields[f.FieldName] = f.Value;
    }
  }
  return {
    member_number: String(waMember.Id || ""),
    first_name: waMember.FirstName || "",
    last_name: waMember.LastName || "",
    email: waMember.Email || "",
    status: waMember.Status || "",
    membership_level: waMember.MembershipLevel
      ? waMember.MembershipLevel.Name
      : "",
    level: waMember.MembershipLevel ? waMember.MembershipLevel.Name : "",
    phone: fields["Phone"] || fields["Cell Phone"] || "",
    address: fields["Address"] ? (fields["Address"].Street || "") : "",
    city: fields["Address"] ? (fields["Address"].City || "") : "",
    state: fields["Address"] ? (fields["Address"].StateProvince || "") : "",
    zip: fields["Address"] ? (fields["Address"].ZipCode || "") : "",
    date_joined: waMember.MemberSince || null,
    rank: fields["Rank"] || "",
    admin_type: fields["Admin role"] || "",
    updated_at: waMember.LastUpdated
      ? new Date(waMember.LastUpdated).toISOString()
      : new Date().toISOString(),
  };
}

async function pushMemberToWA(token, sbMember) {
  // Only update fields WA owns; use member_number as WA Contact Id
  const contactId = sbMember.member_number;
  if (!contactId) return { skipped: true, reason: "no member_number" };

  const body = {
    FirstName: sbMember.first_name,
    LastName: sbMember.last_name,
    Email: sbMember.email,
    FieldValues: [
      { FieldName: "Phone", Value: sbMember.phone || "" },
      {
        FieldName: "Address",
        Value: {
          Street: sbMember.address || "",
          City: sbMember.city || "",
          StateProvince: sbMember.state || "",
          ZipCode: sbMember.zip || "",
          Country: "USA",
        },
      },
    ],
  };

  const resp = await fetch(
    `${WA_BASE}/accounts/${WA_ACCOUNT_ID}/contacts/${contactId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  return { ok: resp.ok, status: resp.status };
}

// --- Wild Apricot Events ---
async function fetchWAEvents(token) {
  const url = `${WA_BASE}/accounts/${WA_ACCOUNT_ID}/events?$top=200&$async=false`;
  const resp = await fetch(url, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!resp.ok) throw new Error("WA events fetch failed: " + resp.status);
  const data = await resp.json();
  return data.Events || [];
}

function mapWAEventToSupabase(waEvent) {
  return {
    id: String(waEvent.Id),
    title: waEvent.Name || "",
    date_start: waEvent.StartDate ? waEvent.StartDate.split("T")[0] : null,
    date_end: waEvent.EndDate ? waEvent.EndDate.split("T")[0] : null,
    time_display: waEvent.StartDate
      ? new Date(waEvent.StartDate).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        })
      : "",
    location: waEvent.Location || "",
    description: waEvent.Description
      ? waEvent.Description.replace(/<[^>]+>/g, "").slice(0, 500)
      : "",
    body_html: waEvent.Description || "",
    is_public: waEvent.AccessLevel === "Public",
    is_active: !waEvent.IsDraft,
    rsvp_url: waEvent.RegistrationEnabled
      ? `https://tamparoughriders.org/event-${waEvent.Id}`
      : "",
    updated_at: waEvent.LastUpdated
      ? new Date(waEvent.LastUpdated).toISOString()
      : new Date().toISOString(),
  };
}

async function pushEventToWA(token, sbEvent) {
  // Only push events that originated in Supabase (non-numeric id = Supabase UUID)
  const isWAEvent = /^\d+$/.test(sbEvent.id);
  if (isWAEvent) return { skipped: true, reason: "WA-origin event" };

  const body = {
    Name: sbEvent.title,
    StartDate: sbEvent.date_start,
    EndDate: sbEvent.date_end || sbEvent.date_start,
    Location: sbEvent.location || "",
    Description: sbEvent.body_html || sbEvent.description || "",
    AccessLevel: sbEvent.is_public ? "Public" : "AdminOnly",
  };

  const resp = await fetch(
    `${WA_BASE}/accounts/${WA_ACCOUNT_ID}/events`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  return { ok: resp.ok, status: resp.status };
}

// --- Main Sync Logic ---
async function syncMembers(supabase, token) {
  const results = { wa_to_sb: 0, sb_to_wa: 0, skipped: 0, errors: [] };

  // 1. Fetch both sides
  const [waMembers, { data: sbMembers, error: sbErr }] = await Promise.all([
    fetchWAMembers(token),
    supabase.from("rr_members").select("*"),
  ]);
  if (sbErr) throw new Error("Supabase members fetch failed: " + sbErr.message);

  const sbByMemberNum = {};
  for (const m of sbMembers || []) {
    sbByMemberNum[String(m.member_number)] = m;
  }

  // 2. WA -> Supabase (upsert if WA is newer or missing in SB)
  for (const waMember of waMembers) {
    try {
      const mapped = mapWAMemberToSupabase(waMember);
      const existing = sbByMemberNum[mapped.member_number];
      const waTime = new Date(mapped.updated_at).getTime();
      const sbTime = existing
        ? new Date(existing.updated_at).getTime()
        : 0;

      if (!existing || waTime > sbTime) {
        const { error } = await supabase
          .from("rr_members")
          .upsert(mapped, { onConflict: "member_number" });
        if (error) results.errors.push("WA->SB member " + mapped.member_number + ": " + error.message);
        else results.wa_to_sb++;
      } else {
        results.skipped++;
      }
    } catch (e) {
      results.errors.push("WA->SB member error: " + e.message);
    }
  }

  // 3. Supabase -> WA (push SB records newer than WA counterpart)
  const waByMemberNum = {};
  for (const m of waMembers) waByMemberNum[String(m.Id)] = m;

  for (const sbMember of sbMembers || []) {
    try {
      const waMatch = waByMemberNum[String(sbMember.member_number)];
      if (!waMatch) { results.skipped++; continue; }
      const waTime = waMatch.LastUpdated ? new Date(waMatch.LastUpdated).getTime() : 0;
      const sbTime = sbMember.updated_at ? new Date(sbMember.updated_at).getTime() : 0;
      if (sbTime > waTime) {
        const res = await pushMemberToWA(token, sbMember);
        if (res.skipped) results.skipped++;
        else if (res.ok) results.sb_to_wa++;
        else results.errors.push("SB->WA member " + sbMember.member_number + ": HTTP " + res.status);
      }
    } catch (e) {
      results.errors.push("SB->WA member error: " + e.message);
    }
  }

  return results;
}

async function syncEvents(supabase, token) {
  const results = { wa_to_sb: 0, sb_to_wa: 0, skipped: 0, errors: [] };

  const [waEvents, { data: sbEvents, error: sbErr }] = await Promise.all([
    fetchWAEvents(token),
    supabase.from("rr_events").select("*"),
  ]);
  if (sbErr) throw new Error("Supabase events fetch failed: " + sbErr.message);

  const sbById = {};
  for (const e of sbEvents || []) sbById[e.id] = e;

  // WA -> Supabase
  for (const waEvent of waEvents) {
    try {
      const mapped = mapWAEventToSupabase(waEvent);
      const existing = sbById[mapped.id];
      const waTime = new Date(mapped.updated_at).getTime();
      const sbTime = existing ? new Date(existing.updated_at).getTime() : 0;

      if (!existing || waTime > sbTime) {
        const { error } = await supabase
          .from("rr_events")
          .upsert(mapped, { onConflict: "id" });
        if (error) results.errors.push("WA->SB event " + mapped.id + ": " + error.message);
        else results.wa_to_sb++;
      } else {
        results.skipped++;
      }
    } catch (e) {
      results.errors.push("WA->SB event error: " + e.message);
    }
  }

  // Supabase -> WA (only Supabase-native events, UUID format)
  const waIds = new Set(waEvents.map((e) => String(e.Id)));
  for (const sbEvent of sbEvents || []) {
    try {
      if (waIds.has(sbEvent.id)) { results.skipped++; continue; }
      // New Supabase-origin event — push to WA
      const res = await pushEventToWA(token, sbEvent);
      if (res.skipped) results.skipped++;
      else if (res.ok) results.sb_to_wa++;
      else results.errors.push("SB->WA event " + sbEvent.id + ": HTTP " + res.status);
    } catch (e) {
      results.errors.push("SB->WA event error: " + e.message);
    }
  }

  return results;
}

// --- Netlify Handler ---
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // Allow GET (scheduled) or POST (on-demand)
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const token = await getWAToken();

    const [memberResults, eventResults] = await Promise.all([
      syncMembers(supabase, token),
      syncEvents(supabase, token),
    ]);

    const summary = {
      success: true,
      timestamp: new Date().toISOString(),
      members: memberResults,
      events: eventResults,
    };

    console.log("Sync complete:", JSON.stringify(summary));
    return { statusCode: 200, headers, body: JSON.stringify(summary) };
  } catch (err) {
    console.error("Sync error:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
