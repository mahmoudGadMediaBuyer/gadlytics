// GADLYTICS — launch-api: the Mac side of «إطلاق الحملات» (campaign launch from the site).
// The page (signed-in user) writes requests into public.launch_queue (RLS: authenticated only; a trigger limits what the
// page may change). Mahmoud's Mac claims them and reports progress here with an API key of scope "launch"
// (public.api_keys, SHA-256 only — made by ~/.gadlytics/make_api_key.py <name> --launch, stored in ~/.gadlytics/launch.key).
// Deployed with verify_jwt ON: every call also carries the public anon key (Authorization: Bearer + apikey).
//   GET  /            info
//   GET  /next        heartbeat + claim queued requests up to the free slots (same SQL as rpc launch_poll, which the watcher polls directly)
//   GET  /row?id=     one request (light columns)
//   POST /status      {id, state: starting|building|draft|stopped, step?, step_no?, campaign?, name?, reason?, session?, session_id?, report?, result_kind?: draft|paused (how it was left: a UI draft, or real objects PAUSED on the platform),
//                      counts?: {launch:[k,n], adsets:[k,n], ads:[k,n], khzama:[k,n]}, progress?}
//                     → progress 0–100 = 20% launch-tool launches + 10% ad sets + 35% ads + 30% Khzama links (from the counts,
//                       merged call by call, never going back while building); draft = 100; stopped keeps the last value
//                     → on reaching draft / stopped: ONE push to every subscribed device through the push function
//   POST /say         {id, text, notify?} → the campaign's agent answers in the card's chat (launch_msgs, who = agent);
//                     notify: true also sends a push (for a reply that is not followed by a new final state)
//   POST /key         admin only (header x-ingest-key, SHA-256 checked): {name, key_hash} → a launch-scope key. Never echoes a key.
// Nothing here talks to an ad platform, and nothing here can publish or activate anything.
import { createClient } from "jsr:@supabase/supabase-js@2";
const VERSION = "1.3.0";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-api-key, apikey, content-type, x-ingest-key, x-client-info", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const env = (k: string) => Deno.env.get(k) || "";
const SB_URL = env("SUPABASE_URL"), SRK = env("SUPABASE_SERVICE_ROLE_KEY");
const sb = createClient(SB_URL, SRK);
const INGEST_SHA = "84f033a41a28bb085aab26a037f2f74411eeb86e52bb4b16535e69e6892b6218";
const SITE = "https://mahmoudgadmediabuyer.github.io/gadlytics/";
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
class ApiErr extends Error { constructor(public status: number, public code: string, msg: string) { super(msg); } }
const KEYS = new Map<string, { id: number | null; name: string; at: number }>(), RL = new Map<string, number[]>();
function hit(k: string, max: number, win: number) { const now = Date.now(), a = (RL.get(k) || []).filter((t) => now - t < win); a.push(now); RL.set(k, a); return a.length > max; }

async function auth(req: Request): Promise<{ id: number; name: string; raw: string }> {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
  if ((RL.get("bad" + ip) || []).filter((t) => Date.now() - t < 600e3).length >= 20) throw new ApiErr(429, "rate_limited", "محاولات كتير غلط — استنى 10 دقايق");
  const raw = (req.headers.get("x-api-key") || "").trim();          // header only — never ?key=
  if (!raw) throw new ApiErr(401, "unauthorized", "ابعت مفتاح الإطلاق في x-api-key");
  const h = await sha256(raw); let c = KEYS.get(h);
  if (!c || Date.now() - c.at > 30e3) {
    const { data } = await sb.from("api_keys").select("id,name,scopes").eq("key_hash", h).is("revoked_at", null).maybeSingle();
    const ok = data && Array.isArray(data.scopes) && data.scopes.length === 1 && data.scopes[0] === "launch";
    c = { id: ok ? data.id : null, name: data?.name || "", at: Date.now() }; KEYS.set(h, c);
    if (data && !ok) throw new ApiErr(403, "scope", "المفتاح ده مش مفتاح إطلاق — اعمل واحد بـ --launch");
  }
  if (!c.id) { hit("bad" + ip, 1e9, 600e3); throw new ApiErr(401, "unauthorized", "المفتاح غلط أو اتلغى"); }
  if (hit("k" + c.id, 240, 60e3)) throw new ApiErr(429, "rate_limited", "طلبات كتير — أقصى حاجة 240 في الدقيقة");
  return { id: c.id, name: c.name, raw };
}

const LIGHT = "id,client,platform,title,kind,n_videos,n_adsets,n_ads,state,step,step_no,progress,campaign_no,campaign_name,stop_reason,session_title,is_test,created_at,claimed_at,started_at,finished_at,updated_at,result_kind";
const FROM: Record<string, string[]> = { starting: ["starting"], building: ["starting", "building", "stopped", "draft"], draft: ["starting", "building", "stopped", "draft"], stopped: ["starting", "building", "stopped"] };
const cut = (v: unknown, n: number) => { const s = v == null ? "" : String(v).trim(); return s ? s.slice(0, n) : null; };
// progress weights (percent): the final read-back check is the last 5 → 100 only at draft
const WEIGHT: Record<string, number> = { launch: 20, adsets: 10, ads: 35, khzama: 30 };
function mergeCounts(old: any, inc: any) {
  const prog: Record<string, number[]> = {}; let changed = false;
  for (const k of Object.keys(WEIGHT)) {
    if (Array.isArray(old?.[k]) && old[k].length === 2) prog[k] = [+old[k][0] || 0, +old[k][1] || 0];
    const v = inc?.[k];
    if (Array.isArray(v) && v.length === 2 && Number.isFinite(+v[0]) && Number.isFinite(+v[1]) && +v[1] > 0) {
      const t = Math.min(1000, Math.round(+v[1])), a = Math.max(0, Math.min(t, Math.round(+v[0])));
      prog[k] = [a, t]; changed = true;
    }
  }
  let pct = 0; for (const k of Object.keys(WEIGHT)) if (prog[k] && prog[k][1] > 0) pct += WEIGHT[k] * prog[k][0] / prog[k][1];
  return { prog, changed, pct: Math.round(pct) };
}

async function notify(row: any) {
  const draft = row.state === "draft", test = row.is_test ? " (تجريبي)" : "";
  const head = (row.campaign_no || row.title) + " · " + row.platform;
  const first = String(row.report || "").split("\n").map((x: string) => x.trim()).find((x: string) => x) || "";
  const body = (first || (draft ? (row.result_kind === "paused" ? "الحملة اتبنت وموقوفة على المنصة — راجعها وشغّلها بنفسك." : "الحملة اتبنت واتسابت درافت — راجعها وشغّلها بنفسك.") : "السبب: " + (row.stop_reason || "مش معروف"))).slice(0, 220);
  try {
    const r = await fetch(SB_URL + "/functions/v1/push", { method: "POST", headers: { Authorization: "Bearer " + SRK, apikey: SRK, "content-type": "application/json" },
      body: JSON.stringify({ action: "send", to: "all", force: true, kind: "launch", rule: "launch", title: head + (draft ? (row.result_kind === "paused" ? " — جاهزة موقوفة" : " — جاهزة درافت") : " — وقفت") + test, body,
        url: SITE + "?p=launch&lc=" + row.id, tag: "launch-" + row.id, client: row.client_id, campaign: row.campaign_no || null, platform: String(row.platform || "").toLowerCase(), obj: "launch:" + row.id }) });
    const d = await r.json().catch(() => ({}));
    return { ok: !!d?.ok, sent: d?.sent ?? 0 };
  } catch (e) { return { ok: false, error: String((e as Error)?.message || e).slice(0, 120) }; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url), path = "/" + url.pathname.split("/launch-api")[1]?.replace(/^\/+|\/+$/g, "");
  try {
    if (path === "/" && req.method === "GET") return json({ ok: true, name: "GADLYTICS launch-api", version: VERSION, auth: "Authorization: Bearer <anon key> + apikey: <anon key> (gateway) and x-api-key: <launch key>", endpoints: ["GET /next", "GET /row?id=", "POST /status", "POST /say", "POST /key (admin)"] });

    if (path === "/key" && req.method === "POST") {                    // admin: register a launch-scope key (hash only)
      const ik = req.headers.get("x-ingest-key") || "";
      if (!ik || (await sha256(ik)) !== INGEST_SHA) throw new ApiErr(403, "forbidden", "forbidden");
      const b = await req.json().catch(() => ({})), name = String(b?.name || ""), h = String(b?.key_hash || "");
      if (!/^[A-Za-z0-9 _.-]{1,60}$/.test(name) || !/^[0-9a-f]{64}$/.test(h)) throw new ApiErr(400, "bad_request", "bad key row");
      const { error } = await sb.from("api_keys").upsert({ name, key_hash: h, scopes: ["launch"], created_at: new Date().toISOString(), last_used_at: null, revoked_at: null }, { onConflict: "name" });
      if (error) throw new ApiErr(500, "db", error.message);
      return json({ ok: true });
    }

    const key = await auth(req);

    if (path === "/next" && req.method === "GET") {
      const { data, error } = await sb.rpc("launch_poll", { p_key: key.raw, p_info: { host: url.searchParams.get("host") || "", v: url.searchParams.get("v") || "", mode: "api" } });
      if (error) throw new ApiErr(500, "db", error.message);
      return json(data);
    }
    if (path === "/row" && req.method === "GET") {
      const { data } = await sb.from("launch_queue").select(LIGHT).eq("id", String(url.searchParams.get("id") || "")).maybeSingle();
      if (!data) throw new ApiErr(404, "not_found", "مفيش طلب بالرقم ده");
      return json({ ok: true, row: data });
    }
    if (path === "/status" && req.method === "POST") {
      const b = await req.json().catch(() => ({})), id = String(b?.id || ""), state = String(b?.state || "");
      if (!/^[a-z0-9]{8,24}$/.test(id) || !FROM[state]) throw new ApiErr(400, "bad_request", "id أو state غلط (starting | building | draft | stopped)");
      const { data: cur } = await sb.from("launch_queue").select("*").eq("id", id).maybeSingle();
      if (!cur) throw new ApiErr(404, "not_found", "مفيش طلب بالرقم ده");
      if (FROM[state].indexOf(cur.state) < 0) throw new ApiErr(409, cur.state === "cancelled" ? "cancelled" : "bad_transition", "الحالة الحالية «" + cur.state + "» ماينفعش تبقى «" + state + "»");
      const camp = cut(b?.campaign, 20), now = new Date().toISOString();
      if (camp && !/^[A-Z]{2,4}-\d{3,6}$/.test(camp)) throw new ApiErr(400, "bad_request", "رقم الحملة شكله غلط (MGG-03071)");
      const up: Record<string, unknown> = { state };
      const step = cut(b?.step, 140); if (step) up.step = step;
      if (b?.step_no != null && Number.isFinite(+b.step_no)) up.step_no = Math.max(0, Math.min(5, Math.round(+b.step_no)));
      if (camp) up.campaign_no = camp;
      const name = cut(b?.name, 300); if (name) up.campaign_name = name;
      const sess = cut(b?.session, 140); if (sess) up.session_title = sess;
      const sid = cut(b?.session_id, 80); if (sid) up.session_id = sid;
      const rep = cut(b?.report, 8000); if (rep) up.report = rep;
      const rk = b?.result_kind === "paused" || b?.result_kind === "draft" ? b.result_kind : null; if (rk) up.result_kind = rk;
      if (state === "stopped") up.stop_reason = cut(b?.reason, 700) || cur.stop_reason || "البناء وقف من غير ما يتكتب السبب";
      if (state === "building") { up.stop_reason = null; up.finished_at = null; if (!cur.started_at) up.started_at = now; }
      if (state === "draft" || state === "stopped") { if (!cur.started_at) up.started_at = cur.claimed_at || now; if (cur.state !== state || !cur.finished_at) up.finished_at = now; }
      if (state === "draft") { up.stop_reason = null; up.step = step || ((rk || cur.result_kind) === "paused" ? "خلصت — موقوفة على المنصة" : "خلصت — درافت"); if (!rk && !cur.result_kind) up.result_kind = "draft"; up.step_no = 5; up.progress = 100; }
      else if (state === "starting" || state === "building") {
        const m = mergeCounts(cur.prog, b?.counts && typeof b.counts === "object" ? b.counts : null);
        const given = b?.progress != null && Number.isFinite(+b.progress) ? Math.round(+b.progress) : null;
        if (m.changed) up.prog = m.prog;
        if (m.changed || given != null) up.progress = Math.max(cur.progress || 0, Math.max(0, Math.min(99, given != null ? given : m.pct)));
        // a finished draft that is being worked on again (a message from the card): leave 100 %, continue from the counts
        if (cur.state === "draft") up.progress = Math.max(0, Math.min(99, given != null ? given : (m.pct || 95)));
      }
      const { data: row, error } = await sb.from("launch_queue").update(up).eq("id", id).eq("state", cur.state).select("*").maybeSingle();
      if (error) throw new ApiErr(500, "db", error.message);
      if (!row) throw new ApiErr(409, "changed", "الحالة اتغيرت في نفس اللحظة — جرّب تاني");
      let pushed: unknown = null;
      if ((state === "draft" || state === "stopped") && cur.state !== state) {   // one push per arrival at a final state
        pushed = await notify(row);
        await sb.from("launch_queue").update({ notified_at: now }).eq("id", id);
      }
      return json({ ok: true, id, state: row.state, was: cur.state, campaign: row.campaign_no, progress: row.progress, push: pushed });
    }
    if (path === "/say" && req.method === "POST") {
      const b = await req.json().catch(() => ({})), id = String(b?.id || ""), text = cut(b?.text, 3500);
      if (!/^[a-z0-9]{8,24}$/.test(id) || !text) throw new ApiErr(400, "bad_request", "id أو نص الرد ناقص");
      const { data: row } = await sb.from("launch_queue").select("id,title,platform,campaign_no,client_id,is_test").eq("id", id).maybeSingle();
      if (!row) throw new ApiErr(404, "not_found", "مفيش طلب بالرقم ده");
      const { data: msg, error } = await sb.from("launch_msgs").insert({ launch_id: id, who: "agent", body: text, handled_at: new Date().toISOString() }).select("id").maybeSingle();
      if (error) throw new ApiErr(500, "db", error.message);
      let pushed: unknown = null;
      if (b?.notify === true) {
        try {
          const r = await fetch(SB_URL + "/functions/v1/push", { method: "POST", headers: { Authorization: "Bearer " + SRK, apikey: SRK, "content-type": "application/json" },
            body: JSON.stringify({ action: "send", to: "all", force: true, kind: "launch", rule: "launch", title: (row.campaign_no || row.title) + " · " + row.platform + " — رد من الحملة" + (row.is_test ? " (تجريبي)" : ""),
              body: text.split("\n").map((x: string) => x.trim()).find((x: string) => x)?.slice(0, 220) || "", url: SITE + "?p=launch&lc=" + id, tag: "launch-" + id, client: row.client_id, campaign: row.campaign_no || null,
              platform: String(row.platform || "").toLowerCase(), obj: "launch:" + id }) });
          const d = await r.json().catch(() => ({})); pushed = { ok: !!d?.ok, sent: d?.sent ?? 0 };
        } catch (e) { pushed = { ok: false, error: String((e as Error)?.message || e).slice(0, 120) }; }
      }
      return json({ ok: true, id, msg: msg?.id ?? null, push: pushed });
    }
    throw new ApiErr(404, "not_found", "not found");
  } catch (e) {
    if (e instanceof ApiErr) return json({ ok: false, code: e.code, error: e.message }, e.status);
    return json({ ok: false, code: "error", error: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
