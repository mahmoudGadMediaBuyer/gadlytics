// GADLYTICS gad-api — fast API for AI assistants (instinct, Claude, ChatGPT custom actions, any MCP client). Read-only,
// except the two /edit routes (scope edit) that change ONE budget / bid / on-off through the site's own path.
// One edge function, two faces:
//   REST  GET /report · /clients · /summary · /campaigns · /campaign · /alerts · /changes · POST /refresh · GET /openapi.json
//         GET /edit/preview → confirm_token (10 min) · POST /edit/apply {confirm_token}
//   MCP   POST /mcp  (Streamable HTTP, JSON-RPC 2.0: initialize · tools/list · tools/call · ping) — read-only tools only
// Auth (deployed with verify_jwt ON): the Supabase gateway needs  Authorization: Bearer <anon key>  +  apikey: <anon key>
// (the public anon key from config.js); the GADLYTICS API key goes in  x-api-key: <key>  (or ?key=<read-only key> on GET).
// A bearer that is a JWT (eyJ…) or sb_publishable_… is never treated as an API key. Keys live ONLY as SHA-256 hashes in the
// private table public.api_keys (RLS on, no policies; written by ~/.gadlytics/make_api_key.py through the ingest function).
// Scopes: read (everything below), refresh (POST /refresh → camp-refresh, today's spend from the platforms) and edit
// (/edit/*: header only — a refresh or edit key in ?key= is refused). Browsing agents use r.html, which keeps the key in the
// URL hash (never sent to a server) and sends it in x-api-key.
// Edits: /edit/preview resolves the target from camp_struct exactly like «أداء الحملات» (CBO → campaign budget, ABO → the ad set),
// signs {target, from, to} with an HMAC (secret derived from the service-role key, 10-minute expiry). /edit/apply checks it, writes
// the same campchg/* doc the site writes (by "api:<key name>"), calls camp-apply with the service role (camp-apply applies only
// that one field, reads it back, updates camp_struct and writes the changes/* log row → undo works), then pushes to Mahmoud.
// 30 edits / hour per key; the same object again within 15 s = duplicate. No budget cap (up to 1,000,000 SAR/day is normal).
// Business logic mirrors the site's «أداء الحملات» page (cpRange / cpBuild / cpModel / cpKpis / cpVerdict) exactly:
//   spend = ad_daily (platforms) · donations + revenue = khzama_link_daily (ملبي) or conv_daily (ديمان) — never platform purchases ·
//   Smart+ = one ad (a multi-video link is never split across videos) · verdicts from config/app roasGood / roasMin / roasAlarm.
// Khzama live (scope khzama ONLY — such a key is refused everywhere else, and read keys are refused here): the Chrome extension
// gadlytics-site/khzama-live reads admin.molabi.sa/affiliateLinks every ~2 min and sends POST /khzama/push {date, complete, rows}
// (today or yesterday, Riyadh). The title → camp/custom/creative/code/platform parsing lives HERE (same as khzama_ingest.py);
// complete=true makes it a full snapshot of that day (links not in the push are deleted). Guard: a push whose donations are
// < 50% of what's stored is refused (unless stored < 5). 1 push / 30 s per key. POST /khzama/status {state, detail} →
// login_required / error push ONE notification per state per 2 h. Heartbeat: docs sys/khzama_live (→ /summary data_freshness).
// Dates are Asia/Riyadh, money is SAR. Only /edit/apply writes to the ad platforms (through camp-apply); no key or token is ever logged or echoed.
import { createClient } from "jsr:@supabase/supabase-js@2";

const VERSION = "1.2.0";
const env = (k: string) => Deno.env.get(k) || "";
const SB_URL = env("SUPABASE_URL"), SRK = env("SUPABASE_SERVICE_ROLE_KEY");
const BASE = SB_URL + "/functions/v1/gad-api";
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, apikey, content-type, accept, mcp-session-id, mcp-protocol-version, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-gad-ms",
};
const json = (o: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8", ...extra } });

class ApiErr extends Error { constructor(public status: number, public code: string, public ar: string, public en: string, public extra?: Record<string, unknown>) { super(en); } }
const bad = (ar: string, en: string) => new ApiErr(400, "bad_request", ar, en);

// ───────────── dates (Asia/Riyadh) ─────────────
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const nDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d: string) => ISO.test(d) && !isNaN(Date.parse(d + "T00:00:00Z")) && new Date(Date.parse(d + "T00:00:00Z")).toISOString().slice(0, 10) === d;
const rTime = (t: unknown) => {
  if (t == null || t === "") return null; const d = new Date(typeof t === "number" ? t : String(t)); if (isNaN(+d)) return null;
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d) + " +03:00";
};

/** period → [from, to] and the comparison period, exactly like cpRange / cpPrevRange */
function parsePeriod(p0: unknown, cmp0: unknown) {
  const T = today(), y = addDays(T, -1), p = String(p0 || "yesterday").trim().toLowerCase();
  let a: string, b: string, label_ar: string, label_en: string, m: RegExpMatchArray | null;
  if (p === "today" || p === "t") { a = b = T; label_ar = "النهارده"; label_en = "Today"; }
  else if (p === "yesterday" || p === "y") { a = b = y; label_ar = "امبارح"; label_en = "Yesterday"; }
  else if (p === "7d" || p === "7") { a = addDays(T, -7); b = y; label_ar = "آخر 7 أيام"; label_en = "Last 7 days"; }
  else if (p === "30d" || p === "30") { a = addDays(T, -30); b = y; label_ar = "آخر 30 يوم"; label_en = "Last 30 days"; }
  else if ((m = p.match(/^(?:day:)?(\d{4}-\d{2}-\d{2})$/))) { if (!validDay(m[1])) throw bad("التاريخ غلط", "Invalid date"); a = b = m[1]; label_ar = "يوم " + a; label_en = "Day " + a; }
  else if ((m = p.match(/^range:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/))) {
    if (!validDay(m[1]) || !validDay(m[2])) throw bad("التاريخ غلط", "Invalid date");
    [a, b] = m[1] <= m[2] ? [m[1], m[2]] : [m[2], m[1]]; label_ar = "من " + a + " لـ " + b; label_en = a + " → " + b;
  } else throw bad("الفترة لازم تبقى today أو yesterday أو 7d أو 30d أو day:YYYY-MM-DD أو range:A..B", "period must be today | yesterday | 7d | 30d | day:YYYY-MM-DD | range:A..B");
  const n = nDays(a, b); if (n > 92) throw bad("الفترة أقصاها 92 يوم", "Period is limited to 92 days");
  const cmp = String(cmp0 || "prev").toLowerCase() === "week" ? "week" : "prev";
  const [c, d] = cmp === "week" ? [addDays(a, -7), addDays(b, -7)] : [addDays(a, -n), addDays(a, -1)];
  return { from: a, to: b, days: n, label_ar, label_en, compare: { mode: cmp, from: c, to: d, label_ar: cmp === "week" ? "نفس الأيام الأسبوع اللي فات" : "الفترة اللي قبلها", label_en: cmp === "week" ? "Same days last week" : "Previous period" }, today: T };
}

// ───────────── config + clients ─────────────
let CFG: { at: number; v: any } | null = null;
async function config() {
  if (CFG && Date.now() - CFG.at < 60e3) return CFG.v;
  const { data, error } = await sb.from("docs").select("data").eq("path", "config/app").maybeSingle();
  if (error) throw new ApiErr(500, "db", "مش قادر أقرا الإعدادات", "Could not read the configuration");
  CFG = { at: Date.now(), v: data?.data || {} }; return CFG.v;
}
const arKey = (s: unknown) => String(s || "").trim().replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").toLowerCase();
const ALIAS: Record<string, string> = { molabi: "ملبي", mulabbi: "ملبي", malabi: "ملبي", mlby: "ملبي", deiman: "ديمان", dimaan: "ديمان", diman: "ديمان", dimaan_app: "ديمان" };
const PAID_ALL = ["meta", "tiktok", "snap", "asa", "google"];
const PL_NAME: Record<string, [string, string]> = { meta: ["ميتا", "Meta"], tiktok: ["تيك توك", "TikTok"], snap: ["سناب شات", "Snapchat"], asa: ["Apple Search Ads", "Apple Search Ads"], google: ["جوجل", "Google Ads"] };
const isConv = (c: any) => !!(c && c.convSource);
const paidOf = (c: any) => isConv(c) ? ["meta", "tiktok", "snap", "asa", "google"] : ["meta", "tiktok", "snap"];
async function getClient(q: unknown) {
  const C = await config(), list: any[] = C.clients || [];
  if (!list.length) throw new ApiErr(500, "config", "مفيش عملاء في الإعدادات", "No clients configured");
  const s = String(q || "").trim(); if (!s) return { C, c: list[0] };
  const k = arKey(ALIAS[s.toLowerCase()] || s);
  const c = list.find((x) => x.id === s) || list.find((x) => arKey(x.name) === k);
  if (!c) throw new ApiErr(404, "unknown_client", "عميل مش معروف — العملاء: " + list.map((x) => x.name + " (" + x.id + ")").join("، "), "Unknown client — clients: " + list.map((x) => x.id + " = " + x.name).join(", "));
  return { C, c };
}
function thresholds(c: any) {
  if (!(c && c.roasMin > 0)) return null;
  return { min: +c.roasMin, good: c.roasGood > 0 ? +c.roasGood : +c.roasMin * 1.25, alarm: c.roasAlarm > 0 ? +c.roasAlarm : +c.roasMin };
}
function roasTarget(C: any, c: any) {
  const t = (C.targets || []) as any[];
  const x = t.find((q) => q.metricKey === "roas" && q.clientId === c.id) || t.find((q) => q.metricKey === "roas" && q.clientId === "*");
  if (x && x.value > 0) return { v: +x.value, src_ar: "الهدف المحدد", src_en: "the set target" };
  if (c.margin > 0) return { v: 1 / c.margin, src_ar: "نقطة التعادل", src_en: "break-even" };
  return null;
}

// ───────────── data loads (parallel pages) ─────────────
async function all(mk: (count: boolean) => any): Promise<any[]> {
  const r0 = await mk(true).range(0, 999); if (r0.error) throw new ApiErr(500, "db", "خطأ في قاعدة البيانات", "Database error: " + r0.error.message);
  const out: any[] = [...(r0.data || [])], n = r0.count ?? out.length;
  if (n > 1000) {
    const ps: any[] = []; for (let i = 1000; i < n; i += 1000) ps.push(mk(false).range(i, i + 999));
    for (const r of await Promise.all(ps)) { if (r.error) throw new ApiErr(500, "db", "خطأ في قاعدة البيانات", "Database error: " + r.error.message); out.push(...r.data); }
  }
  return out;
}
const AD_COLS = "date,platform,level,account_id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,creative_id,influencer,product,camp_no,spend,purchases,revenue";
const adRows = (cid: string, a: string, b: string) => all((c) => sb.from("ad_daily").select(AD_COLS, c ? { count: "exact" } : undefined)
  .eq("client_id", cid).eq("level", "ad").gte("date", a).lte("date", b).order("date").order("platform").order("ad_id").order("video_id"));
const CONV_CODE: Record<string, string> = { meta: "ME", tiktok: "TT", snap: "SC", asa: "AS", google: "GG" };
async function kzRows(cid: string, conv: boolean, a: string, b: string) {
  if (!conv) return all((c) => sb.from("khzama_link_daily").select("date,platform,camp_no,creative_id,code,product,rest,donations,amount,title,custom", c ? { count: "exact" } : undefined)
    .eq("client_id", cid).gte("date", a).lte("date", b).order("date").order("link_id"));
  const rows = await all((c) => sb.from("conv_daily").select("date,channel,platform,camp_no,campaign,purchases,revenue", c ? { count: "exact" } : undefined)
    .eq("client_id", cid).gte("date", a).lte("date", b).or("platform.not.is.null,channel.eq.web").order("date").order("source_raw").order("campaign"));
  const out: any[] = [];
  rows.forEach((x) => { if (!x.purchases && !x.revenue) return; const web = x.channel === "web";
    out.push({ date: x.date, platform: web ? null : x.platform, camp_no: web ? null : x.camp_no, creative_id: null, code: web ? "com" : (CONV_CODE[x.platform] || "other"),
      product: null, rest: x.campaign || null, title: web ? "salla" : x.campaign, donations: x.purchases || 0, amount: +x.revenue || 0 }); });
  return out;
}
const structRows = (cid: string) => all((c) => sb.from("camp_struct").select("platform,level,id,parent_id,account_id,name,camp_no,status,budget_mode,daily_budget,lifetime_budget,bid_type,bid,updated_at", c ? { count: "exact" } : undefined)
  .eq("client_id", cid).order("platform").order("level").order("id"));
async function campMap(cid: string) {
  const { data } = await sb.from("docs").select("data").eq("coll", "campmap").limit(2000);
  const m: Record<string, string> = {}; (data || []).forEach((r: any) => { const x = r.data || {}; if (x.client === cid) m[x.platform + "|" + x.camp + "|" + String(x.custom).toLowerCase()] = x.adset; });
  return m;
}

// ───────────── the campaign tree (port of cpBuild) ─────────────
type V = { s: number; o: number; r: number; po: number; pr: number; approx: boolean };
const Z = (): V => ({ s: 0, o: 0, r: 0, po: 0, pr: 0, approx: false });
const vadd = (t: V, v: V) => { t.s += v.s || 0; t.o += v.o || 0; t.r += v.r || 0; t.po += v.po || 0; t.pr += v.pr || 0; if (v.approx) t.approx = true; };
const PM_CAMP = /\b([A-Z]{2,4}-\d{3,6})\b/;
const cpNorm = (s: unknown) => String(s || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "");
const cpToks = (s: unknown) => String(s || "").toLowerCase().split(/[^a-z0-9؀-ۿ]+/).filter(Boolean);
const cpCode = (r: any) => { if (r.camp_no) return r.camp_no; const m = String(r.campaign_name || "").match(PM_CAMP); return m ? m[1] : (r.campaign_name || "—"); };
const ACTIVE = /^(active|enable|enabled|delivering)$/i;
const isActive = (x: any) => !!x && ACTIVE.test(String(x.status || ""));

interface Ctx { cid: string; conv: boolean; paid: string[]; struct: any[]; st: Map<string, any>; map: Record<string, string> }
function build(X: Ctx, rows: any[], kz: any[]) {
  const conv = X.conv, P: any = {};
  for (const r of rows) {
    if (r.level !== "ad" || X.paid.indexOf(r.platform) < 0) continue;
    const p = P[r.platform] || (P[r.platform] = { camps: {} }), code = cpCode(r);
    const c = p.camps[r.campaign_id] || (p.camps[r.campaign_id] = { id: r.campaign_id, code, name: r.campaign_name, proj: r.product || "", acct: r.account_id, v: Z(), sets: {}, loose: Z() });
    const s = c.sets[r.adset_id] || (c.sets[r.adset_id] = { id: r.adset_id, name: r.adset_name || "—", v: Z(), ads: {}, loose: Z() });
    const a = s.ads[r.ad_id] || (s.ads[r.ad_id] = { id: r.ad_id, cr: r.creative_id, inf: r.influencer || "", name: r.ad_name, v: Z() });
    a.v.s += +r.spend || 0; a.v.po += +r.purchases || 0; a.v.pr += +r.revenue || 0;
  }
  const byCode: Record<string, any[]> = {};
  Object.keys(P).forEach((pl) => Object.values(P[pl].camps).forEach((c: any) => { (byCode[pl + "|" + c.code] = byCode[pl + "|" + c.code] || []).push(c); }));
  const give = (node: V, o: number, r: number, approx: boolean) => { node.o += o; node.r += r; if (approx) node.approx = true; };
  for (const k of kz) {
    const pl = k.platform; if (!k.camp_no || X.paid.indexOf(pl) < 0) continue;
    const o = +k.donations || 0, rv = +k.amount || 0; if (!o && !rv) continue;
    let cs = byCode[pl + "|" + k.camp_no];
    if (!cs) { const p = P[pl] || (P[pl] = { camps: {} }), id = "kz:" + k.camp_no;
      const c = { id, code: k.camp_no, name: k.camp_no, proj: k.product || "", v: Z(), sets: {}, loose: Z(), kzOnly: true }; p.camps[id] = c; cs = byCode[pl + "|" + k.camp_no] = [c]; }
    const ids: string[] = String(k.title || "").match(/\d{14}/g) || (k.creative_id ? [k.creative_id] : []);
    const hasSet = (x: any) => { if (!k.custom) return false; const cu = String(k.custom).toLowerCase(), nn = cpNorm(cu);
      return Object.values(x.sets).some((st: any) => cpToks(st.name).indexOf(cu) >= 0 || cpNorm(st.name).indexOf(nn) >= 0); };
    const hasVid = (x: any) => Object.values(x.sets).some((st: any) => Object.values(st.ads).some((a: any) => a.cr && ids.indexOf(a.cr) >= 0));
    const spend = (x: any) => Object.values(x.sets).reduce((t: number, st: any) => t + Object.values(st.ads).reduce((u: number, a: any) => u + a.v.s, 0), 0);
    const top = (a: any[]) => a.slice().sort((x, y) => spend(y) - spend(x))[0];
    const c = cs.length === 1 ? cs[0] : top([cs.filter((x) => hasSet(x) && hasVid(x)), cs.filter(hasSet), cs.filter(hasVid), cs].find((a) => a.length) as any[]);
    if (conv) { give(c.loose, o, rv, false); continue; }
    const sets: any[] = Object.values(c.sets);
    let target: any = null;
    if (k.custom) {
      const cu = String(k.custom), mk = pl + "|" + c.code + "|" + cu.toLowerCase(), man = X.map[mk];
      if (man && c.sets[man]) target = c.sets[man];
      else { const n = cpNorm(cu), exact = sets.filter((s) => cpToks(s.name).indexOf(cu.toLowerCase()) >= 0), part = sets.filter((s) => cpNorm(s.name).indexOf(n) >= 0);
        target = exact.length === 1 ? exact[0] : part.length === 1 ? part[0] : sets.length === 1 ? sets[0] : null; }
      if (!target) { const u = c.unmatched || (c.unmatched = {}); const x = u[cu] || (u[cu] = { custom: cu, v: Z() }); give(x.v, o, rv, false); continue; }
    }
    const multi = ids.length > 1 || /SmartAd/i.test(String(k.title || ""));
    if (multi) {
      let ss = target ? [target] : sets.filter((s) => Object.values(s.ads).some((a: any) => a.cr && ids.indexOf(a.cr) >= 0));
      if (!ss.length && sets.length === 1) ss = sets;
      if (ss.length !== 1) { give(c.loose, o, rv, false); continue; }
      const b = ss[0].smart || (ss[0].smart = Z()); give(b, o, rv, false); continue;
    }
    if (target) { const ads = Object.values(target.ads).filter((a: any) => a.cr && ids.indexOf(a.cr) >= 0) as any[];
      if (ads.length !== 1) { give(target.loose, o, rv, false); continue; }
      give(ads[0].v, o, rv, false); continue; }
    let hold = sets.filter((s) => Object.values(s.ads).some((a: any) => a.cr && ids.indexOf(a.cr) >= 0)); if (!hold.length && sets.length === 1) hold = sets;
    if (hold.length !== 1) { give(c.loose, o, rv, false); continue; }
    const ads2 = Object.values(hold[0].ads).filter((a: any) => a.cr && ids.indexOf(a.cr) >= 0) as any[];
    if (ads2.length === 1) give(ads2[0].v, o, rv, false); else give(hold[0].loose, o, rv, false);
  }
  Object.keys(P).forEach((pl) => Object.values(P[pl].camps).forEach((c: any) => {
    Object.values(c.sets).forEach((s: any) => {
      Object.values(s.ads).forEach((a: any) => vadd(s.v, a.v)); vadd(s.v, s.loose);
      if (s.smart) { s.v.o += s.smart.o; s.v.r += s.smart.r; if (s.smart.approx) s.v.approx = true; }
      if (conv) { c.v.s += s.v.s; c.v.po += s.v.po; c.v.pr += s.v.pr; } else vadd(c.v, s.v);
    });
    if (conv) { c.conv = true; c.v.o = c.loose.o; c.v.r = c.loose.r; c.loose = Z(); } else vadd(c.v, c.loose);
    Object.values(c.unmatched || {}).forEach((u: any) => vadd(c.v, u.v));
  }));
  X.struct.filter((x) => x.level === "campaign" && isActive(x) && X.paid.indexOf(x.platform) >= 0).forEach((x) => {
    const p = P[x.platform] || (P[x.platform] = { camps: {} }); if (p.camps[x.id]) return;
    p.camps[x.id] = { id: x.id, code: x.camp_no || x.name, name: x.name, proj: ((String(x.name || "").match(/PR:\s*([^|]+)/) || [])[1] || "").trim(), v: Z(), sets: {}, loose: Z(), conv };
    X.struct.filter((y) => y.level === "adset" && y.parent_id === x.id && isActive(y)).forEach((y) => { p.camps[x.id].sets[y.id] = { id: y.id, name: y.name || "—", v: Z(), ads: {}, loose: Z() }; });
  });
  return P;
}
const statusOf = (X: Ctx, lvl: string, id: unknown, pl: string) => X.st.get(lvl + "|" + String(id) + "|" + pl);
function dayState(X: Ctx, id: unknown, lvl: string, pl: string, next: Set<string> | null) {
  const st = statusOf(X, lvl, id, pl), now = isActive(st);
  if (!next) return st ? (now ? "on" : "off") : "na";
  return next.has(String(id)) ? "on" : (now ? "on" : "off");
}

/** loads everything for one client + period and builds the model (port of cpLoad + cpModel) */
async function loadModel(q: Record<string, any>) {
  const { C, c: client } = await getClient(q.client);
  const per = parsePeriod(q.period, q.compare);
  const conv = isConv(client), cid = client.id, { from: a, to: b } = per, { from: c, to: d } = per.compare;
  const needNext = a === b && a < per.today;
  const [cur, prv, kzC, kzP, nxt, struct, map] = await Promise.all([
    adRows(cid, a, b), adRows(cid, c, d), kzRows(cid, conv, a, b), kzRows(cid, conv, c, d),
    needNext ? adRows(cid, addDays(a, 1), addDays(a, 1)) : Promise.resolve(null), structRows(cid), conv ? Promise.resolve({}) : campMap(cid)]);
  const st = new Map<string, any>(); struct.forEach((x) => { if (x.status === "stale") return; const k = x.level + "|" + x.id + "|" + x.platform; if (!st.has(k)) st.set(k, x); });
  const X: Ctx = { cid, conv, paid: paidOf(client), struct, st, map: map as Record<string, string> };
  const M = build(X, cur, kzC), PV = build(X, prv, kzP), pvIdx: Record<string, V> = {};
  Object.keys(PV).forEach((pl) => Object.values(PV[pl].camps).forEach((cc: any) => { pvIdx["c|" + pl + "|" + cc.code] = cc.v;
    Object.values(cc.sets).forEach((s: any) => { pvIdx["s|" + s.id] = s.v; Object.values(s.ads).forEach((ad: any) => { pvIdx["a|" + ad.id] = ad.v; }); }); }));
  const next = nxt ? new Set<string>(nxt.filter((r) => r.level === "ad" && (+r.spend || 0) > 0).flatMap((r) => [String(r.campaign_id), String(r.adset_id), String(r.ad_id)])) : null;
  const th = thresholds(client), T = roasTarget(C, client), tg = th ? th.min : (T ? T.v : null);
  const plats: string[] = String(q.platform || "").toLowerCase().split(/[,\s]+/).filter(Boolean).map((p) => p === "facebook" || p === "instagram" ? "meta" : p === "snapchat" ? "snap" : p);
  for (const p of plats) if (PAID_ALL.indexOf(p) < 0) throw bad("منصة مش معروفة: " + p, "Unknown platform: " + p + " (meta | tiktok | snap" + (conv ? " | asa | google" : "") + ")");
  const sf = String(q.status || "").toLowerCase(), stf = sf === "on" || sf === "active" || sf === "شغالة" ? "on" : sf === "off" || sf === "paused" || sf === "موقفة" ? "off" : sf ? "x" : "";
  if (stf === "x") throw bad("الحالة لازم تبقى on أو off", "status must be on | off");
  const proj = String(q.project || "").trim();
  const camps: any[] = [], isToday = a === b && a === per.today;
  Object.keys(M).forEach((pl) => { if (plats.length && plats.indexOf(pl) < 0) return;
    Object.values(M[pl].camps).forEach((cc: any) => { cc.pl = pl; cc.st = statusOf(X, "campaign", cc.id, pl);
      if (proj && arKey(cc.proj) !== arKey(proj)) return;
      if (!cc.v.s && !cc.v.o && !(isToday && isActive(cc.st))) return;
      cc.ds = dayState(X, cc.id, "campaign", pl, next);
      if (stf && cc.ds !== stf) return; camps.push(cc); }); });
  const campBudget = (cc: any) => { const s = cc.st; if (!s) return null;
    if (s.budget_mode === "CBO" || s.daily_budget != null && s.budget_mode !== "ABO") return s.daily_budget;
    const on = isActive(s); let sum = 0, any = false;
    struct.filter((x) => x.level === "adset" && x.parent_id === String(cc.id) && x.status !== "stale" && (!on || isActive(x))).forEach((x) => { if (x.daily_budget != null) { sum += +x.daily_budget; any = true; } });
    return any ? sum : null; };
  const tot = Z(), ptot = Z(); let bud = 0;
  camps.forEach((cc) => { vadd(tot, cc.v); const pv = pvIdx["c|" + cc.pl + "|" + cc.code]; if (pv) vadd(ptot, pv); const bb = isActive(cc.st) ? campBudget(cc) : null; if (bb) bud += +bb; });
  const order = (x: any, y: any) => X.paid.indexOf(x.pl) - X.paid.indexOf(y.pl) || y.v.s - x.v.s;
  camps.sort(order);
  return { C, client, per, conv, X, M, PV, pvIdx, next, th, T, tg, camps, tot, ptot, bud, haveStruct: struct.length > 0, cpaRef: tot.o ? tot.s / tot.o : null, campBudget, rowsCount: { ads: cur.length, links: kzC.length } };
}

// ───────────── output shaping ─────────────
const r2 = (v: number | null | undefined) => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;
const roasOf = (v: V) => v.s ? v.r / v.s : null, cpaOf = (v: V) => v.o ? v.s / v.o : null, aovOf = (v: V) => v.o ? v.r / v.o : null;
const delta = (cur: number | null, prev: number | null | undefined) => cur == null || prev == null || !isFinite(prev) || !prev ? null : Math.round((cur - prev) / prev * 1000) / 10;
function verdict(m: any, v: V) {
  const th = m.th, tg = m.tg; if (!th && !tg) return null;
  if (v.o < 2 && v.s < Math.max(150, 2 * (m.cpaRef || 0))) return { key: "early", ar: "لسه بدري", en: "Too early" };
  const ro = roasOf(v) || 0;
  const k = th ? (ro >= th.good ? ["scale", "زوّد", "Scale"] : ro >= th.min ? ["ok", "كويس", "OK"] : ro >= th.alarm ? ["watch", "راقب", "Watch"] : ["alarm", "إنذار", "Alarm"])
    : ro >= tg * 1.1 ? ["scale", "زوّد", "Scale"] : ro >= tg * 0.85 ? ["watch", "راقب", "Watch"] : ["pause", "وقّف", "Pause"];
  return { key: k[0], ar: k[1], en: k[2] };
}
const STATE: Record<string, [string, string]> = { on: ["شغالة", "On"], off: ["موقفة", "Off"], na: ["مش متسجلة", "Unknown"] };
const nums = (v: V, withConv = true) => withConv
  ? { spend: r2(v.s), orders: Math.round(v.o), revenue: r2(v.r), roas: r2(roasOf(v)), cpa: r2(cpaOf(v)), aov: r2(aovOf(v)) }
  : { spend: r2(v.s), orders: null, revenue: null, roas: null, cpa: null, aov: null };
const prevNums = (v: V | undefined, withConv = true) => v ? nums(v, withConv) : null;
function budgetOf(m: any, cc: any) {
  const s = cc.st; if (!s) return null; const mode = s.budget_mode || null;
  return { mode, daily: r2(mode === "ABO" ? m.campBudget(cc) : (s.daily_budget == null ? null : +s.daily_budget)), daily_is_sum_of_adsets: mode === "ABO", lifetime: r2(s.lifetime_budget == null ? null : +s.lifetime_budget), currency: "SAR" };
}
const plOut = (pl: string) => ({ platform: pl, platform_ar: (PL_NAME[pl] || [pl])[0], platform_en: (PL_NAME[pl] || [pl, pl])[1] });
function campRow(m: any, cc: any) {
  const pv = m.pvIdx["c|" + cc.pl + "|" + cc.code];
  const cur = nums(cc.v), prev = prevNums(pv);
  return { ...plOut(cc.pl), id: String(cc.id), code: cc.code, name: cc.name || cc.code, project: cc.proj || null,
    status: cc.st ? cc.st.status : null, state: cc.ds, state_ar: STATE[cc.ds]?.[0], state_en: STATE[cc.ds]?.[1],
    budget: budgetOf(m, cc), ...cur, prev, change_pct: prev ? { spend: delta(cur.spend, prev.spend), orders: delta(cur.orders, prev.orders), revenue: delta(cur.revenue, prev.revenue), roas: delta(cur.roas, prev.roas), cpa: delta(cur.cpa, prev.cpa) } : null,
    verdict: verdict(m, cc.v), only_in_khzama: !!cc.kzOnly || undefined,
    unlinked_custom: Object.values(cc.unmatched || {}).map((u: any) => ({ custom: u.custom, ...nums(u.v) })),
    campaign_level_links: cc.loose.o || cc.loose.r ? nums(cc.loose) : null };
}
function periodOut(per: any) { return { from: per.from, to: per.to, days: per.days, label_ar: per.label_ar, label_en: per.label_en, compare: per.compare, timezone: "Asia/Riyadh" }; }
function kpis(m: any) {
  const t = m.tot, p = m.ptot, conv = m.conv;
  const k = (key: string, ar: string, en: string, cur: number | null, prev: number | null | undefined, unit: string | null, low = false, extra: any = {}) => {
    const d = prev === undefined ? null : delta(cur, prev);
    return { key, label_ar: ar, label_en: en, value: key === "orders" || key === "campaigns" ? (cur == null ? null : Math.round(cur)) : r2(cur), prev: prev === undefined ? undefined : (key === "orders" ? Math.round(prev || 0) : r2(prev)), change_pct: d,
      trend: d == null || Math.abs(d) < 3 ? (d == null ? null : "flat") : ((low ? d < 0 : d > 0) ? "better" : "worse"), unit, lower_is_better: low || undefined, ...extra };
  };
  const nOn = m.camps.filter((c: any) => c.ds === "on").length, nOff = m.camps.filter((c: any) => c.ds === "off").length;
  return [
    k("spend", "الصرف", "Spend", t.s, p.s, "SAR"),
    k("orders", conv ? "الطلبات" : "التبرعات", conv ? "Orders" : "Donations", t.o, p.o, null),
    k("revenue", "الإيراد", "Revenue", t.r, p.r, "SAR"),
    k("roas", "ROAS", "ROAS", roasOf(t), roasOf(p), "x"),
    k("campaigns", "عدد الحملات", "Campaigns", m.camps.length, undefined, null, false, { on: nOn, off: nOff, note_ar: nOn + " شغالة · " + nOff + " موقفة", note_en: nOn + " on · " + nOff + " off" }),
    k("budget", "إجمالي الميزانية", "Total budget", m.haveStruct ? m.bud : null, undefined, "SAR", false, { note_ar: "الميزانية اليومية للحملات الشغالة", note_en: "daily budget of active campaigns" }),
    k("aov", conv ? "متوسط الطلب" : "متوسط التبرع", conv ? "Avg order" : "Avg donation", aovOf(t), aovOf(p), "SAR"),
    k("cpa", conv ? "تكلفة الطلب" : "تكلفة التبرع", conv ? "Cost / order" : "Cost / donation", cpaOf(t), cpaOf(p), "SAR", true),
  ];
}
function thOut(m: any) {
  if (m.th) return { kind: "client_thresholds", alarm_below: m.th.alarm, watch_below: m.th.min, ok_below: m.th.good, scale_from: m.th.good,
    note_ar: "إنذار تحت " + m.th.alarm + "x · راقب لحد " + m.th.min + "x · كويس لحد " + m.th.good + "x · زوّد من " + m.th.good + "x", note_en: "Alarm below " + m.th.alarm + "x · Watch up to " + m.th.min + "x · OK up to " + m.th.good + "x · Scale from " + m.th.good + "x" };
  if (m.tg) return { kind: "roas_target", target: r2(m.tg), source_ar: m.T?.src_ar, source_en: m.T?.src_en };
  return null;
}
async function freshness(cid: string, conv: boolean, struct: any[]) {
  const one = (t: string, col: string, extra?: (q: any) => any) => { let q = sb.from(t).select(col).eq("client_id", cid); if (extra) q = extra(q); return q.order(col, { ascending: false }).limit(1).maybeSingle(); };
  const [adP, adD, kzP, kzD, req, live] = await Promise.all([
    one("ad_daily", "pulled_at"), one("ad_daily", "date"),
    one(conv ? "conv_daily" : "khzama_link_daily", "pulled_at"), one(conv ? "conv_daily" : "khzama_link_daily", "date"),
    sb.from("docs").select("data,updated_at").eq("path", "sys/campreq").maybeSingle(),
    conv ? Promise.resolve({ data: null }) : sb.from("docs").select("data").eq("path", "sys/khzama_live").maybeSingle()]);
  const kl: any = (live as any).data?.data;
  const stMax = struct.reduce((mx, x) => (x.updated_at && x.updated_at > mx ? x.updated_at : mx), "");
  const age = (t: string | null | undefined) => t ? Math.round((Date.now() - Date.parse(t)) / 60e3) : null;
  const rq: any = req.data?.data;
  return {
    spend: { source_ar: "المنصات (ad_daily)", source_en: "ad platforms (ad_daily)", last_pull: rTime(adP.data?.pulled_at), minutes_ago: age(adP.data?.pulled_at), latest_day: adD.data?.date || null },
    orders: { source_ar: conv ? "AppsFlyer + سلة (conv_daily)" : "خزامى (khzama_link_daily)", source_en: conv ? "AppsFlyer + Salla (conv_daily)" : "Khzama (khzama_link_daily)", last_pull: rTime(kzP.data?.pulled_at), minutes_ago: age(kzP.data?.pulled_at), latest_day: kzD.data?.date || null,
      ...(conv ? {} : { khzama_live: kl ? { source_ar: "إضافة كروم «خزامى لحظي» (كل ~2 دقيقة)", source_en: "Chrome extension «khzama-live» (every ~2 min)", last_ok_at: rTime(kl.last_ok_at), minutes_ago: age(kl.last_ok_at ? new Date(kl.last_ok_at).toISOString() : null),
        state: kl.last_state || null, state_at: rTime(kl.last_state_at), detail: kl.last_state === "ok" ? undefined : (kl.last_detail || undefined), today: kl.totals || null } : null }) },
    status_budgets: { source_ar: "camp_struct", source_en: "camp_struct", last_update: rTime(stMax || null), minutes_ago: age(stMax || null) },
    last_refresh_request: rq && rq.client === cid ? { at: rTime(rq.at), status: rq.status || null, parts: rq.parts || null } : null,
  };
}

// ───────────── endpoints ─────────────
async function epClients() {
  const C = await config();
  return { clients: (C.clients || []).map((c: any) => ({ id: c.id, name: c.name, kind: c.kind || "donations", currency: c.currency || "SAR",
    orders_label_ar: isConv(c) ? "الطلبات" : "التبرعات", orders_label_en: isConv(c) ? "Orders" : "Donations",
    orders_source: isConv(c) ? "AppsFlyer + Salla (conv_daily)" : "Khzama (khzama_link_daily)", platforms: paidOf(c),
    roas_thresholds: thresholds(c), roas_target: thresholds(c) ? null : (roasTarget(C, c)?.v ?? null) })) };
}
async function epSummary(q: Record<string, any>) {
  const m = await loadModel(q);
  const fr = await freshness(m.client.id, m.conv, m.X.struct);
  const byPl: any[] = []; m.X.paid.forEach((pl) => { const cs = m.camps.filter((c: any) => c.pl === pl); if (!cs.length) return; const t = Z(); cs.forEach((c: any) => vadd(t, c.v)); byPl.push({ ...plOut(pl), campaigns: cs.length, ...nums(t) }); });
  return { client: { id: m.client.id, name: m.client.name }, period: periodOut(m.per), currency: "SAR", kpis: kpis(m), by_platform: byPl, roas_rules: thOut(m), data_freshness: fr,
    notes_ar: ["الصرف من المنصات، و" + (m.conv ? "الطلبات والإيراد من AppsFlyer وسلة" : "التبرعات والإيراد من خزامى") + " — مش من مشتريات المنصات."],
    notes_en: ["Spend comes from the ad platforms; " + (m.conv ? "orders and revenue from AppsFlyer + Salla" : "donations and revenue from Khzama") + " — never from platform-reported purchases."] };
}
async function epCampaigns(q: Record<string, any>) {
  const m = await loadModel(q);
  const lim = Math.max(1, Math.min(500, parseInt(q.limit) || 200));
  return { client: { id: m.client.id, name: m.client.name }, period: periodOut(m.per), currency: "SAR",
    filters: { platform: q.platform || null, status: q.status || null, project: q.project || null },
    totals: nums(m.tot), prev_totals: nums(m.ptot), count: m.camps.length, roas_rules: thOut(m),
    campaigns: m.camps.slice(0, lim).map((c: any) => campRow(m, c)), truncated: m.camps.length > lim || undefined };
}
async function epCampaign(q: Record<string, any>) {
  const code = String(q.code || q.id || "").trim(); if (!code) throw bad("ابعت code (كود الحملة زي MGG-03059) أو id", "Send code (campaign code like MGG-03059) or id");
  const m = await loadModel({ ...q, platform: q.platform, status: "" });
  const want = code.toLowerCase(), found: any[] = [];
  Object.keys(m.M).forEach((pl) => Object.values(m.M[pl].camps).forEach((cc: any) => {
    if (String(cc.code).toLowerCase() === want || String(cc.id) === code || String(cc.name || "").toLowerCase().indexOf(want) >= 0) { cc.pl = pl; cc.st = statusOf(m.X, "campaign", cc.id, pl); cc.ds = dayState(m.X, cc.id, "campaign", pl, m.next); found.push(cc); } }));
  if (!found.length) throw new ApiErr(404, "not_found", "مفيش حملة بالكود ده في الفترة دي (ولا شغالة دلوقتي)", "No campaign with that code in this period (and none active now)");
  const conv = m.conv;
  const out = found.sort((x, y) => y.v.s - x.v.s).map((cc) => {
    const row: any = campRow(m, cc), mode = cc.st?.budget_mode || "";
    row.adsets = Object.values(cc.sets).map((s: any) => { s.st = statusOf(m.X, "adset", s.id, cc.pl); return s; })
      .filter((s: any) => s.v.s || s.v.o || isActive(s.st)).sort((x: any, y: any) => y.v.s - x.v.s).map((s: any) => {
        const sst = s.st, all = Object.values(s.ads).sort((x: any, y: any) => y.v.s - x.v.s) as any[];
        const st = dayState(m.X, s.id, "adset", cc.pl, m.next);
        const adOut = (ad: any) => { const ast = statusOf(m.X, "ad", ad.id, cc.pl), ds = dayState(m.X, ad.id, "ad", cc.pl, m.next);
          return { id: String(ad.id), name: ad.name || null, creative_id: ad.cr || null, influencer: ad.inf || null, status: ast ? ast.status : null, state: ds, state_ar: STATE[ds]?.[0], state_en: STATE[ds]?.[1],
            ...nums(ad.v, !conv), prev: prevNums(m.pvIdx["a|" + ad.id], !conv), verdict: conv ? null : verdict(m, ad.v) }; };
        let ads: any[], smart: any = null;
        if (!conv && s.smart && (s.smart.o || s.smart.r)) {
          const vids = all.filter((a) => !a.v.o && !a.v.r), sv = Object.assign(Z(), { s: vids.reduce((u, a) => u + a.v.s, 0), o: s.smart.o, r: s.smart.r });
          smart = { label_ar: "إعلان Smart+ · " + vids.length + " فيديو", label_en: "Smart+ ad · " + vids.length + " videos", videos: vids.map((a) => ({ id: String(a.id), creative_id: a.cr || null, influencer: a.inf || null, spend: r2(a.v.s) })), ...nums(sv), verdict: verdict(m, sv) };
          ads = all.filter((a) => a.v.o || a.v.r).map(adOut);
        } else ads = all.map(adOut);
        return { id: String(s.id), name: s.name, status: sst ? sst.status : null, state: st, state_ar: STATE[st]?.[0], state_en: STATE[st]?.[1],
          budget: { daily: sst && sst.daily_budget != null && mode !== "CBO" ? r2(+sst.daily_budget) : null, uses_campaign_budget: mode === "CBO", bid_type: sst?.bid_type || (sst ? "LOWEST_COST" : null), bid: sst?.bid == null ? null : r2(+sst.bid), currency: "SAR" },
          ...nums(s.v, !conv), prev: prevNums(m.pvIdx["s|" + s.id], !conv), verdict: conv ? null : verdict(m, s.v),
          smart_plus: smart, ads, adset_level_links: !conv && (s.loose.o || s.loose.r) ? nums(s.loose) : null };
      });
    if (conv) row.note_ar = "الطلبات والإيراد من AppsFlyer وسلة على مستوى الحملة بس — الـ Ad Set والإعلان بالصرف بس.", row.note_en = "Orders and revenue come from AppsFlyer + Salla per campaign only; ad sets and ads show spend only.";
    return row;
  });
  return { client: { id: m.client.id, name: m.client.name }, period: periodOut(m.per), currency: "SAR", roas_rules: thOut(m), campaigns: out };
}
const daysParam = (q: any) => { const n = parseInt(q.days ?? "7"); if (!(n >= 1 && n <= 90)) throw bad("days من 1 لـ 90", "days must be 1–90"); return n; };
async function epAlerts(q: Record<string, any>) {
  const { c } = await getClient(q.client), n = daysParam(q), since = new Date(Date.now() - n * 864e5).toISOString();
  const { data, error } = await sb.from("alerts_sent").select("id,rule,obj,day,level,title,body,url,sent_at,campaign,platform,kind,status,metric")
    .eq("client_id", c.id).gte("sent_at", since).order("sent_at", { ascending: false }).limit(300);
  if (error) throw new ApiErr(500, "db", "خطأ في قاعدة البيانات", "Database error");
  return { client: { id: c.id, name: c.name }, days: n, count: (data || []).length,
    alerts: (data || []).map((a: any) => ({ id: a.id, at: rTime(a.sent_at), day: a.day, ...(a.platform ? plOut(a.platform) : { platform: null }), campaign: a.campaign, kind: a.kind, rule: a.rule, level: a.level, metric: a.metric, status: a.status, title: a.title, body: a.body, url: a.url })) };
}
async function epChanges(q: Record<string, any>) {
  const { c } = await getClient(q.client), n = daysParam(q), sinceMs = Date.now() - n * 864e5, since = new Date(sinceMs).toISOString();
  const [ch, cc] = await Promise.all([
    sb.from("docs").select("path,data,updated_at").eq("coll", "changes").eq("data->>clientId", c.id).gte("updated_at", since).limit(2000),
    sb.from("docs").select("path,data,updated_at").eq("coll", "campchg").eq("data->>client", c.id).gte("updated_at", since).limit(2000)]);
  if (ch.error || cc.error) throw new ApiErr(500, "db", "خطأ في قاعدة البيانات", "Database error");
  const changes = (ch.data || []).map((r: any) => r.data || {}).filter((x: any) => (+x.ts || Date.parse(x.date || "") || 0) >= sinceMs)
    .sort((x: any, y: any) => (+y.ts || 0) - (+x.ts || 0)).map((x: any) => ({ at: rTime(x.ts), date: x.date || null, ...(x.platformId ? plOut(x.platformId) : { platform: null }), campaign: x.campaign || null,
      level: x.level || null, type: x.type || null, field: x.field || null, edits: x.edits || null, note: x.note || null, by: x.by || null, automatic: !!x.auto, source: x.src || null }));
  const requests = (cc.data || []).map((r: any) => r.data || {}).filter((x: any) => (+x.at || 0) >= sinceMs)
    .sort((x: any, y: any) => (+y.at || 0) - (+x.at || 0)).map((x: any) => ({ at: rTime(x.at), done_at: rTime(x.done_at), ...(x.platform ? plOut(x.platform) : { platform: null }), level: x.level || null,
      name: x.name || null, object_id: x.objId || null, field: x.field || null, from: x.from ?? null, to: x.to ?? null, applied: x.applied ?? null, verified: x.verified ?? null,
      status: x.status || null, error: x.error || null, by: x.by || null, undo_of: x.undoOf || null, batch: x.batch || null }));
  return { client: { id: c.id, name: c.name }, days: n, change_log: changes, edit_requests: requests,
    notes_ar: "change_log = سجل التعديلات (يدوي من الموقع + اللي اتسحب من سجل المنصات). edit_requests = طلبات تعديل الميزانية/المزايدة/الحالة من «أداء الحملات» ونتيجتها.",
    notes_en: "change_log = the change log (site edits + entries pulled from the platforms' activity logs). edit_requests = budget/bid/status edits sent from «أداء الحملات» and their outcome." };
}
async function epRefresh(q: Record<string, any>, key: KeyRow) {
  if (key.scopes.indexOf("refresh") < 0) throw new ApiErr(403, "scope", "المفتاح ده قراية بس — اعمل مفتاح بـ --refresh", "This key is read-only; create one with --refresh");
  const { c } = await getClient(q.client), conv = isConv(c), T = today();
  const rk = "refresh|" + key.id + "|" + c.id, last = RL_REFRESH.get(rk) || 0;
  if (Date.now() - last < 60e3) throw new ApiErr(429, "rate_limited", "استنى دقيقة بين كل تحديث والتاني", "Wait a minute between refreshes");
  RL_REFRESH.set(rk, Date.now());
  const t0 = Date.now();
  await sb.from("docs").upsert({ path: "sys/campreq", coll: "sys", data: { at: Date.now(), by: "api:" + key.name, status: "pending", client: c.id, from: T, to: T, parts: [conv ? "conv" : "khzama"] }, updated_at: new Date().toISOString() });
  let r: any = null;
  try {
    const res = await fetch(SB_URL + "/functions/v1/camp-refresh", { method: "POST", headers: { Authorization: "Bearer " + SRK, apikey: SRK, "content-type": "application/json" }, body: JSON.stringify({ client: c.id, from: T, to: T }) });
    r = await res.json().catch(() => ({ ok: false, error: "HTTP " + res.status }));
  } catch (e) { r = { ok: false, error: String((e as Error)?.message || e).slice(0, 200) }; }
  const plats: any = {}; Object.entries(r?.platforms || {}).forEach(([p, v]: [string, any]) => {
    plats[p] = v === "not_configured" || v === "not_built" ? { status: "not_connected", note_ar: "لسه بيتحدّث من السحب اليومي", note_en: "still updated by the daily pull" }
      : v && v.error ? { status: "error", error: v.error } : { status: "ok", spend_today: r2(v?.spend || 0), rows: v?.rows || 0 }; });
  return { client: { id: c.id, name: c.name }, ok: !!r?.ok, day: T, ms: Date.now() - t0, platforms: plats,
    orders: { status: "queued", note_ar: (conv ? "AppsFlyer + سلة" : "خزامى") + ": اتطلب من المهمة المجدولة — بيوصل خلال دقايق", note_en: (conv ? "AppsFlyer + Salla" : "Khzama") + ": requested from the scheduled task — arrives within minutes" },
    error: r?.ok ? undefined : (r?.error || undefined) };
}

// ───────────── auth + light rate limit ─────────────
interface KeyRow { id: number; name: string; scopes: string[] }
const KEYS = new Map<string, { row: KeyRow | null; at: number }>(), USED = new Map<number, number>();
const RL = new Map<string, number[]>(), RL_BAD = new Map<string, number[]>(), RL_REFRESH = new Map<string, number>();
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
function hit(map: Map<string, number[]>, k: string, max: number, win: number) { const now = Date.now(), a = (map.get(k) || []).filter((t) => now - t < win); a.push(now); map.set(k, a); return a.length > max; }
function bg(p: Promise<unknown>) { try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch { /* */ } }
async function auth(req: Request, allowQuery = false, need = "read"): Promise<KeyRow> {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
  if ((RL_BAD.get(ip) || []).filter((t) => Date.now() - t < 600e3).length >= 20) throw new ApiErr(429, "rate_limited", "محاولات كتير غلط — استنى 10 دقايق", "Too many failed attempts — wait 10 minutes");
  // the gateway checks JWTs (verify_jwt on), so Authorization usually carries the public anon JWT — that is never an API key
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  let raw = (req.headers.get("x-api-key") || (/^eyJ|^sb_publishable_/.test(bearer) ? "" : bearer)).trim(), fromQuery = false;
  // browsing agents (instinct) open a plain link: ?key= is accepted on GET read endpoints only, and only for read-only keys
  if (!raw && allowQuery) { raw = (new URL(req.url).searchParams.get("key") || "").trim(); fromQuery = !!raw; }
  if (!raw) throw new ApiErr(401, "unauthorized", "ابعت مفتاح GADLYTICS في x-api-key (والـ anon key في Authorization: Bearer و apikey)", "Send the GADLYTICS key in x-api-key (and the anon key in Authorization: Bearer + apikey for the gateway)");
  const h = await sha256(raw); let c = KEYS.get(h);
  if (!c || Date.now() - c.at > 30e3) {
    const { data } = await sb.from("api_keys").select("id,name,scopes").eq("key_hash", h).is("revoked_at", null).maybeSingle();
    c = { row: data ? { id: data.id, name: data.name, scopes: data.scopes || ["read"] } : null, at: Date.now() }; KEYS.set(h, c);
  }
  if (!c.row) { hit(RL_BAD, ip, 1e9, 600e3); throw new ApiErr(401, "unauthorized", "المفتاح غلط أو اتلغى", "Invalid or revoked key"); }
  if (fromQuery && c.row.scopes.indexOf("refresh") >= 0) throw new ApiErr(403, "scope", "المفتاح اللي فيه صلاحية التحديث مينفعش يتحط في لينك — اعمل مفتاح قراية بس للينكات", "A key with the refresh scope cannot be used in a link (?key=) — create a read-only key for links");
  // an edit key travels only in the x-api-key header (r.html keeps it in the URL hash, which never reaches a server)
  if (fromQuery && c.row.scopes.indexOf("edit") >= 0) throw new ApiErr(403, "scope", "مفتاح التعديل مينفعش يتحط في ?key= — استخدم لينك r.html#key=… (المفتاح بيتبعت في الهيدر)", "A key with the edit scope cannot be used in ?key= — use the r.html#key=… link (the key goes in the x-api-key header)");
  // a khzama key (extension) can only push Khzama rows; a read / refresh / edit key can't push them
  if (c.row.scopes.indexOf(need) < 0) throw new ApiErr(403, "scope", need === "khzama" ? "المفتاح ده مش مفتاح خزامى — اعمل واحد بـ --khzama" : "المفتاح ده مالوش صلاحية قراية (مفتاح خزامى بس)", need === "khzama" ? "This key has no khzama scope — create one with --khzama" : "This key has no read scope (Khzama push key only)");
  if (hit(RL, "k" + c.row.id, 120, 60e3)) throw new ApiErr(429, "rate_limited", "طلبات كتير — أقصى حاجة 120 في الدقيقة", "Too many requests — 120 per minute max");
  const id = c.row.id; if (Date.now() - (USED.get(id) || 0) > 60e3) { USED.set(id, Date.now()); bg(sb.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", id).then(() => {})); }
  return c.row;
}

// ───────────── edits (scope edit) — GET /edit/preview → confirm_token · POST /edit/apply {confirm_token} ─────────────
const SITE = "https://mahmoudgadmediabuyer.github.io/gadlytics/";
const RHTML = SITE + "r.html";
const EDIT_PL = ["meta", "tiktok", "snap"];                          // camp-apply's platforms
const USD_SNAP = new Set(["961fd033-2f79-4acc-88ba-0b546464d2b2"]);   // shown only; camp-apply does the ÷3.75 itself
const FIELD_AR: Record<string, string> = { budget: "الميزانية اليومية", bid: "المزايدة", status: "الحالة" };
const FIELD_EN: Record<string, string> = { budget: "daily budget", bid: "bid", status: "status" };
const te = new TextEncoder();
const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ub64 = (s: string) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
let TOKKEY: CryptoKey | null = null;
/** HMAC key for confirm tokens, derived from the service-role key (never stored, never leaves the function) */
async function tokKey() {
  if (TOKKEY) return TOKKEY;
  const base = await crypto.subtle.importKey("raw", te.encode(SRK), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = new Uint8Array(await crypto.subtle.sign("HMAC", base, te.encode("gad-api/edit-confirm-token/v1")));
  TOKKEY = await crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return TOKKEY;
}
async function signTok(p: Record<string, unknown>) {
  const body = b64u(te.encode(JSON.stringify(p)));
  return body + "." + b64u(new Uint8Array(await crypto.subtle.sign("HMAC", await tokKey(), te.encode(body))));
}
const tokBad = () => new ApiErr(400, "bad_token", "التأكيد ده مش سليم — اعمل معاينة جديدة", "Invalid confirm_token — make a new preview");
async function readTok(t: string) {
  const m = /^([A-Za-z0-9_-]{16,3000})\.([A-Za-z0-9_-]{43})$/.exec(t); if (!m) throw tokBad();
  if (!(await crypto.subtle.verify("HMAC", await tokKey(), ub64(m[2]), te.encode(m[1])))) throw tokBad();
  let p: any; try { p = JSON.parse(new TextDecoder().decode(ub64(m[1]))); } catch { throw tokBad(); }
  if (!p || p.v !== 1) throw tokBad();
  if (!(+p.exp > Date.now())) throw new ApiErr(410, "token_expired", "التأكيد ده عدّى عليه أكتر من 10 دقايق — افتح اللينك تاني واعمل معاينة جديدة", "confirm_token expired (10 minutes) — make a new preview");
  return p;
}
const needEdit = (key: KeyRow) => { if (key.scopes.indexOf("edit") < 0) throw new ApiErr(403, "scope", "المفتاح ده مالوش صلاحية تعديل — اعمل مفتاح بـ --edit", "This key has no edit scope — create one with --edit"); };
/** Arabic-Indic digits → ASCII, drop thousands separators and a trailing currency word */
const toAscii = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
  .replace(/٫/g, ".").replace(/[,٬،\s]/g, "").replace(/(ريال|ر\.?س|sar|rs)$/i, "");
function parseField(f: unknown) {
  const s = arKey(f);
  if (/^(budget|daily_budget|الميزانيه|ميزانيه|الميزانيه اليوميه)$/.test(s)) return "budget";
  if (/^(bid|المزايده|مزايده|السعر المستهدف|target cost|cost cap|bid cap)$/.test(s)) return "bid";
  if (/^(status|state|الحاله|حاله|تشغيل|ايقاف)$/.test(s)) return "status";
  throw bad("field لازم يبقى budget أو bid أو status", "field must be budget | bid | status");
}
function parseStatus(v: unknown) {
  const s = arKey(v).replace(/ّ/g, "");
  if (/^(on|active|enable|enabled|resume|run|شغل|شغال|شغاله|تشغيل|اشتغل)$/.test(s)) return "ACTIVE";
  if (/^(off|pause|paused|disable|disabled|stop|وقف|موقف|موقفه|ايقاف|اقف)$/.test(s)) return "PAUSED";
  throw bad("للحالة: to=on (تشغيل) أو to=off (إيقاف)", "For status use to=on or to=off");
}
const numOrNull = (v: unknown) => v == null || v === "" || !isFinite(+v!) ? null : +v!;
const fmtVal = (f: string, v: unknown) => f === "status" ? (v === "ACTIVE" ? "شغالة" : v === "PAUSED" ? "موقفة" : "—") : v == null ? "—" : fN(v, Math.round(+v!) === +v! ? 0 : 2) + " ر.س";
const fmtValEn = (f: string, v: unknown) => f === "status" ? (v === "ACTIVE" ? "on" : v === "PAUSED" ? "off" : "—") : v == null ? "—" : fN(v, Math.round(+v!) === +v! ? 0 : 2) + " SAR";
const campOpt = (x: any) => ({ platform: x.platform, platform_ar: (PL_NAME[x.platform] || [x.platform])[0], id: String(x.id), code: x.camp_no || null, name: x.name || null,
  status: x.status || null, state_ar: isActive(x) ? "شغالة" : "موقفة", budget_mode: x.budget_mode || null, daily_budget: numOrNull(x.daily_budget) });
const setOpt = (x: any) => ({ id: String(x.id), name: x.name || null, status: x.status || null, state_ar: isActive(x) ? "شغالة" : "موقفة",
  daily_budget: numOrNull(x.daily_budget), bid_type: x.bid_type || null, bid: numOrNull(x.bid) });
const choose = (what: "campaign" | "adset", options: any[], ar: string, en: string) =>
  new ApiErr(409, "choose_" + what, ar, en, { choose: what, param: what === "campaign" ? "code (id) + platform" : "adset (id)", options });

/** the target of one edit, resolved from camp_struct the way «أداء الحملات» draws its edit cells */
async function editTarget(q: Record<string, any>) {
  const { c: client } = await getClient(q.client), cid = client.id, field = parseField(q.field);
  const code = String(q.code || q.id || "").trim(); if (!code) throw bad("ابعت code (كود الحملة زي MGG-03059 أو الـ id بتاعها)", "Send code (campaign code like MGG-03059, or its id)");
  const plats = String(q.platform || "").toLowerCase().split(/[,\s]+/).filter(Boolean).map((p) => p === "facebook" || p === "instagram" ? "meta" : p === "snapchat" ? "snap" : p);
  for (const p of plats) if (EDIT_PL.indexOf(p) < 0) throw bad("التعديل من هنا لميتا وتيك توك وسناب بس", "Edits support meta | tiktok | snap only");
  const live = (await structRows(cid)).filter((x) => x.status !== "stale");
  const camps = live.filter((x) => x.level === "campaign" && EDIT_PL.indexOf(x.platform) >= 0 && (!plats.length || plats.indexOf(x.platform) >= 0));
  const want = code.toLowerCase();
  let hits = camps.filter((x) => String(x.id) === code);
  if (!hits.length) hits = camps.filter((x) => String(x.camp_no || "").toLowerCase() === want);
  if (!hits.length) hits = camps.filter((x) => { const m = String(x.name || "").match(PM_CAMP); return !!m && m[1].toLowerCase() === want; });
  if (!hits.length && want.length >= 4) hits = camps.filter((x) => String(x.name || "").toLowerCase().indexOf(want) >= 0);
  if (!hits.length) throw new ApiErr(404, "not_found", "مفيش حملة بالكود ده" + (plats.length ? " على المنصة دي" : "") + " — اتأكد من الكود أو دوس «تحديث الأرقام»", "No campaign with that code" + (plats.length ? " on that platform" : ""));
  if (hits.length > 1) throw choose("campaign", hits.map(campOpt), "فيه " + hits.length + " حملات بالكود ده — ابعت platform أو الـ id بتاع الحملة في code", "Several campaigns match — send platform, or the campaign id as code");
  const camp = hits[0], pl = camp.platform, mode = camp.budget_mode || null;
  const sets = live.filter((x) => x.level === "adset" && x.platform === pl && String(x.parent_id) === String(camp.id));
  const aq = String(q.adset || "").trim();
  const pick = (pool: any[], none_ar: string, none_en: string) => {
    let p = pool;
    if (aq) { const w = aq.toLowerCase(); let h = p.filter((s) => String(s.id) === aq);
      if (!h.length) h = p.filter((s) => String(s.name || "").toLowerCase() === w);
      if (!h.length) h = p.filter((s) => String(s.name || "").toLowerCase().indexOf(w) >= 0);
      if (!h.length) throw new ApiErr(404, "adset_not_found", "مفيش Ad Set بالاسم أو الـ id ده في الحملة دي", "No such ad set in this campaign", { choose: "adset", param: "adset (id)", options: pool.map(setOpt) });
      p = h; }
    if (p.length === 1) return p[0];
    if (!p.length) throw new ApiErr(400, "no_target", none_ar, none_en);
    throw choose("adset", p.map(setOpt), "الحملة دي فيها " + p.length + " Ad Sets — ابعت adset (الـ id أو الاسم) عشان أعرف أعدّل أنهي واحد", "This campaign has " + p.length + " ad sets — send adset (id or name)");
  };
  let level: string, row: any;
  if (field === "budget") {
    // same as the page: CBO (or a campaign that carries a daily budget) → the campaign cell; ABO → each ad set's cell
    if (mode === "CBO" || (mode !== "ABO" && camp.daily_budget != null)) {
      if (aq) throw bad("الحملة دي CBO — الميزانية على الحملة نفسها مش على الـ Ad Set (شيل adset)", "This is a CBO campaign — the budget is on the campaign (drop adset)");
      level = "campaign"; row = camp;
    } else { level = "adset"; row = pick(mode === "ABO" ? sets : sets.filter((s) => s.daily_budget != null), "مفيش Ad Set بميزانية يومية في الحملة دي", "No ad set with a daily budget in this campaign"); }
    if (row.lifetime_budget != null && row.daily_budget == null) throw bad("دي ميزانية مدى الحياة — عدّلها من المنصة", "Lifetime budget — change it on the platform");
  } else if (field === "bid") {
    level = "adset"; row = pick(sets.filter((s) => s.bid_type), "مفيش Ad Set بمزايدة في الحملة دي (كلها أقل تكلفة)", "No ad set with a bid in this campaign (lowest cost)");
    if (pl === "meta" && row.bid_type === "ROAS goal") throw bad("هدف الـ ROAS مش متاح من هنا — عدّله من المنصة", "ROAS goal can't be changed from here");
  } else if (aq) { level = "adset"; row = pick(sets, "مفيش Ad Sets في الحملة دي", "No ad sets in this campaign"); }
  else { level = "campaign"; row = camp; }
  const from = field === "status" ? (isActive(row) ? "ACTIVE" : "PAUSED") : numOrNull(field === "budget" ? row.daily_budget : row.bid);
  let to: any;
  if (field === "status") to = parseStatus(q.to);
  else {
    const raw = toAscii(String(q.to ?? "")), n = Number(raw);
    if (!raw || !isFinite(n) || n <= 0) throw bad("اكتب الرقم الجديد في to (رقم أكبر من صفر بالريال)", "to must be a number above zero (SAR)");
    if (field === "budget" && n < 20) throw bad("الميزانية لازم 20 ر.س أو أكتر", "Budget must be 20 SAR or more");
    to = Math.round(n * 100) / 100;                                       // no upper cap — 1,000,000 SAR/day is normal
  }
  const same = field === "status" ? from === to : from != null && Math.abs(+from - +to) < 0.005;
  return { client, cid, pl, level, row, camp, mode, field, from, to, same, code: camp.camp_no || ((String(camp.name || "").match(PM_CAMP) || [])[1]) || camp.name || String(camp.id) };
}
function editWords(t: any) {
  const plAr = (PL_NAME[t.pl] || [t.pl])[0], plEn = (PL_NAME[t.pl] || [t.pl, t.pl])[1];
  const what_ar = (t.level === "adset" ? "الـ Ad Set «" + (t.row.name || t.row.id) + "» في حملة " : "حملة ") + t.code;
  const what_en = (t.level === "adset" ? "ad set “" + (t.row.name || t.row.id) + "” in campaign " : "campaign ") + t.code;
  return { plAr, plEn, what_ar, what_en };
}
async function epEditPreview(q: Record<string, any>, key: KeyRow) {
  needEdit(key);
  const t = await editTarget(q), w = editWords(t), now = Date.now();
  const base = { client: { id: t.cid, name: t.client.name }, ...plOut(t.pl), level: t.level, object_id: String(t.row.id), name: t.level === "adset" ? (t.row.name || null) : (t.camp.name || null),
    campaign: { id: String(t.camp.id), code: t.code, name: t.camp.name || null, budget_mode: t.mode, state_ar: isActive(t.camp) ? "شغالة" : "موقفة", status: t.camp.status || null },
    adset: t.level === "adset" ? setOpt(t.row) : null, field: t.field, field_ar: FIELD_AR[t.field], from: t.from, to: t.to,
    from_text_ar: fmtVal(t.field, t.from), to_text_ar: fmtVal(t.field, t.to), state_ar: isActive(t.row) ? "شغالة" : "موقفة", status: t.row.status || null, currency: "SAR",
    bid_type: t.field === "bid" ? t.row.bid_type || null : undefined,
    platform_amount: t.field !== "status" && t.pl === "snap" && USD_SNAP.has(String(t.row.account_id)) ? { currency: "USD", value: r2(+t.to / 3.75), note_ar: "حساب سناب ده بالدولار — هيتحول ÷3.75 على المنصة" } : undefined,
    note_ar: t.pl === "tiktok" ? "تيك توك: لو لسه مش متوصل مباشرة، التعديل هيفضل مستني في الطابور لحد ما المهمة المجدولة تنفّذه." : undefined,
    only_this_field_ar: t.field === "status" ? "هيتغير التشغيل/الإيقاف بس." : "هيتغير الرقم ده بس — الحالة (" + (isActive(t.row) ? "شغالة" : "موقفة") + ") مش هتتلمس." };
  if (t.same) return { ...base, no_change: true, message_ar: FIELD_AR[t.field] + " " + w.what_ar + " على " + w.plAr + " هي أصلاً " + fmtVal(t.field, t.from) + " — مفيش حاجة تتغير.", message_en: "The " + FIELD_EN[t.field] + " of " + w.what_en + " on " + w.plEn + " is already " + fmtValEn(t.field, t.from) + " — nothing to change." };
  const nonce = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const exp = now + 600e3;
  const confirm_token = await signTok({ v: 1, k: key.id, c: t.cid, p: t.pl, l: t.level, o: String(t.row.id), f: t.field, fr: t.from, to: t.to,
    n: t.level === "adset" ? (t.row.name || "") : t.code, cc: t.code, bt: t.field === "bid" ? (t.row.bid_type || null) : null, exp, j: nonce });
  return { ...base, no_change: false,
    message_ar: "هغيّر " + FIELD_AR[t.field] + " " + w.what_ar + " على " + w.plAr + ": من " + fmtVal(t.field, t.from) + " لـ " + fmtVal(t.field, t.to) + ".",
    message_en: "Will change the " + FIELD_EN[t.field] + " of " + w.what_en + " on " + w.plEn + ": from " + fmtValEn(t.field, t.from) + " to " + fmtValEn(t.field, t.to) + ".",
    confirm_token, expires_at: rTime(exp), expires_in_s: 600,
    apply: { method: "POST", url: BASE + "/edit/apply", body: { confirm_token: "<confirm_token>" }, note_ar: "مفيش حاجة اتغيرت لسه — التعديل بيحصل بس لما تبعت التأكيد (زرار «تأكيد التعديل» في r.html)." } };
}
async function epEditApply(b: any, key: KeyRow) {
  needEdit(key);
  const t0 = Date.now(), tok = String(b?.confirm_token || "").trim();
  if (!tok) throw bad("ابعت confirm_token اللي رجع من /edit/preview", "Send the confirm_token from /edit/preview");
  const p = await readTok(tok);
  if (p.k !== key.id) throw new ApiErr(403, "token_key", "التأكيد ده معمول بمفتاح تاني", "This confirm_token belongs to another key");
  const now = Date.now(), by = "api:" + key.name;
  // 30 edits / hour per key and «same object within 15 s» — counted from the campchg docs themselves (shared by every isolate)
  const [mine, same] = await Promise.all([
    sb.from("docs").select("path,data").eq("coll", "campchg").eq("data->>by", by).gte("updated_at", new Date(now - 3600e3).toISOString()).limit(500),
    sb.from("docs").select("path,data").eq("coll", "campchg").eq("data->>objId", String(p.o)).gte("updated_at", new Date(now - 15e3).toISOString()).limit(50)]);
  if (mine.error || same.error) throw new ApiErr(500, "db", "خطأ في قاعدة البيانات", "Database error");
  if ((mine.data || []).filter((r: any) => (+r.data?.at || 0) > now - 3600e3).length >= 30) throw new ApiErr(429, "rate_limited", "وصلت لـ 30 تعديل في الساعة بالمفتاح ده — استنى شوية", "30 edits per hour per key — wait a bit");
  if ((same.data || []).some((r: any) => (+r.data?.at || 0) > now - 15e3)) throw new ApiErr(409, "duplicate", "فيه تعديل على نفس الحاجة من أقل من 15 ثانية — اتأكد من النتيجة الأول، ولو لسه عايز تعدّل استنى شوية", "The same object was edited less than 15 s ago — duplicate refused");
  const { data: row, error: re } = await sb.from("camp_struct").select("*").eq("client_id", p.c).eq("platform", p.p).eq("level", p.l).eq("id", p.o).maybeSingle();
  if (re) throw new ApiErr(500, "db", "خطأ في قاعدة البيانات", "Database error");
  if (!row || row.status === "stale") throw new ApiErr(404, "not_found", "الكيان ده مبقاش موجود — دوس «تحديث الأرقام» واعمل معاينة جديدة", "The object is gone — refresh and preview again");
  const from = p.f === "status" ? (isActive(row) ? "ACTIVE" : "PAUSED") : numOrNull(p.f === "budget" ? row.daily_budget : row.bid);
  const eq = (a: any, b2: any) => p.f === "status" ? a === b2 : (a == null && b2 == null) || (a != null && b2 != null && Math.abs(+a - +b2) < 0.005);
  if (!eq(from, p.fr)) throw new ApiErr(409, "changed", "القيمة اتغيّرت من وقت المعاينة (بقت " + fmtVal(p.f, from) + ") — اعمل معاينة جديدة", "The value changed since the preview (now " + fmtValEn(p.f, from) + ") — preview again");
  const plAr = (PL_NAME[p.p] || [p.p])[0], plEn = (PL_NAME[p.p] || [p.p, p.p])[1];
  const what_ar = (p.l === "adset" ? "الـ Ad Set «" + p.n + "» في حملة " : "حملة ") + p.cc, what_en = (p.l === "adset" ? "ad set “" + p.n + "” in campaign " : "campaign ") + p.cc;
  const stateAr = isActive(row) ? "شغالة" : "موقفة";
  if (eq(from, p.to)) return { ok: true, result: "no_change", applied: false, pending: false, message_ar: FIELD_AR[p.f] + " " + what_ar + " هي أصلاً " + fmtVal(p.f, from) + " — مفيش حاجة اتغيرت.", message_en: "Already " + fmtValEn(p.f, from) + " — nothing changed." };
  // the same campchg doc «أداء الحملات» writes (cpSave / cpSwitch), then the same camp-apply call (cpApply)
  const id = "api" + String(p.j).replace(/[^a-f0-9]/g, "").slice(0, 24);
  const doc = { client: p.c, platform: p.p, level: p.l, objId: String(p.o), name: p.n || "", field: p.f, bidType: p.bt || null, from, to: p.to, status: "pending", at: now, by, undoOf: null, batch: null };
  const ins = await sb.from("docs").insert({ path: "campchg/" + id, coll: "campchg", data: doc, updated_at: new Date().toISOString() });
  if (ins.error) { if ((ins.error as any).code === "23505") throw new ApiErr(409, "already_used", "التأكيد ده اتستخدم قبل كده — التعديل اتبعت مرة واحدة بس", "This confirm_token was already used"); throw new ApiErr(500, "db", "مقدرتش أسجّل الطلب", "Could not record the request"); }
  let r: any = null;
  try {
    const res = await fetch(SB_URL + "/functions/v1/camp-apply", { method: "POST", headers: { Authorization: "Bearer " + SRK, apikey: SRK, "content-type": "application/json" },
      body: JSON.stringify({ client: doc.client, platform: doc.platform, level: doc.level, objId: doc.objId, field: doc.field, to: doc.to, docId: id }) });
    r = await res.json().catch(() => ({ ok: false, code: "http", error: "HTTP " + res.status }));
  } catch (e) { r = { ok: false, code: "net", error: String((e as Error)?.message || e).slice(0, 200) }; }
  const pendingCodes = ["not_configured", "missing", "net", "taken"];
  const result = r?.ok ? "applied" : pendingCodes.indexOf(r?.code) >= 0 ? "pending" : "failed";
  // camp-apply refused before claiming the doc (bad / unauthorized / http): don't leave it in the queue for the scheduled task
  if (result === "failed") await sb.from("docs").update({ data: { ...doc, status: "failed", error: r?.error || "فشل", done_at: Date.now() }, updated_at: new Date().toISOString() })
    .eq("path", "campchg/" + id).filter("data->>status", "eq", "pending").then(() => {}, () => {});
  const fv = fmtVal(p.f, from), tv = fmtVal(p.f, p.to), keep = p.f === "status" ? "" : " · الحالة زي ما هي (" + stateAr + ")";
  const message_ar = result === "applied"
    ? "تم ✓ " + FIELD_AR[p.f] + " " + what_ar + " على " + plAr + " بقت " + tv + " (كانت " + fv + ")" + (r.verified ? " — اتأكدت من المنصة" : "") + keep + "."
    : result === "pending"
      ? "مستني (" + (p.p === "tiktok" ? "تيك توك لسه مش متوصل" : r?.code === "taken" ? "بيتنفّذ دلوقتي" : plAr + " لسه مردتش") + ") — الطلب اتسجل: " + FIELD_AR[p.f] + " " + what_ar + " من " + fv + " لـ " + tv + "، وهيتنفّذ من المهمة المجدولة خلال دقايق."
      : "مااتنفذش ✗ " + FIELD_AR[p.f] + " " + what_ar + " على " + plAr + " — " + (r?.error || "حصل خطأ") + (r?.detail ? " (" + String(r.detail).slice(0, 160) + ")" : "") + ". مفيش حاجة اتغيرت.";
  const message_en = result === "applied" ? "Done ✓ " + FIELD_EN[p.f] + " of " + what_en + " on " + plEn + " is now " + fmtValEn(p.f, p.to) + " (was " + fmtValEn(p.f, from) + ")."
    : result === "pending" ? "Pending — queued for the scheduled task (" + (r?.code || "") + ")." : "Not applied — " + (r?.error || "error") + ".";
  // push to Mahmoud's devices (same push function as the alerts) — in the background, the answer doesn't wait for it
  const pushBody = key.name + " عدّل " + FIELD_AR[p.f] + " " + what_ar + " (" + plAr + "): من " + fv + " لـ " + tv + (result === "applied" ? " ✓" : result === "pending" ? " — مستني" : " — فشل ✗");
  bg(fetch(SB_URL + "/functions/v1/push", { method: "POST", headers: { Authorization: "Bearer " + SRK, apikey: SRK, "content-type": "application/json" },
    body: JSON.stringify({ action: "send", to: "all", title: "GADLYTICS · تعديل من " + key.name, body: pushBody, url: SITE + "?p=campperf", tag: "apiedit-" + doc.objId,
      kind: "edit", rule: "edit", client: doc.client, campaign: p.cc, platform: doc.platform, obj: doc.objId, force: true }) }).then((x) => x.text()).catch(() => {}));
  return { ok: result !== "failed", result, applied: result === "applied", pending: result === "pending", verified: result === "applied" ? !!r.verified : false,
    message_ar, message_en, ...plOut(p.p), level: p.l, object_id: String(p.o), name: p.n || null, campaign: { code: p.cc }, field: p.f, from, to: p.to,
    read_back: r?.readBack ?? null, currency: "SAR", state_ar: p.f === "status" ? undefined : stateAr, error_code: result === "failed" ? (r?.code || "error") : undefined,
    doc_id: id, by, platform_ms: r?.ms ?? null, ms: Date.now() - t0,
    undo_ar: result === "failed" ? undefined : "يترجع من «أداء الحملات» ← سجل التعديلات ← «رجّع»، أو بلينك تعديل تاني بالقيمة القديمة (" + fv + ")." };
}

// ───────────── MCP ─────────────
const P_CLIENT = { type: "string", description: "Client id or name: ملبي (3sa3k1k, default) or ديمان (dm1n4an). | العميل: ملبي أو ديمان" };
const P_PERIOD = { type: "string", description: "today | yesterday (default) | 7d | 30d | day:YYYY-MM-DD | range:YYYY-MM-DD..YYYY-MM-DD (Asia/Riyadh, max 92 days). | الفترة" };
const P_CMP = { type: "string", enum: ["prev", "week"], description: "Comparison: prev = the previous period of the same length (default), week = same days last week. | المقارنة" };
const P_DAYS = { type: "integer", minimum: 1, maximum: 90, description: "How many days back (default 7). | كام يوم لورا" };
const TOOLS = [
  { name: "list_clients", ep: "clients", title: "Clients · العملاء", description: "List the clients in GADLYTICS (ملبي, ديمان) with their platforms, where orders/donations come from, and their ROAS rules. | العملاء ومنصاتهم ومصدر التبرعات/الطلبات وحدود الـ ROAS.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_summary", ep: "summary", title: "Summary · الملخص", description: "The 8 headline KPIs of «أداء الحملات» for a period — spend, donations/orders, revenue, ROAS, number of campaigns (on/off), total daily budget, average donation, cost per donation — with change vs the comparison period, per-platform totals and data freshness. Spend is from the ad platforms; donations and revenue from Khzama (ملبي) or AppsFlyer+Salla (ديمان), never platform purchases. | الملخص: 8 كروت أداء الحملات مع المقارنة وآخر تحديث للداتا.", inputSchema: { type: "object", properties: { client: P_CLIENT, period: P_PERIOD, compare: P_CMP }, additionalProperties: false } },
  { name: "list_campaigns", ep: "campaigns", title: "Campaigns · الحملات", description: "Every campaign in the period with spend, donations/orders, revenue, ROAS, cost per donation, previous-period values, on/off state, current daily budget and the verdict (Scale زوّد / OK كويس / Watch راقب / Alarm إنذار / Too early لسه بدري). Filter by platform and status. | قايمة الحملات بأرقامها والحكم والميزانية.", inputSchema: { type: "object", properties: { client: P_CLIENT, period: P_PERIOD, compare: P_CMP, platform: { type: "string", description: "meta | tiktok | snap (ديمان also asa | google); comma-separated allowed. | المنصة" }, status: { type: "string", enum: ["on", "off"], description: "on = running, off = paused. | شغالة أو موقفة" }, project: { type: "string", description: "Project / product name from the campaign name (PR:). | المشروع" }, limit: { type: "integer", minimum: 1, maximum: 500 } }, additionalProperties: false } },
  { name: "get_campaign", ep: "campaign", title: "Campaign detail · تفاصيل حملة", description: "One campaign (by code like MGG-03059, or platform id) with its ad sets (status, budget, bid) and ads (creative id, influencer, spend, donations, ROAS, verdict); a TikTok Smart+ ad counts as ONE ad. | حملة واحدة بالـ Ad Sets والإعلانات.", inputSchema: { type: "object", properties: { client: P_CLIENT, code: { type: "string", description: "Campaign code (e.g. MGG-03059) or platform campaign id. | كود الحملة" }, period: P_PERIOD, compare: P_CMP, platform: { type: "string" } }, required: ["code"], additionalProperties: false } },
  { name: "list_alerts", ep: "alerts", title: "Alerts · التنبيهات", description: "Alerts the system sent (ROAS drops, spend without donations, new media, …) in the last N days. | التنبيهات اللي اتبعتت آخر كام يوم.", inputSchema: { type: "object", properties: { client: P_CLIENT, days: P_DAYS }, additionalProperties: false } },
  { name: "list_changes", ep: "changes", title: "Change log · سجل التعديلات", description: "Budget / bid / status changes in the last N days: the change log (site + platform activity logs) and the edit requests sent from «أداء الحملات» with their result. | سجل التعديلات وطلبات التعديل.", inputSchema: { type: "object", properties: { client: P_CLIENT, days: P_DAYS }, additionalProperties: false } },
  { name: "refresh_numbers", ep: "refresh", title: "Refresh numbers · تحديث الأرقام", description: "Same as the «تحديث الأرقام» button: pulls TODAY's spend and campaign status from Meta + Snapchat in ~10 s and asks the scheduled task for Khzama / AppsFlyer + Salla (minutes). Needs a key with the refresh scope; once a minute at most. Changes nothing on the ad accounts. | تحديث أرقام النهارده.", inputSchema: { type: "object", properties: { client: P_CLIENT }, additionalProperties: false } },
];
const MCP_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
async function runEp(ep: string, q: Record<string, any>, key: KeyRow) {
  switch (ep) {
    case "clients": return epClients();
    case "summary": return epSummary(q);
    case "campaigns": return epCampaigns(q);
    case "campaign": return epCampaign(q);
    case "alerts": return epAlerts(q);
    case "changes": return epChanges(q);
    case "refresh": return epRefresh(q, key);
  }
  throw new ApiErr(404, "not_found", "مفيش endpoint بالاسم ده", "No such endpoint");
}
async function mcpOne(msg: any, key: KeyRow): Promise<any | null> {
  const id = msg?.id ?? null, isNote = msg && msg.id === undefined;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result }), er = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return isNote ? null : er(-32600, "Invalid Request");
  const m = msg.method;
  if (m.startsWith("notifications/")) return null;
  if (m === "initialize") {
    const want = msg.params?.protocolVersion;
    return ok({ protocolVersion: MCP_VERSIONS.indexOf(want) >= 0 ? want : MCP_VERSIONS[0], capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "gadlytics", title: "GADLYTICS", version: VERSION },
      instructions: "GADLYTICS media-buying data for ملبي (donations, Khzama) and ديمان (orders, AppsFlyer+Salla). Read-only. Money is SAR, dates Asia/Riyadh. Start with get_summary, then list_campaigns / get_campaign. Spend is from the ad platforms; donations/orders and revenue never from platform purchases. Reply to Mahmoud in Egyptian Arabic." });
  }
  if (m === "ping") return ok({});
  if (m === "tools/list") return ok({ tools: TOOLS.map(({ ep: _e, ...t }) => t) });
  if (m === "tools/call") {
    const t = TOOLS.find((x) => x.name === msg.params?.name); if (!t) return er(-32602, "Unknown tool: " + msg.params?.name);
    const args = msg.params?.arguments || {}; if (typeof args !== "object" || Array.isArray(args)) return er(-32602, "arguments must be an object");
    try { const r = await runEp(t.ep, args, key); return ok({ content: [{ type: "text", text: JSON.stringify(r) }], structuredContent: r, isError: false }); }
    catch (e) { const x = e instanceof ApiErr ? e : new ApiErr(500, "error", "حصل خطأ", String((e as Error)?.message || e).slice(0, 200));
      return ok({ content: [{ type: "text", text: JSON.stringify({ ok: false, code: x.code, error_ar: x.ar, error_en: x.en }) }], isError: true }); }
  }
  if (m === "resources/list") return ok({ resources: [] });
  if (m === "prompts/list") return ok({ prompts: [] });
  return isNote ? null : er(-32601, "Method not found: " + m);
}

// ───────────── OpenAPI 3.1 ─────────────
function openapi() {
  const qp = (name: string, schema: any, description: string, required = false) => ({ name, in: "query", required, schema, description });
  const common = [qp("client", { type: "string" }, P_CLIENT.description), qp("period", { type: "string", default: "yesterday" }, P_PERIOD.description), qp("compare", { type: "string", enum: ["prev", "week"] }, P_CMP.description)];
  const resp = { "200": { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "401": { description: "Missing / invalid key" }, "429": { description: "Rate limited" } };
  const get = (id: string, summary: string, params: any[]) => ({ get: { operationId: id, summary, description: TOOLS.find((t) => t.name === id)?.description, parameters: params, responses: resp } });
  return {
    openapi: "3.1.0",
    info: { title: "GADLYTICS API", version: VERSION, description: "API for AI assistants over GADLYTICS (ملبي / ديمان) — read-only except /edit/* (scope edit). Spend from the ad platforms, donations/orders and revenue from Khzama or AppsFlyer+Salla. SAR, Asia/Riyadh. Also available as an MCP server at " + BASE + "/mcp." },
    servers: [{ url: BASE }],
    security: [{ ApiKey: [], AnonBearer: [], AnonApikey: [] }],
    components: { securitySchemes: {
      ApiKey: { type: "apiKey", in: "header", name: "x-api-key", description: "Your GADLYTICS API key (from make_api_key.py). | مفتاح GADLYTICS" },
      AnonBearer: { type: "http", scheme: "bearer", description: "Supabase gateway: Authorization: Bearer <public anon key> (from the site's config.js). Not the API key." },
      AnonApikey: { type: "apiKey", in: "header", name: "apikey", description: "Supabase gateway: apikey: <public anon key>." } } },
    paths: {
      "/report": { get: { operationId: "get_report", summary: "One-page report (HTML or text) · تقرير صفحة واحدة", description: "Everything in one page for browsing agents: freshness, 8 KPIs, campaigns, top/bottom ROAS, last alerts and changes. Browsing agents (instinct) open " + RHTML + "#key=<KEY>&client=3sa3k1k&period=today — r.html keeps the key in the URL hash (never sent to a server) and calls this endpoint with the x-api-key header. ?key=<read-only key> also works for read-only keys; refresh / edit keys are header only.",
        parameters: [...common, qp("format", { type: "string", enum: ["html", "text"] }, "html (default) or text"), qp("key", { type: "string" }, "read-only key, for plain links only")], responses: { "200": { description: "HTML or text", content: { "text/html": {}, "text/plain": {} } } } } },
      "/clients": get("list_clients", "Clients · العملاء", []),
      "/summary": get("get_summary", "Summary KPIs · الملخص", common),
      "/campaigns": get("list_campaigns", "Campaigns · الحملات", [...common, qp("platform", { type: "string" }, "meta | tiktok | snap (ديمان: + asa | google)"), qp("status", { type: "string", enum: ["on", "off"] }, "on | off"), qp("project", { type: "string" }, "Project (PR:)"), qp("limit", { type: "integer" }, "max rows (default 200)")]),
      "/campaign": get("get_campaign", "Campaign detail · تفاصيل حملة", [qp("code", { type: "string" }, "Campaign code (MGG-03059) or platform id", true), ...common, qp("platform", { type: "string" }, "optional platform filter")]),
      "/alerts": get("list_alerts", "Alerts · التنبيهات", [qp("client", { type: "string" }, P_CLIENT.description), qp("days", { type: "integer", default: 7 }, P_DAYS.description)]),
      "/changes": get("list_changes", "Change log · سجل التعديلات", [qp("client", { type: "string" }, P_CLIENT.description), qp("days", { type: "integer", default: 7 }, P_DAYS.description)]),
      "/edit/preview": { get: { operationId: "edit_preview", summary: "Preview one edit · معاينة تعديل", description: "Needs the edit scope (header key only). Resolves the target exactly like «أداء الحملات»: CBO → campaign budget, ABO → the ad set (several → 409 choose_adset with options). Changes NOTHING; returns current and new value, platform, level, object id, name, state and a confirm_token valid 10 minutes. Money is SAR (Snap USD account converted by the server). No budget cap. Browsing agents: " + RHTML + "#key=<EDIT KEY>&client=3sa3k1k&edit=1&code=MGG-03059&field=budget&to=500",
        parameters: [qp("client", { type: "string" }, P_CLIENT.description), qp("code", { type: "string" }, "Campaign code (MGG-03059) or platform campaign id", true), qp("field", { type: "string", enum: ["budget", "bid", "status"] }, "budget | bid | status", true),
          qp("to", { type: "string" }, "New value: number in SAR (Arabic digits ok), or on / off for status", true), qp("adset", { type: "string" }, "Ad set id or name (ABO budget, bid, or ad-set on/off)"), qp("platform", { type: "string" }, "meta | snap | tiktok when the code exists on several")],
        responses: { ...resp, "403": { description: "Key lacks the edit scope" }, "404": { description: "Campaign / ad set not found" }, "409": { description: "choose_campaign / choose_adset: several matches, options listed" } } } },
      "/edit/apply": { post: { operationId: "edit_apply", summary: "Apply a previewed edit · تأكيد التعديل", description: "Needs the edit scope, x-api-key header only (never ?key=). Body {confirm_token}. Writes the same campchg doc the site writes (by api:<key name>), calls camp-apply (only that one field changes, read back from the platform), logs it in the change log (undo works) and pushes a notification. result = applied | pending (TikTok not connected → stays in the queue) | failed. 30 edits/hour per key; the same object within 15 s → 409 duplicate; a token works once (409 already_used) and expires after 10 minutes (410).",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["confirm_token"], properties: { confirm_token: { type: "string" } } } } } }, responses: { ...resp, "403": { description: "Key lacks the edit scope" }, "409": { description: "duplicate | already_used | changed" }, "410": { description: "confirm_token expired" } } } },
      "/refresh": { post: { operationId: "refresh_numbers", summary: "Refresh today's numbers · تحديث الأرقام", description: TOOLS.find((t) => t.name === "refresh_numbers")?.description,
        requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { client: P_CLIENT } } } } }, responses: { ...resp, "403": { description: "Key lacks the refresh scope" } } } },
      "/khzama/push": { post: { operationId: "khzama_push", summary: "Khzama live snapshot (extension) · خزامى لحظي", description: "Scope khzama only (a khzama key can't call anything else). Body {date: today|yesterday (Riyadh), complete: true, rows: [{link_id, title, donations, amount}]}. The server parses the titles, upserts, and with complete=true deletes that day's links missing from the push. Refused (409 guard) when donations < 50% of the stored day (unless stored < 5). 1 push / 30 s. Returns before/stored totals.",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["date", "rows"], properties: { date: { type: "string" }, complete: { type: "boolean" }, rows: { type: "array", items: { type: "object" } } } } } } }, responses: { ...resp, "403": { description: "Key lacks the khzama scope" }, "409": { description: "guard" } } } },
      "/khzama/status": { post: { operationId: "khzama_status", summary: "Khzama live state · حالة السحب اللحظي", description: "Scope khzama only. Body {state: ok|login_required|error, detail}. login_required / error → one push notification per state per 2 h. Heartbeat in docs sys/khzama_live (→ /summary data_freshness.orders.khzama_live).",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["state"], properties: { state: { type: "string", enum: ["ok", "login_required", "error"] }, detail: { type: "string" } } } } } }, responses: { ...resp, "403": { description: "Key lacks the khzama scope" } } } },
    },
  };
}

// ───────────── /report — one plain page for browsing agents (instinct): no JS, RTL, < 50 KB ─────────────
async function report(q: Record<string, any>) {
  const m = await loadModel({ client: q.client, period: q.period, compare: q.compare, platform: q.platform, status: q.status, project: q.project });
  const [fr, al, ch] = await Promise.all([freshness(m.client.id, m.conv, m.X.struct), epAlerts({ client: m.client.id, days: 7 }), epChanges({ client: m.client.id, days: 7 })]);
  const rows = m.camps.slice(0, 150).map((c: any) => campRow(m, c));
  const rated = rows.filter((r: any) => r.roas != null && r.spend > 0 && (!r.verdict || r.verdict.key !== "early"));
  const pool = rated.length >= 2 ? rated : rows.filter((r: any) => r.roas != null && r.spend > 0);
  const top = pool.slice().sort((a: any, b: any) => b.roas - a.roas).slice(0, 3);
  const bottom = pool.slice().sort((a: any, b: any) => a.roas - b.roas).filter((r: any) => top.length < 3 || top.indexOf(r) < 0 || pool.length <= 3).slice(0, 3);
  const changes = [
    ...ch.change_log.map((x: any) => ({ at: x.at || x.date || "", text: [x.campaign, x.field || x.type, (x.edits || []).map((e: any) => (e.old ?? "?") + " → " + (e.new ?? "?")).join(" ، "), x.automatic ? "(من المنصة)" : "", x.platform_ar].filter(Boolean).join(" · ") })),
    ...ch.edit_requests.map((x: any) => ({ at: x.at || "", text: [x.name, x.field === "budget" ? "الميزانية" : x.field === "bid" ? "المزايدة" : x.field === "status" ? "الحالة" : x.field, (x.from ?? "?") + " → " + (x.to ?? "?"), x.status === "done" ? "اتنفّذ ✓" : x.status === "failed" ? "فشل ✗ " + (x.error || "") : x.status, x.platform_ar].filter(Boolean).join(" · ") })),
  ].sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0)).slice(0, 10);
  return { m, fr, k: kpis(m), rows, more: Math.max(0, m.camps.length - rows.length), top, bottom, alerts: al.alerts.slice(0, 10), changes };
}
const EDIT_HELP_AR = "تعديل حملة (مفتاح فيه صلاحية تعديل بس): " + RHTML + "#key=<المفتاح>&client=3sa3k1k&edit=1&code=<كود الحملة>&field=budget|bid|status&to=<رقم بالريال أو on/off>" +
  " — ولو الحملة ABO وفيها أكتر من Ad Set زوّد &adset=<الـ id أو الاسم>، ولو الكود على أكتر من منصة زوّد &platform=meta|snap|tiktok. اللينك بيعرض معاينة بس؛ التعديل بيحصل لما تدوس «تأكيد التعديل»، والنتيجة بتظهر مكتوبة (تم ✓ / مستني / مااتنفذش).";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
const fN = (v: unknown, d = 0) => v == null || !isFinite(+v!) ? "—" : (+v!).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fK = (k: any) => k.value == null ? "—" : k.key === "roas" ? fN(k.value, 2) + "x" : fN(k.value) + (k.unit === "SAR" ? " ر.س" : "");
const fD = (k: any) => k.change_pct == null ? "" : (k.change_pct > 0 ? "▲ " : k.change_pct < 0 ? "▼ " : "") + fN(Math.abs(k.change_pct), 1) + "%" + (k.trend === "better" ? " (أحسن)" : k.trend === "worse" ? " (أسوأ)" : " (زي ما هو)");
const fR = (v: unknown) => v == null ? "—" : fN(v, 2) + "x";
const vd = (r: any) => r.verdict ? r.verdict.ar : "—";
function frLine(fr: any) {
  return "الصرف: آخر سحب " + (fr.spend.last_pull || "—") + " (آخر يوم " + (fr.spend.latest_day || "—") + ") · " + (fr.orders.source_ar.split(" (")[0]) + ": آخر سحب " + (fr.orders.last_pull || "—") + " (آخر يوم " + (fr.orders.latest_day || "—") + ") · الحالة والميزانيات: " + (fr.status_budgets.last_update || "—");
}
function reportHtml(R: any, ms: number) {
  const m = R.m, ol = m.conv ? "الطلبات" : "التبرعات";
  const camp = (r: any) => "<tr><td>" + esc(r.code) + "</td><td>" + esc(r.platform_ar) + "</td><td>" + esc(r.state_ar || "—") + "</td><td>" + fN(r.spend) + "</td><td>" + fN(r.orders) + "</td><td>" + fN(r.revenue) + "</td><td>" + fR(r.roas) + "</td><td>" + esc(vd(r)) + "</td><td>" + (r.budget && r.budget.daily != null ? fN(r.budget.daily) + (r.budget.mode ? " " + esc(r.budget.mode) : "") : "—") + "</td></tr>";
  const mini = (t: string, a: any[]) => "<h3>" + t + "</h3>" + (a.length ? "<ol>" + a.map((r) => "<li>" + esc(r.code) + " (" + esc(r.platform_ar) + ") — ROAS " + fR(r.roas) + " · صرف " + fN(r.spend) + " · " + ol + " " + fN(r.orders) + "</li>").join("") + "</ol>" : "<p>—</p>");
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>GADLYTICS — ' + esc(m.client.name) + " — " + esc(m.per.label_ar) + "</title>" +
    "<style>body{font:15px/1.5 system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif;margin:16px;color:#111;background:#fff}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #ccc;padding:4px 6px;text-align:right}th{background:#f2f2f2}h1{font-size:20px}h2{font-size:17px;margin-top:22px}h3{font-size:15px}small{color:#555}</style></head><body>" +
    "<h1>GADLYTICS · " + esc(m.client.name) + " · " + esc(m.per.label_ar) + " (" + esc(m.per.from) + (m.per.to !== m.per.from ? " → " + esc(m.per.to) : "") + ")</h1>" +
    "<p><small>المقارنة: " + esc(m.per.compare.label_ar) + " (" + esc(m.per.compare.from) + " → " + esc(m.per.compare.to) + ") · العملة ر.س · توقيت الرياض · اتعمل " + esc(rTime(Date.now())) + " في " + ms + " ms</small></p>" +
    "<p><b>آخر تحديث للداتا:</b> " + esc(frLine(R.fr)) + "</p>" +
    "<p><small>الصرف من المنصات، و" + ol + " والإيراد من " + (m.conv ? "AppsFlyer وسلة" : "خزامى") + " — مش من مشتريات المنصات.</small></p>" +
    "<h2>الأرقام الأساسية</h2><table><tr><th>المؤشر</th><th>القيمة</th><th>الفترة اللي قبلها</th><th>التغيير</th></tr>" +
    R.k.map((k: any) => "<tr><td>" + esc(k.label_ar) + "</td><td><b>" + fK(k) + "</b>" + (k.note_ar ? " <small>" + esc(k.note_ar) + "</small>" : "") + "</td><td>" + (k.prev === undefined ? "—" : fK({ ...k, value: k.prev })) + "</td><td>" + esc(fD(k)) + "</td></tr>").join("") + "</table>" +
    (m.th ? "<p><small>حدود ROAS: إنذار تحت " + m.th.alarm + "x · راقب لحد " + m.th.min + "x · كويس لحد " + m.th.good + "x · زوّد من " + m.th.good + "x</small></p>" : "") +
    "<h2>الحملات (" + m.camps.length + ")</h2><table><tr><th>الحملة</th><th>المنصة</th><th>الحالة</th><th>الصرف</th><th>" + ol + "</th><th>الإيراد</th><th>ROAS</th><th>الحكم</th><th>الميزانية اليومية</th></tr>" +
    (R.rows.length ? R.rows.map(camp).join("") : '<tr><td colspan="9">مفيش حملات صرفت في الفترة دي</td></tr>') + "</table>" + (R.more ? "<p><small>+" + R.more + " حملة كمان — استخدم /campaigns</small></p>" : "") +
    mini("أعلى 3 في الـ ROAS", R.top) + mini("أقل 3 في الـ ROAS", R.bottom) +
    "<h2>آخر التنبيهات (7 أيام)</h2>" + (R.alerts.length ? "<ol>" + R.alerts.map((a: any) => "<li>" + esc(a.at) + " — " + esc(a.title) + (a.body ? ": " + esc(a.body) : "") + "</li>").join("") + "</ol>" : "<p>مفيش تنبيهات</p>") +
    "<h2>آخر التعديلات (7 أيام)</h2>" + (R.changes.length ? "<ol>" + R.changes.map((c: any) => "<li>" + esc(c.at) + " — " + esc(c.text) + "</li>").join("") + "</ol>" : "<p>مفيش تعديلات</p>") +
    "<p><small>الفترات: today · yesterday · 7d · 30d · day:YYYY-MM-DD · range:A..B · نسخة نص: text=1</small></p>" +
    "<p><small>" + esc(EDIT_HELP_AR) + "</small></p></body></html>";
}
function reportText(R: any, ms: number) {
  const m = R.m, ol = m.conv ? "الطلبات" : "التبرعات", L: string[] = [];
  L.push("GADLYTICS · " + m.client.name + " · " + m.per.label_ar + " (" + m.per.from + (m.per.to !== m.per.from ? " → " + m.per.to : "") + ") · مقارنة بـ " + m.per.compare.label_ar + " (" + m.per.compare.from + " → " + m.per.compare.to + ")");
  L.push("آخر تحديث للداتا: " + frLine(R.fr)); L.push("العملة ر.س · توقيت الرياض · " + ms + " ms"); L.push("");
  L.push("الأرقام الأساسية:"); R.k.forEach((k: any) => L.push("- " + k.label_ar + ": " + fK(k) + (k.note_ar ? " (" + k.note_ar + ")" : "") + (k.prev === undefined ? "" : " · قبلها " + fK({ ...k, value: k.prev }) + (fD(k) ? " · " + fD(k) : ""))));
  L.push(""); L.push("الحملات (" + m.camps.length + "): الكود | المنصة | الحالة | الصرف | " + ol + " | الإيراد | ROAS | الحكم | الميزانية");
  R.rows.forEach((r: any) => L.push("- " + [r.code, r.platform_ar, r.state_ar || "—", fN(r.spend), fN(r.orders), fN(r.revenue), fR(r.roas), vd(r), r.budget && r.budget.daily != null ? fN(r.budget.daily) : "—"].join(" | ")));
  if (R.more) L.push("+" + R.more + " حملة كمان");
  L.push(""); L.push("أعلى 3 ROAS: " + (R.top.map((r: any) => r.code + " " + fR(r.roas)).join(" · ") || "—"));
  L.push("أقل 3 ROAS: " + (R.bottom.map((r: any) => r.code + " " + fR(r.roas)).join(" · ") || "—"));
  L.push(""); L.push("آخر التنبيهات:"); (R.alerts.length ? R.alerts : [null]).forEach((a: any) => L.push(a ? "- " + a.at + " — " + a.title + (a.body ? ": " + a.body : "") : "- مفيش"));
  L.push(""); L.push("آخر التعديلات:"); (R.changes.length ? R.changes : [null]).forEach((c: any) => L.push(c ? "- " + c.at + " — " + c.text : "- مفيش"));
  L.push(""); L.push(EDIT_HELP_AR);
  return L.join("\n") + "\n";
}

// ───────────── Khzama live (scope khzama) — POST /khzama/push · POST /khzama/status ─────────────
// Title parsing = ~/.gadlytics/khzama_ingest.py conv() exactly (\p{Nd} = Python's Unicode \d). The extension sends raw rows only.
const KZ_CID = "3sa3k1k", KZ_DOC = "sys/khzama_live";
const KZ_RX = /^-?([A-Z]{2,4}-\p{Nd}{3,6})-(?:([A-Za-z0-9_]+)-)?(\p{Nd}{14}(?:~\p{Nd}{14})*)-([A-Za-z]{2,3})-(.+)$/u;
const KZ_PLAT: Record<string, string> = { ME: "meta", TT: "tiktok", SC: "snap", GG: "google" };
function kzConv(date: string, lid: string, title: string | null, d: number, a: number) {
  const t = (title || "").trim();
  const row: Record<string, any> = { client_id: KZ_CID, date, link_id: lid, title, camp_no: null, custom: null, creative_id: null, code: null,
    platform: null, product: null, rest: null, donations: d, amount: a };
  const m = KZ_RX.exec(t);
  if (m) {
    const [, camp, custom, cr, code, rest] = m;
    Object.assign(row, { camp_no: camp, custom: custom ?? null, creative_id: cr.split("~")[0], code, platform: KZ_PLAT[code] ?? code, rest, product: rest.split("-")[0] });
  } else {
    const mc = /^-?([A-Z]{2,4}-\p{Nd}{3,6})/u.exec(t); if (mc) row.camp_no = mc[1];
    const mk = /-(ME|TT|SC)-/.exec(t);
    if (mk) row.code = mk[1]; else if (t === "bio" || t === "com" || t === "DM") row.code = t;
    if (row.code) row.platform = KZ_PLAT[row.code] ?? row.code;
    const mi = /\p{Nd}{14}/u.exec(t); if (mi) row.creative_id = mi[0];
  }
  return row;
}
const kzTot = (rs: any[]) => ({ links: rs.length, donations: rs.reduce((s, r) => s + (Number(r.donations) || 0), 0), amount: Math.round(rs.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100 });
async function kzDoc() { const { data } = await sb.from("docs").select("data").eq("path", KZ_DOC).maybeSingle(); return (data?.data || {}) as Record<string, any>; }
async function kzSave(d: Record<string, any>) {
  const { error } = await sb.from("docs").upsert({ path: KZ_DOC, coll: "sys", data: d, updated_at: new Date().toISOString() });
  if (error) throw new ApiErr(500, "db", "خطأ في قاعدة البيانات", "Database error: " + error.message);
}
async function kzStored(date: string) {
  const r = await all((c) => sb.from("khzama_link_daily").select("link_id,donations,amount", c ? { count: "exact" } : undefined).eq("client_id", KZ_CID).eq("date", date));
  return r;
}
const kzErr = (code: string, ar: string, en: string, status = 400, extra?: Record<string, unknown>) => new ApiErr(status, code, ar, en, extra);
async function epKzPush(b: any, key: KeyRow) {
  const T = today(), Y = addDays(T, -1), date = String(b?.date || "");
  if (date !== T && date !== Y) throw kzErr("bad_date", "التاريخ لازم يبقى النهارده أو امبارح (الرياض): " + T + " / " + Y, "date must be today or yesterday (Riyadh): " + T + " / " + Y);
  if (!Array.isArray(b?.rows) || b.rows.length > 5000) throw bad("rows لازم تبقى list (≤ 5000)", "rows must be an array (≤ 5000)");
  const complete = b.complete === true, seen = new Set<string>(), rows: any[] = [];
  for (const r of b.rows) {
    const lid = String(r?.link_id ?? ""), d = Number(r?.donations ?? 0), a = Number(r?.amount ?? 0), title = r?.title ?? null;
    if (!/^[0-9A-Za-z:_-]{1,40}$/.test(lid) || (title !== null && (typeof title !== "string" || title.length > 600)) || !Number.isInteger(d) || d < 0 || !isFinite(a) || a < 0)
      throw bad("صف غلط: " + lid, "bad row: " + lid.slice(0, 40));
    if (seen.has(lid)) throw bad("link_id متكرر: " + lid, "duplicate link_id: " + lid); seen.add(lid);
    rows.push(kzConv(date, lid, title, d, a));
  }
  const doc = await kzDoc(), now = Date.now();
  if (doc.last_push_key === key.name && now - Number(doc.last_push_at || 0) < 30e3) throw kzErr("rate_limited", "push واحد كل 30 ثانية", "One push per 30 s", 429);
  const before = await kzStored(date), bt = kzTot(before), nt = kzTot(rows);
  if (bt.donations >= 5 && nt.donations < bt.donations * 0.5)
    throw kzErr("guard", "الأرقام الجديدة (" + nt.donations + " تبرع) أقل من نص المتخزن (" + bt.donations + ") — غالباً الصفحة مكملتش تحميل، مفيش حاجة اتغيرت", "Refused: " + nt.donations + " donations is below 50% of the stored " + bt.donations + " — probably a half-loaded page; nothing changed", 409, { stored: bt, pushed: nt });
  const at = new Date(now).toISOString();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("khzama_link_daily").upsert(rows.slice(i, i + 500).map((r) => ({ ...r, pulled_at: at })), { onConflict: "client_id,date,link_id" });
    if (error) throw new ApiErr(500, "db", "خطأ في قاعدة البيانات", "Database error: " + error.message);
  }
  let deleted = 0;
  if (complete) {
    const gone = before.map((r: any) => String(r.link_id)).filter((id: string) => !seen.has(id));
    for (let i = 0; i < gone.length; i += 200) {
      const { data, error } = await sb.from("khzama_link_daily").delete().eq("client_id", KZ_CID).eq("date", date).in("link_id", gone.slice(i, i + 200)).select("link_id");
      if (error) throw new ApiErr(500, "db", "خطأ في قاعدة البيانات", "Database error: " + error.message); deleted += (data || []).length;
    }
  }
  const st = kzTot(await kzStored(date));
  const days = { ...(doc.days || {}) }; days[date] = { ...st, at: now, complete };
  Object.keys(days).sort().slice(0, -4).forEach((k) => delete days[k]);
  await kzSave({ ...doc, last_ok_at: now, last_state: "ok", last_state_at: now, last_detail: null, last_push_at: now, last_push_key: key.name,
    rows: rows.length, date, totals: days[T] ? { date: T, links: days[T].links, donations: days[T].donations, amount: days[T].amount } : (doc.totals || null), days });
  return { date, complete, upserted: rows.length, deleted, before: bt, stored: st, unchanged: bt.links === st.links && bt.donations === st.donations && bt.amount === st.amount };
}
async function epKzStatus(b: any, key: KeyRow) {
  const state = String(b?.state || ""), detail = String(b?.detail ?? "").slice(0, 300);
  if (["ok", "login_required", "error"].indexOf(state) < 0) throw bad("state: ok | login_required | error", "state must be ok | login_required | error");
  const doc = await kzDoc(), now = Date.now(), notified = { ...(doc.notified || {}) };
  let pushed = false;
  if (state !== "ok" && now - Number(notified[state] || 0) >= 2 * 3600e3) {
    const body = state === "login_required" ? "خزامى محتاج تسجيل دخول — السحب اللحظي واقف" : "السحب اللحظي من خزامى واقف: " + (detail || "خطأ");
    try {
      const r = await fetch(SB_URL + "/functions/v1/push", { method: "POST", headers: { Authorization: "Bearer " + SRK, apikey: SRK, "content-type": "application/json" },
        body: JSON.stringify({ action: "send", to: "all", title: "GADLYTICS · خزامى لحظي", body, url: SITE + "?p=campperf", tag: "khzama-" + state, kind: "khzama", client: KZ_CID, urgency: "high" }) });
      pushed = r.ok; await r.body?.cancel();
    } catch { /* still recorded below */ }
    notified[state] = now;
  }
  await kzSave({ ...doc, last_state: state, last_state_at: now, last_detail: state === "ok" ? null : detail, last_status_key: key.name, notified });
  return { state, notified: pushed, last_ok_at: rTime(doc.last_ok_at) };
}

// ───────────── router ─────────────
Deno.serve(async (req: Request) => {
  const t0 = Date.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url), path = (url.pathname.replace(/^.*?\/gad-api/, "") || "/").replace(/\/+$/, "") || "/";
  const done = (o: unknown, status = 200) => json(o, status, { "x-gad-ms": String(Date.now() - t0) });
  const fail = (e: unknown) => { const x = e instanceof ApiErr ? e : new ApiErr(500, "error", "حصل خطأ في السيرفر", String((e as Error)?.message || e).slice(0, 200));
    return done({ ok: false, code: x.code, error_ar: x.ar, error_en: x.en, ...(x.extra || {}) }, x.status); };
  try {
    if (path === "/openapi.json" && req.method === "GET") return done(openapi());
    if (path === "/" && req.method === "GET") return done({ ok: true, name: "GADLYTICS API", version: VERSION, read_only: "everything except /edit/* (scope edit)", openapi: BASE + "/openapi.json", mcp: BASE + "/mcp",
      auth: "Gateway: Authorization: Bearer <anon key> + apikey: <anon key> (public, from config.js). API key: x-api-key: <key> (or ?key=<read-only key> on GET; refresh / edit keys: header only).",
      report: RHTML + "#key=<KEY>&client=3sa3k1k&period=today", report_ar: "لينك التقرير لـ instinct: r.html بيحط المفتاح في الهيدر (المفتاح في الـ # ومبيوصلش لأي سيرفر). الفترات: today · yesterday · 7d · 30d · day:YYYY-MM-DD · range:A..B · نص: &text=1",
      edit: RHTML + "#key=<EDIT KEY>&client=3sa3k1k&edit=1&code=MGG-03059&field=budget&to=500", edit_ar: "لينك تعديل: edit=1&code=<كود الحملة>&field=budget|bid|status&to=<رقم بالريال أو on/off> (+ &adset=<id أو اسم> لو ABO، + &platform=meta|snap|tiktok لو الكود متكرر). اللينك بيعرض معاينة بس — مفيش حاجة بتتغير غير لما تدوس «تأكيد التعديل».",
      endpoints: ["GET /report", "GET /clients", "GET /summary", "GET /campaigns", "GET /campaign?code=", "GET /alerts", "GET /changes", "POST /refresh", "GET /edit/preview", "POST /edit/apply", "POST /mcp", "POST /khzama/push (scope khzama)", "POST /khzama/status (scope khzama)"] });
    if (path === "/mcp") {
      if (req.method === "GET" || req.method === "DELETE") return new Response(null, { status: 405, headers: { ...cors, Allow: "POST" } });
      if (req.method !== "POST") return done({ ok: false, code: "method" }, 405);
      let body: any; try { body = await req.json(); } catch { return done({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
      let key: KeyRow;
      try { key = await auth(req); } catch (e) { const x = e as ApiErr; return done({ jsonrpc: "2.0", id: Array.isArray(body) ? null : body?.id ?? null, error: { code: -32001, message: x.en + " | " + x.ar } }, x.status || 401); }
      if (Array.isArray(body)) { const rs = (await Promise.all(body.map((b) => mcpOne(b, key)))).filter(Boolean); return rs.length ? done(rs) : new Response(null, { status: 202, headers: cors }); }
      const r = await mcpOne(body, key); return r ? done(r) : new Response(null, { status: 202, headers: cors });
    }
    if (path === "/report") {
      if (req.method !== "GET") throw new ApiErr(405, "method", "استخدم GET", "Use GET");
      const key = await auth(req, true); void key;
      const q: Record<string, any> = Object.fromEntries(url.searchParams.entries()); delete q.key;
      const r = await report(q), text = String(q.format || "").toLowerCase() === "text";
      return new Response(text ? reportText(r, Date.now() - t0) : reportHtml(r, Date.now() - t0), { status: 200, headers: { ...cors, "content-type": (text ? "text/plain" : "text/html") + "; charset=utf-8",
        "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer", "x-gad-ms": String(Date.now() - t0) } });
    }
    if (path === "/khzama/push" || path === "/khzama/status") {
      if (req.method !== "POST") throw new ApiErr(405, "method", "استخدم POST", "Use POST");
      const key = await auth(req, false, "khzama");                    // x-api-key header only, scope khzama
      let b: any = null; try { b = await req.json(); } catch { /* bad_request below */ }
      if (!b || typeof b !== "object" || Array.isArray(b)) throw bad("ابعت JSON object", "Send a JSON object");
      return done({ ok: true, ...(path === "/khzama/push" ? await epKzPush(b, key) : await epKzStatus(b, key)), generated_at: rTime(Date.now()), ms: Date.now() - t0 });
    }
    if (path === "/edit/preview" || path === "/edit/apply") {
      const isApply = path === "/edit/apply";
      if (req.method !== (isApply ? "POST" : "GET")) throw new ApiErr(405, "method", "استخدم " + (isApply ? "POST" : "GET"), "Use " + (isApply ? "POST" : "GET"));
      const key = await auth(req, false); needEdit(key);                 // x-api-key header only — never ?key=
      if (isApply) { let b: any = {}; try { b = await req.json(); } catch { /* bad_request below */ } return done({ ...(await epEditApply(b, key)), generated_at: rTime(Date.now()) }); }
      const q: Record<string, any> = Object.fromEntries(url.searchParams.entries()); delete q.key;
      return done({ ok: true, ...(await epEditPreview(q, key)), generated_at: rTime(Date.now()), ms: Date.now() - t0 });
    }
    const EP: Record<string, [string, string]> = { "/clients": ["GET", "clients"], "/summary": ["GET", "summary"], "/campaigns": ["GET", "campaigns"], "/campaign": ["GET", "campaign"], "/alerts": ["GET", "alerts"], "/changes": ["GET", "changes"], "/refresh": ["POST", "refresh"] };
    const ep = EP[path]; if (!ep) throw new ApiErr(404, "not_found", "مفيش endpoint بالاسم ده — شوف /openapi.json", "No such endpoint — see /openapi.json");
    if (req.method !== ep[0] && !(ep[1] !== "refresh" && req.method === "POST")) throw new ApiErr(405, "method", "استخدم " + ep[0], "Use " + ep[0]);
    const key = await auth(req, req.method === "GET" && ep[1] !== "refresh");
    const q: Record<string, any> = Object.fromEntries(url.searchParams.entries()); delete q.key;
    if (req.method === "POST") { try { const b = await req.json(); if (b && typeof b === "object" && !Array.isArray(b)) Object.assign(q, b); } catch { /* empty body is fine */ } }
    const r = await runEp(ep[1], q, key);
    return done({ ok: true, ...r, generated_at: rTime(Date.now()), ms: Date.now() - t0 });
  } catch (e) { return fail(e); }
});
