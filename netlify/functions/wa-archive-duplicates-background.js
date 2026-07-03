import { getStore } from "@netlify/blobs";

export default async (req) => {
  const WA_API_KEY = Netlify.env.get("WA_API_KEY");
  const ADMIN_KEY = Netlify.env.get("EVENTS_ADMIN_PASSWORD");
  const ACCOUNT_ID = "279468";
  const BASE = "https://api.wildapricot.org/v2";

  let body = {};
  try { body = await req.json(); } catch(e) {}
  if (body.key !== ADMIN_KEY) {
    console.log("wa-archive-background: unauthorized");
    return;
  }

  const ARCHIVE_LIST = [
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

  const seen = new Set();
  const deduped = ARCHIVE_LIST.filter(([id]) => { if(seen.has(id)) return false; seen.add(id); return true; });

  const results = { success: [], skipped: [], failed: [] };

  for (const [userId, name, keeping] of deduped) {
    try {
      const getRes = await fetch(`${BASE}/accounts/${ACCOUNT_ID}/contacts/${userId}`, {
        headers: { Authorization: `APIKEY ${WA_API_KEY}`, Accept: "application/json" }
      });
      if (!getRes.ok) {
        results.failed.push({ userId, name, reason: `GET ${getRes.status}` });
        continue;
      }
      const contact = await getRes.json();

      const memberIdField = contact.FieldValues?.find(f => f.SystemCode === "MemberId");
      if (contact.MembershipEnabled && memberIdField?.Value) {
        results.skipped.push({ userId, name, reason: `Active member #${memberIdField.Value}` });
        continue;
      }
      if (contact.Archived) {
        results.skipped.push({ userId, name, reason: "already archived" });
        continue;
      }

      contact.Archived = true;
      const putRes = await fetch(`${BASE}/accounts/${ACCOUNT_ID}/contacts/${userId}`, {
        method: "PUT",
        headers: { Authorization: `APIKEY ${WA_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(contact)
      });
      if (!putRes.ok) {
        results.failed.push({ userId, name, reason: `PUT ${putRes.status}` });
        continue;
      }
      results.success.push({ userId, name, keeping });
      console.log(`Archived: ${name} (${userId})`);

      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      results.failed.push({ userId, name, reason: String(e) });
    }
  }

  const store = getStore("wa-archive-results");
  await store.setJSON("latest", { runAt: new Date().toISOString(), ...results });
  console.log(`Done: ${results.success.length} archived, ${results.skipped.length} skipped, ${results.failed.length} failed`);
};
