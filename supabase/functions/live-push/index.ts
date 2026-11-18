// GADLYTICS · live-push — receives what the Chrome extension «khzama-live» READ FROM THE PAGE (no platform API, no tokens):
//   • TikTok Ads Manager (ad level = one row per ad group for Smart+) for ديمان and ملبي  → ad_daily (public.live_tiktok_merge)
//   • ديمان backend dashboard.dimaan.sa/admin/marketing/statistics (today + 3 days back)   → conv_daily channel 'backend'
// then rebuilds the entries of the client (rebuild_entries_dm1n4an / rebuild_entries_3sa3k1k) so the site and the
// phone / iPad app show the new numbers on the next read. It also tells the extension when the site asked for a refresh
// («تحديث الأرقام» → sys/campreq, «حدّث كل حاجة» → sys/pullreq) and closes that request.
// Auth = the extension's own key (api_keys, scope khzama; x-api-key header only). verify_jwt ON (anon key in Authorization).
// Nothing on any ad account is changed. Heartbeat + per-source state: docs sys/live_sync.
import { createClient } from "jsr:@supabase/supabase-js@2";

const VERSION = "1.0.0";
const env = (k: string) => Deno.env.get(k) || "";
const SB_URL = env("SUPABASE_URL"), SRK = env("SUPABASE_SERVICE_ROLE_KEY");
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });
const SITE = "https://mahmoudgadmediabuyer.github.io/gadlytics/";
const DOC = "sys/live_sync";
const TT: Record<string, { client: string; name: string; currency: string }> = {
  "7267941711098494977": { client: "dm1n4an", name: "ديمان", currency: "SAR" },
  "7338783723795595266": { client: "3sa3k1k", name: "ملبي", currency: "SAR" },
};
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8" } });
class E extends Error { constructor(public status: number, public code: string, public ar: string) { super(ar); } }

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : NaN; };

// ───────── auth: same api_keys table + hashing as gad-api; only a key with scope khzama (the extension's key) ─────────
const KEYS = new Map<string, { row: { id: number; name: string; scopes: string[] } | null; at: number }>();
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const RL = new Map<string, number>();
async function auth(req: Request) {
  const raw = (req.headers.get("x-api-key") || "").trim();
  if (!raw) throw new E(401, "unauthorized", "ابعت مفتاح الإضافة في x-api-key");
  const h = await sha256(raw); let c = KEYS.get(h);
  if (!c || Date.now() - c.at > 30e3) {
    const { data } = await sb.from("api_keys").select("id,name,scopes").eq("key_hash", h).is("revoked_at", null).maybeSingle();
    c = { row: data ? { id: data.id, name: data.name, scopes: data.scopes || [] } : null, at: Date.now() }; KEYS.set(h, c);
  }
  if (!c.row) throw new E(401, "unauthorized", "المفتاح غلط أو اتلغى");
  if (c.row.scopes.indexOf("khzama") < 0) throw new E(403, "scope", "المفتاح ده مش مفتاح الإضافة (scope khzama)");
  return c.row;
}
function limit(k: string, ms: number) { const t = RL.get(k) || 0; if (Date.now() - t < ms) throw new E(429, "rate_limited", "استنى شوية — بدري على تحديث تاني"); RL.set(k, Date.now()); }

async function getDoc(path: string) { const { data } = await sb.from("docs").select("data").eq("path", path).maybeSingle(); return (data?.data || null) as Record<string, any> | null; }
async function setDoc(path: string, d: Record<string, unknown>) {
  const { error } = await sb.from("docs").upsert({ path, coll: "sys", data: d, updated_at: new Date().toISOString() });
  if (error) throw new E(500, "db", "خطأ في قاعدة البيانات: " + error.message);
}
async function mark(source: string, patch: Record<string, unknown>) {
  const d = (await getDoc(DOC)) || {}; const sources = { ...(d.sources || {}) };
  sources[source] = { ...(sources[source] || {}), ...patch };
  await setDoc(DOC, { ...d, sources, last_at: Date.now(), version: VERSION });
}
async function rebuild(client: string, from: string) {
  const fn = client === "dm1n4an" ? "rebuild_entries_dm1n4an" : "rebuild_entries_3sa3k1k";
  const { error } = await sb.rpc(fn, { p_from: from });
  if (error) throw new E(500, "db", "إعادة بناء الأرقام فشلت: " + error.message);
}

// ───────── /req — has the site asked for a refresh? ─────────
async function epReq() {
  const [c, p, d] = await Promise.all([getDoc("sys/campreq"), getDoc("sys/pullreq"), getDoc(DOC)]);
  const pick = (x: any) => x ? { at: Number(x.at) || 0, status: x.status || null, client: x.client || null } : null;
  return { today: today(), campreq: pick(c), pullreq: pick(p), sources: d?.sources || {} };
}

// ───────── /tiktok — one account, one day, rows = one per ad group (from the «Ad» tab of Ads Manager) ─────────
async function epTiktok(b: any) {
  const acc = String(b?.account_id || ""), cfg = TT[acc], T = today(), date = String(b?.date || "");
  if (!cfg) throw new E(400, "bad_account", "حساب تيك توك مش معروف: " + acc.slice(0, 30));
  if (date !== T && date !== addDays(T, -1)) throw new E(400, "bad_date", "التاريخ لازم يبقى النهارده أو امبارح (الرياض)");
  if (b?.currency && b.currency !== cfg.currency) throw new E(400, "currency", "العملة " + b.currency + " مش " + cfg.currency);
  const rows = Array.isArray(b?.rows) ? b.rows : null;
  if (!rows || rows.length > 500) throw new E(400, "bad_rows", "rows لازم تبقى list (≤ 500)");
  const out: any[] = [], seen = new Set<string>();
  for (const r of rows) {
    const ag = String(r?.adgroup_id || ""), sp = num(r?.spend), im = num(r?.impressions ?? 0), cl = num(r?.clicks ?? 0);
    if (!/^\d{6,25}$/.test(ag) || !(sp >= 0) || !(im >= 0) || !(cl >= 0)) throw new E(400, "bad_row", "صف غلط: " + ag.slice(0, 30));
    if (seen.has(ag)) throw new E(400, "dup", "ad group متكرر: " + ag); seen.add(ag);
    const s = (v: unknown, n = 600) => (v == null ? null : String(v).slice(0, n));
    out.push({ adgroup_id: ag, campaign_id: s(r.campaign_id, 30), campaign_name: s(r.campaign_name), adgroup_name: s(r.adgroup_name), ad_name: s(r.ad_name), spend: Math.round(sp * 100) / 100, impressions: Math.round(im), clicks: Math.round(cl) });
  }
  const total = num(b?.total?.spend), sum = Math.round(out.reduce((a, r) => a + r.spend, 0) * 100) / 100;
  if (!(total >= 0) || Math.abs(total - sum) > 0.05 + total * 0.001) throw new E(409, "mismatch", `مجموع الصفوف (${sum}) مش زي إجمالي الصفحة (${total}) — الصفحة غالباً مكملتش تحميل`);
  limit("tt|" + acc + "|" + date, 50e3);
  // guard: a half-loaded page must never shrink a day (stored by MCP or an earlier read)
  const { data: st } = await sb.from("ad_daily").select("spend").eq("client_id", cfg.client).eq("date", date).eq("platform", "tiktok").eq("level", "ad").eq("account_id", acc);
  const stored = Math.round((st || []).reduce((a: number, r: any) => a + (Number(r.spend) || 0), 0) * 100) / 100;
  if (stored >= 20 && sum < stored * 0.7) throw new E(409, "guard", `الصرف الجديد (${sum}) أقل بكتير من المتخزن (${stored}) — مفيش حاجة اتغيرت`);
  const { data, error } = await sb.rpc("live_tiktok_merge", { p_client: cfg.client, p_account: acc, p_date: date, p_currency: cfg.currency, p_rows: out });
  if (error) throw new E(500, "db", "خطأ في الدمج: " + error.message);
  await rebuild(cfg.client, date);
  await mark("tiktok_" + cfg.client, { ok_at: Date.now(), state: "ok", detail: null, [date === T ? "today" : "yesterday"]: { date, spend: sum, rows: out.length, at: Date.now() } });
  return { client: cfg.client, date, page_spend: total, ...(data as Record<string, unknown>) };
}

// ───────── /backend — ديمان dashboard: [{date, orders, revenue, new_customers, new_customer_revenue}] (≤ 4 days) ─────────
async function epBackend(b: any) {
  const T = today(), days = Array.isArray(b?.days) ? b.days : null;
  if (!days || !days.length || days.length > 4) throw new E(400, "bad_days", "days لازم تبقى 1–4 أيام");
  const rows: any[] = [];
  for (const d of days) {
    const date = String(d?.date || ""), o = num(d?.orders), r = num(d?.revenue), nc = num(d?.new_customers), nr = num(d?.new_customer_revenue);
    if (!ISO.test(date) || date > T || date < addDays(T, -4)) throw new E(400, "bad_date", "تاريخ برّه آخر 4 أيام: " + date.slice(0, 12));
    if (![o, r, nc, nr].every((x) => x >= 0) || !Number.isInteger(o) || !Number.isInteger(nc) || o > 1e5 || r > 1e8) throw new E(400, "bad_row", "أرقام غلط ليوم " + date);
    rows.push({ client_id: "dm1n4an", date, channel: "backend", os: "all", source_raw: "dimaan_backend", source: "total", platform: "total", campaign: "",
      purchases: o, revenue: Math.round(r * 100) / 100, new_customers: nc, new_customer_revenue: Math.round(nr * 100) / 100, pulled_at: new Date().toISOString() });
  }
  limit("backend", 50e3);
  // guard: a day's orders never drop below half of what is stored (unless stored < 4)
  const { data: st } = await sb.from("conv_daily").select("date,purchases").eq("client_id", "dm1n4an").eq("channel", "backend").in("date", rows.map((r) => r.date));
  for (const s of st || []) { const n = rows.find((r) => r.date === s.date); if (n && Number(s.purchases) >= 4 && n.purchases < Number(s.purchases) * 0.5) throw new E(409, "guard", `طلبات ${s.date} (${n.purchases}) أقل من نص المتخزن (${s.purchases}) — مفيش حاجة اتغيرت`); }
  const { error } = await sb.from("conv_daily").upsert(rows, { onConflict: "client_id,date,channel,os,source_raw,campaign" });
  if (error) throw new E(500, "db", "خطأ في قاعدة البيانات: " + error.message);
  const from = rows.map((r) => r.date).sort()[0];
  await rebuild("dm1n4an", from);
  const t = rows.find((r) => r.date === T);
  await mark("backend_dm1n4an", { ok_at: Date.now(), state: "ok", detail: null, today: t ? { date: T, orders: t.purchases, revenue: t.revenue, new_customers: t.new_customers } : null });
  return { days: rows.map((r) => ({ date: r.date, orders: r.purchases, revenue: r.revenue, new_customers: r.new_customers, new_customer_revenue: r.new_customer_revenue })) };
}

// ───────── /status — {source, state: ok|login_required|error, detail} → one notification per source+state per 2 h ─────────
const SRC_AR: Record<string, string> = { tiktok_dm1n4an: "تيك توك ديمان", tiktok_3sa3k1k: "تيك توك ملبي", backend_dm1n4an: "الباك إند بتاع ديمان" };
async function epStatus(b: any) {
  const source = String(b?.source || ""), state = String(b?.state || ""), detail = String(b?.detail ?? "").slice(0, 300);
  if (!SRC_AR[source]) throw new E(400, "bad_source", "source مش معروف");
  if (["ok", "login_required", "error"].indexOf(state) < 0) throw new E(400, "bad_state", "state: ok | login_required | error");
  const d = (await getDoc(DOC)) || {}, prev = (d.sources || {})[source] || {}, notified = { ...(prev.notified || {}) }, now = Date.now();
  let pushed = false;
  if (state !== "ok" && now - Number(notified[state] || 0) >= 2 * 3600e3) {
    const body = state === "login_required" ? SRC_AR[source] + " محتاج تسجيل دخول في كروم — التحديث التلقائي واقف" : "التحديث التلقائي من " + SRC_AR[source] + " واقف: " + (detail || "خطأ");
    try {
      const r = await fetch(SB_URL + "/functions/v1/push", { method: "POST", headers: { Authorization: "Bearer " + SRK, apikey: SRK, "content-type": "application/json" },
        body: JSON.stringify({ action: "send", to: "all", title: "GADLYTICS · تحديث تلقائي", body, url: SITE + "?p=campperf", tag: "live-" + source + "-" + state, kind: "live", urgency: "high" }) });
      pushed = r.ok; await r.body?.cancel();
    } catch { /* recorded below anyway */ }
    notified[state] = now;
  }
  await mark(source, { state, state_at: now, detail: state === "ok" ? null : detail, notified });
  return { source, state, notified: pushed };
}

// ───────── /done — the extension finished a run started by a site request → close sys/campreq (same «at» only) ─────────
async function epDone(b: any) {
  const at = Number(b?.req_at) || 0, out: Record<string, unknown> = {};
  const c = await getDoc("sys/campreq");
  if (c && Number(c.at) === at && c.status === "pending") {
    await setDoc("sys/campreq", { ...c, status: "done", done_at: Date.now(), done_by: "live-sync", live: b?.summary || null });
    out.campreq = "done";
  }
  await mark("run", { at: Date.now(), summary: b?.summary || null, interval_min: Number(b?.interval_min) || null, enabled: b?.enabled !== false });
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method !== "POST") throw new E(405, "method", "POST بس");
    const path = (new URL(req.url).pathname.replace(/^.*?\/live-push/, "") || "/").replace(/\/+$/, "") || "/";
    await auth(req);
    const len = Number(req.headers.get("content-length") || 0); if (len > 512e3) throw new E(413, "too_big", "الطلب كبير");
    let b: any = {}; try { b = await req.json(); } catch { b = {}; }
    const r = path === "/req" ? await epReq() : path === "/tiktok" ? await epTiktok(b) : path === "/backend" ? await epBackend(b)
      : path === "/status" ? await epStatus(b) : path === "/done" ? await epDone(b) : (() => { throw new E(404, "not_found", "مفيش endpoint بالاسم ده"); })();
    return json({ ok: true, version: VERSION, ...r });
  } catch (e) {
    const x = e instanceof E ? e : new E(500, "error", String((e as Error)?.message || e).slice(0, 200));
    return json({ ok: false, code: x.code, error_ar: x.ar }, x.status);
  }
});
