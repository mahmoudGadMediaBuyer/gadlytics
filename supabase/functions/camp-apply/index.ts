// GADLYTICS «أداء الحملات» — fast path: apply ONE budget / bid / on-off change directly on the ad platform (seconds),
// instead of waiting for the scheduled Claude task. Same rules as runbooks/camp_requests.md:
// change only that one field, read it back, update camp_struct, mark the campchg doc, write the change-log row.
// Tokens (META_TOKEN, TIKTOK_TOKEN, SNAP_CLIENT_ID / SNAP_CLIENT_SECRET / SNAP_REFRESH_TOKEN) are read from Supabase
// secrets (Deno.env) first, then from the private table public.app_secrets (RLS on, no policies → service role only,
// loaded from the Mac). public.sys_kv caches the Snap access token. Nothing here ever logs or returns a token.
// A platform without its secret answers {ok:false, code:"not_configured"} so the page falls back to the campchg queue.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "content-type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const USD_SNAP = new Set(["961fd033-2f79-4acc-88ba-0b546464d2b2"]); // Mulabbi [1] — USD account, amounts ÷3.75
const MAX_BUDGET = 50000; // SAR/day — bigger needs confirm:true (guards against a typo like 200000)

class Fail extends Error {
  constructor(public ar: string, public code = "platform", public detail = "") { super(ar); }
}
// env first, then public.app_secrets (one read per request, cached on the request's sb client)
async function secret(sb: any, name: string): Promise<string> {
  const e = env(name); if (e) return e;
  if (!sb.__sec) {
    const { data } = await sb.from("app_secrets").select("name,value");
    sb.__sec = Object.fromEntries((data || []).map((r: any) => [r.name, r.value || ""]));
  }
  return sb.__sec[name] || "";
}
const short = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").slice(0, 240);
const near = (a: unknown, b: number) => a != null && a !== "" && Math.abs(Number(a) - b) < 0.011;

// ───────────── Snap ─────────────
const SNAP_TOKEN_URL = "https://accounts.snapchat.com/login/oauth2/access_token";
const SNAP_API = "https://adsapi.snapchat.com/v1";
async function snapToken(sb: any): Promise<string | null> {
  const id = await secret(sb, "SNAP_CLIENT_ID"), sec = await secret(sb, "SNAP_CLIENT_SECRET");
  // refresh token: the stored (possibly rotated) one in app_secrets first, then the env secret
  if (!sb.__sec) await secret(sb, "__load__");
  const rtStored = sb.__sec?.SNAP_REFRESH_TOKEN || "", rtEnv = env("SNAP_REFRESH_TOKEN");
  const cands = [...new Set([rtStored, rtEnv].filter(Boolean))];
  if (!id || !sec || !cands.length) return null;
  const { data } = await sb.from("sys_kv").select("v").eq("k", "snap_access").maybeSingle();
  if (data?.v) { try { const a = JSON.parse(data.v); if (a.exp > Date.now()) return a.tok; } catch { /* refresh */ } }
  const grant = (rt: string) => fetch(SNAP_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: id, client_secret: sec, refresh_token: rt }) });
  let r: Response | null = null, used = "";
  for (const rt of cands) { r = await grant(rt); used = rt; if (r.ok) break; }
  if (!r || !r.ok) throw new Fail("سناب رفض الدخول — لازم نجدد ربط سناب", "auth", "token HTTP " + (r?.status ?? "-"));
  const t = await r.json();
  const now = new Date().toISOString();
  await sb.from("sys_kv").upsert([{ k: "snap_access", v: JSON.stringify({ tok: t.access_token, exp: Date.now() + (Number(t.expires_in || 1800) - 120) * 1000 }), updated_at: now }], { onConflict: "k" });
  // Snap may hand back a new refresh token — keep the latest one in app_secrets
  if (t.refresh_token && (t.refresh_token !== rtStored || used !== rtStored))
    await sb.from("app_secrets").upsert({ name: "SNAP_REFRESH_TOKEN", value: t.refresh_token, updated_at: now }, { onConflict: "name" });
  return t.access_token;
}
async function snapCall(tok: string, method: string, path: string, body?: unknown) {
  const r = await fetch(SNAP_API + path, { method, headers: { Authorization: "Bearer " + tok, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.json().catch(() => ({}));
  if (!r.ok) throw new Fail("سناب رفض التعديل", "platform", short(t?.debug_message || t?.display_message || t?.request_status || ("HTTP " + r.status)));
  return t;
}
async function applySnap(sb: any, row: any, level: string, id: string, field: string, to: any) {
  const tok = await snapToken(sb);
  if (!tok) return { notConfigured: true };
  const L = ({ campaign: ["/campaigns/", "campaigns", "campaign", (o: any) => "/adaccounts/" + o.ad_account_id + "/campaigns"],
               adset: ["/adsquads/", "adsquads", "adsquad", (o: any) => "/campaigns/" + o.campaign_id + "/adsquads"],
               ad: ["/ads/", "ads", "ad", (o: any) => "/adsquads/" + o.ad_squad_id + "/ads"] } as any)[level];
  const get = async () => (await snapCall(tok, "GET", L[0] + id))?.[L[1]]?.[0]?.[L[2]];
  const obj = await get();
  if (!obj) throw new Fail("الكيان ده مش موجود على سناب", "platform");
  const fx = USD_SNAP.has(String(row.account_id)) ? 3.75 : 1;
  let key = "status", want: any = to;
  if (field === "status") obj.status = to;
  else {
    if (field === "budget") { if (level === "ad") throw new Fail("الإعلان مالوش ميزانية", "bad"); key = "daily_budget_micro"; }
    else { if (level !== "adset") throw new Fail("المزايدة على الـ Ad Set بس", "bad"); key = "bid_micro"; }
    want = Math.round((Number(to) / fx) * 1_000_000); obj[key] = want;
  }
  const put = await snapCall(tok, "PUT", L[3](obj), { [L[1]]: [obj] });
  const sub = put?.[L[1]]?.[0];
  if (String(put?.request_status || "").toUpperCase() !== "SUCCESS" || (sub?.sub_request_status && String(sub.sub_request_status).toUpperCase() !== "SUCCESS"))
    throw new Fail("سناب رفض التعديل", "platform", short(sub?.sub_request_error_reason || put?.request_status));
  const back = (await get())?.[key];
  const verified = field === "status" ? back === to : Number(back) === want;
  return { readBack: field === "status" ? back : Math.round((Number(back) / 1e6) * fx * 100) / 100, verified };
}

// ───────────── Meta ─────────────
const GRAPH = "https://graph.facebook.com/v21.0/";
async function applyMeta(sb: any, row: any, level: string, id: string, field: string, to: any) {
  const tok = await secret(sb, "META_TOKEN");
  if (!tok) return { notConfigured: true };
  const p: Record<string, string> = {};
  if (field === "status") p.status = to;
  else if (field === "budget") {
    if (level === "ad") throw new Fail("الإعلان مالوش ميزانية", "bad");
    if (row.lifetime_budget && !row.daily_budget) throw new Fail("دي ميزانية مدى الحياة — عدّلها من المنصة", "bad");
    p.daily_budget = String(Math.round(Number(to) * 100));
  } else {
    if (level !== "adset") throw new Fail("المزايدة على الـ Ad Set بس", "bad");
    if (row.bid_type === "ROAS goal") throw new Fail("هدف الـ ROAS مش متاح من هنا — عدّله من المنصة", "bad");
    p.bid_amount = String(Math.round(Number(to) * 100));
  }
  const r = await fetch(GRAPH + encodeURIComponent(id), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...p, access_token: tok }) });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || t?.error) {
    const e = t?.error || {};
    if (e.code === 190) throw new Fail("توكن ميتا انتهى أو اتلغى — لازم توكن جديد", "auth", short(e.message));
    throw new Fail("ميتا رفضت التعديل", "platform", short(e.error_user_msg || e.message || ("HTTP " + r.status)));
  }
  const g = await fetch(GRAPH + encodeURIComponent(id) + "?" + new URLSearchParams({ fields: "status,effective_status,daily_budget,bid_amount", access_token: tok }));
  const b = await g.json().catch(() => ({}));
  if (field === "status") return { readBack: b?.status, verified: b?.status === to };
  const v = field === "budget" ? b?.daily_budget : b?.bid_amount;
  return { readBack: v != null ? Number(v) / 100 : null, verified: v != null && Number(v) === Math.round(Number(to) * 100) };
}

// ───────────── TikTok ─────────────
const TT = "https://business-api.tiktok.com/open_api/v1.3/";
async function tt(tok: string, path: string, body?: Record<string, unknown>, query?: Record<string, unknown>) {
  const qs = query ? "?" + new URLSearchParams(Object.fromEntries(Object.entries(query).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]))) : "";
  const r = await fetch(TT + path + qs, { method: body ? "POST" : "GET", headers: { "Access-Token": tok, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.json().catch(() => ({ code: -1, message: "HTTP " + r.status }));
  return t;
}
async function applyTikTok(sb: any, row: any, level: string, id: string, field: string, to: any) {
  const tok = await secret(sb, "TIKTOK_TOKEN");
  if (!tok) return { notConfigured: true };
  const adv = String(row.account_id);
  const ids = { campaign: "campaign_ids", adset: "adgroup_ids", ad: "ad_ids" } as any;
  const spIds = { campaign: "campaign_ids", adset: "adgroup_ids", ad: "smart_plus_ad_ids" } as any;
  const seg = { campaign: "campaign", adset: "adgroup", ad: "ad" } as any;
  // Smart+ objects answer on the smart_plus endpoints; the regular ones don't
  const sp = await tt(tok, "smart_plus/" + seg[level] + "/get/", undefined, { advertiser_id: adv, filtering: { [spIds[level]]: [id] } });
  if (sp?.code === 40105 || sp?.code === 40104 || sp?.code === 40100) throw new Fail("توكن تيك توك انتهى أو مالوش صلاحية", "auth", short(sp?.message));
  const smart = sp?.code === 0 && (sp?.data?.list || []).length > 0;
  const pre = smart ? "smart_plus/" : "";
  let res: any;
  if (field === "status") {
    const op = to === "ACTIVE" ? "ENABLE" : "DISABLE";
    res = await tt(tok, pre + seg[level] + "/status/update/", { advertiser_id: adv, [smart ? spIds[level] : ids[level]]: [id], operation_status: op });
  } else if (field === "budget") {
    if (level === "ad") throw new Fail("الإعلان مالوش ميزانية", "bad");
    res = level === "campaign"
      ? await tt(tok, pre + "campaign/update/", { advertiser_id: adv, campaign_id: id, budget: Number(to) })
      : await tt(tok, pre + "adgroup/budget/update/", { advertiser_id: adv, budget: [{ adgroup_id: id, budget: Number(to) }] });
  } else {
    if (level !== "adset") throw new Fail("المزايدة على الـ Ad Set بس", "bad");
    const key = row.bid_type === "Target ROAS" ? "roas_bid" : row.bid_type === "Bid cap" ? "bid_price" : "conversion_bid_price";
    res = await tt(tok, pre + "adgroup/update/", { advertiser_id: adv, adgroup_id: id, [key]: Number(to) });
  }
  if (res?.code !== 0) throw new Fail("تيك توك رفض التعديل", "platform", short(res?.message || res?.code));
  // read back (regular get lists Smart+ objects too and carries operation_status)
  let it: any = null;
  const g = await tt(tok, seg[level] + "/get/", undefined, { advertiser_id: adv, filtering: { [ids[level]]: [id] } });
  it = (g?.data?.list || [])[0];
  if (!it && smart) it = (((await tt(tok, "smart_plus/" + seg[level] + "/get/", undefined, { advertiser_id: adv, filtering: { [spIds[level]]: [id] } }))?.data?.list) || [])[0];
  if (!it) return { readBack: null, verified: false };
  if (field === "status") { const want = to === "ACTIVE" ? "ENABLE" : "DISABLE"; return { readBack: it.operation_status === "ENABLE" ? "ACTIVE" : it.operation_status === "DISABLE" ? "PAUSED" : it.operation_status, verified: it.operation_status === want }; }
  const v = field === "budget" ? it.budget : (it.conversion_bid_price || it.roas_bid || it.bid_price);
  return { readBack: v ?? null, verified: near(v, Number(to)) };
}

// ───────────── handler ─────────────
const riyadh = () => new Date(Date.now() + 3 * 3600e3).toISOString();
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const t0 = Date.now();
  // 1) who is calling — a real signed-in user of this project (the gateway JWT check alone would also pass the public anon key)
  const auth = req.headers.get("authorization") || "";
  const ua = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: auth } } });
  const { data: ud } = await ua.auth.getUser().catch(() => ({ data: { user: null } } as any));
  const user = ud?.user;
  if (!user) return json({ ok: false, code: "unauthorized", error: "لازم تسجّل دخول" }, 401);
  const allow = env("CAMP_APPLY_EMAILS").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(String(user.email || "").toLowerCase())) return json({ ok: false, code: "forbidden", error: "الحساب ده مش مسموحله يعدّل" }, 403);

  // 2) validate input
  let b: any;
  try { b = await req.json(); } catch { return json({ ok: false, code: "bad", error: "طلب غلط" }, 400); }
  const client = String(b?.client || ""), platform = String(b?.platform || ""), level = String(b?.level || ""), objId = String(b?.objId || ""), field = String(b?.field || "");
  let to: any = b?.to; const docId = b?.docId ? String(b.docId) : "";
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(client) || !["meta", "tiktok", "snap"].includes(platform) || !["campaign", "adset", "ad"].includes(level) ||
      !/^[A-Za-z0-9_-]{4,64}$/.test(objId) || !["budget", "bid", "status"].includes(field) || (docId && !/^[A-Za-z0-9_-]{2,80}$/.test(docId)))
    return json({ ok: false, code: "bad", error: "طلب غلط" }, 400);
  if (field === "status") { if (to !== "ACTIVE" && to !== "PAUSED") return json({ ok: false, code: "bad", error: "الحالة لازم ACTIVE أو PAUSED" }, 400); }
  else {
    to = Number(to);
    if (!(to > 0) || (field === "budget" && to < 1)) return json({ ok: false, code: "bad", error: "اكتب رقم أكبر من صفر" }, 400);
    if (field === "budget" && to > MAX_BUDGET && b?.confirm !== true) return json({ ok: false, code: "confirm", error: "الميزانية دي كبيرة جداً — اتأكد من الرقم" }, 200);
  }

  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const { data: row } = await sb.from("camp_struct").select("*").eq("client_id", client).eq("platform", platform).eq("level", level).eq("id", objId).maybeSingle();
  if (!row) return json({ ok: false, code: "missing", error: "الكيان ده مش موجود في بيانات الصفحة — دوس تحديث الأول" });
  if (field === "budget" && level === "campaign" && row.budget_mode === "ABO") return json({ ok: false, code: "bad", error: "الحملة ABO — الميزانية على الـ Ad Set" });

  // 3) claim the queued doc (if the page queued one) so the scheduled task can't apply it a second time
  const path = "campchg/" + (docId || ("d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)));
  let doc: any = null;
  if (docId) {
    const { data: d } = await sb.from("docs").select("data").eq("path", path).maybeSingle();
    if (!d) return json({ ok: false, code: "bad", error: "الطلب ده مش موجود" }, 400);
    doc = d.data || {};
    if (doc.client !== client || doc.objId !== objId || doc.field !== field || String(doc.to) !== String(to)) return json({ ok: false, code: "bad", error: "الطلب مش مطابق" }, 400);
    if (doc.status !== "pending") return json({ ok: false, code: "taken", error: "الطلب ده اتنفّذ أو بيتنفّذ فعلاً", status: doc.status });
    const { data: c } = await sb.from("docs").update({ data: { ...doc, status: "applying", via: "direct" }, updated_at: new Date().toISOString() })
      .eq("path", path).filter("data->>status", "eq", "pending").select("path");
    if (!c || !c.length) return json({ ok: false, code: "taken", error: "الطلب ده بيتنفّذ فعلاً" });
  } else {
    let from: any = null;
    if (field === "status") from = row.status === "active" ? "ACTIVE" : "PAUSED";
    else from = field === "budget" ? row.daily_budget : row.bid;
    doc = { client, platform, level, objId, name: row.name || "", field, bidType: field === "bid" ? row.bid_type : null, from, to, status: "applying", via: "direct", at: Date.now(), by: user.email || "" };
    await sb.from("docs").upsert({ path, coll: "campchg", data: doc, updated_at: new Date().toISOString() });
  }

  // 4) apply on the platform
  try {
    const r: any = platform === "meta" ? await applyMeta(sb, row, level, objId, field, to)
      : platform === "tiktok" ? await applyTikTok(sb, row, level, objId, field, to) : await applySnap(sb, row, level, objId, field, to);
    if (r.notConfigured) {
      // give the doc back to the queue (or drop the direct-only doc) — the page then waits for the scheduled task
      if (docId) await sb.from("docs").update({ data: { ...doc, status: "pending" }, updated_at: new Date().toISOString() }).eq("path", path);
      else await sb.from("docs").delete().eq("path", path);
      return json({ ok: false, code: "not_configured", platform, error: "المنصة دي لسه مش متوصلة مباشرة" });
    }
    if (field !== "status" && r.readBack != null && !r.verified) throw new Fail("المنصة رجّعت رقم مختلف بعد التعديل", "mismatch", "read back " + r.readBack);
    if (field === "status" && r.readBack != null && !r.verified) throw new Fail("الحالة متغيرتش على المنصة", "mismatch", "read back " + r.readBack);

    // 5) record it everywhere the runbook does
    const nowIso = new Date().toISOString(), ts = Date.now(), rz = riyadh();
    const upd: Record<string, unknown> = { updated_at: nowIso };
    if (field === "budget") upd.daily_budget = to; else if (field === "bid") upd.bid = to; else upd.status = to === "ACTIVE" ? "active" : "paused";
    await sb.from("camp_struct").update(upd).eq("client_id", client).eq("platform", platform).eq("level", level).eq("id", objId);
    await sb.from("docs").update({ data: { ...doc, status: "done", done_at: ts, applied: to, readBack: r.readBack, verified: !!r.verified, ms: Date.now() - t0 }, updated_at: nowIso }).eq("path", path);
    const cid = path.slice("campchg/".length);
    const ch = { id: "auto_cp_" + cid, ts, date: rz.slice(0, 10),
      type: field === "status" ? (to === "ACTIVE" ? "resume" : "pause") : field,
      by: (doc.by || user.email || "") + " · أداء الحملات",
      field: field === "budget" ? "الميزانية اليومية" : field === "bid" ? (row.bid_type || "المزايدة") : "الحالة",
      note: row.name || "", metric: "roas", win: 3, clientId: client, platformId: platform, auto: true, src: "campperf",
      edits: [{ t: rz.slice(11, 16), old: doc.from ?? null, new: to }], objectId: objId, level, campaign: row.camp_no || null };
    await sb.from("docs").upsert({ path: "changes/" + ch.id, coll: "changes", data: ch, updated_at: nowIso });
    return json({ ok: true, platform, level, objId, field, to, readBack: r.readBack, verified: !!r.verified, docId: cid, ms: Date.now() - t0 });
  } catch (e) {
    const f = e instanceof Fail ? e : new Fail("حصل خطأ أثناء التعديل", "fail", short((e as Error)?.message || e));
    await sb.from("docs").update({ data: { ...doc, status: "failed", error: f.ar, detail: f.detail || null, done_at: Date.now() }, updated_at: new Date().toISOString() }).eq("path", path);
    return json({ ok: false, code: f.code, error: f.ar, detail: f.detail || undefined, docId: path.slice(8), ms: Date.now() - t0 });
  }
});
