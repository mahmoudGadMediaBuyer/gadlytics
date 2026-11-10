// GADLYTICS «أداء الحملات» — fast «تحديث الأرقام»: pulls spend (ad level, per day) + campaign / ad set / ad status and
// budgets straight from the ad platforms in seconds, instead of waiting for the scheduled Claude task.
// READ-ONLY on the ad accounts. Writes public.ad_daily (same shape as ~/.gadlytics/platform_rows.py → prep_ad_daily.py)
// and public.camp_struct (same mapping as ~/.gadlytics/camp_struct_prep.py). Khzama / AppsFlyer / Salla are NOT here.
// Tokens: Deno.env first, then private table public.app_secrets (META_TOKEN, SNAP_*; TIKTOK_TOKEN → not_configured until set).
// Auth: a signed-in user of the project, or (scripts / scheduled tasks) header x-ingest-key whose SHA-256 matches INGEST_SHA,
// or (camp-alerts) Authorization: Bearer <service-role key>.
// Input {client, from?, to?, dry?, platforms?}. Default from..to = yesterday..today (Asia/Riyadh). Nothing ever logs a token.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "content-type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const INGEST_SHA = "84f033a41a28bb085aab26a037f2f74411eeb86e52bb4b16535e69e6892b6218";
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

// accounts per client (camp_struct accounts are added on top); names as the daily pull writes them
const ACCOUNTS: Record<string, { meta: string[]; snap: string[] }> = {
  "3sa3k1k": { meta: ["312559678073897", "1355849785679367"], snap: ["828aa8bb-bd63-44ee-8cf8-b735981ca06f", "961fd033-2f79-4acc-88ba-0b546464d2b2"] },
  "dm1n4an": { meta: ["7804393009576374"], snap: ["6a32423a-eeb3-46e3-92f6-e9db866afc4d"] },
};
const ACC_NAME: Record<string, string> = {
  "312559678073897": "Molabi [2]", "1355849785679367": "Molabi [1]", "7804393009576374": "Dimaan [1]",
  "828aa8bb-bd63-44ee-8cf8-b735981ca06f": "Molabi [1]", "961fd033-2f79-4acc-88ba-0b546464d2b2": "Mulabbi [1]", "6a32423a-eeb3-46e3-92f6-e9db866afc4d": "Dimaan Snap",
};
const USD_SNAP = new Set(["961fd033-2f79-4acc-88ba-0b546464d2b2"]);

class Fail extends Error { constructor(public ar: string, public detail = "") { super(ar); } }
async function secret(sb: any, name: string): Promise<string> {
  const e = env(name); if (e) return e;
  if (!sb.__sec) { const { data } = await sb.from("app_secrets").select("name,value"); sb.__sec = Object.fromEntries((data || []).map((r: any) => [r.name, r.value || ""])); }
  return sb.__sec[name] || "";
}
const short = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").slice(0, 200);
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const riyadhDay = (offsetDays = 0) => new Date(Date.now() + 3 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
// "+03:00"-style offset and local calendar day of an IANA timezone (account timezones; Molabi/Deiman are Asia/Riyadh)
function tzOffset(tz: string, at = new Date()) {
  try { const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(at).find((x) => x.type === "timeZoneName")?.value || "GMT+03:00";
    const m = p.match(/GMT([+-]\d{2}):?(\d{2})?/); return m ? m[1] + ":" + (m[2] || "00") : "+00:00"; } catch { return "+03:00"; }
}
function tzToday(tz: string) { try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); } catch { return riyadhDay(0); } }
const addDay = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);

// ── name parsing — identical to prep_ad_daily.py ──
function tag(s: string | null | undefined, k: string) {
  const m = (s || "").match(new RegExp("(?:^|\\|)\\s*" + k + "\\s*:\\s*([^|]+)"));
  return m ? m[1].trim().replace(/\s*-\s*Copy(\s*\d+)?\s*$/i, "") : null;
}
const CAMP_NO = /^\s*-?([A-Z]{2,4}-\d{4,6})/;
const NUMF = ["impressions", "reach", "clicks", "link_clicks", "landing_page_views", "video_plays", "video_2s", "video_6s", "thruplays", "video_p25", "video_p50",
  "video_p75", "video_p100", "view_content", "add_to_cart", "initiate_checkout", "add_payment_info", "purchases", "app_installs", "registrations"];
function finalRow(client: string, r: any, now: string) {
  let fx = Number(r.fx || 1); if ((r.currency || "SAR").toUpperCase() === "USD" && fx === 1) fx = 3.75;
  const cn = r.campaign_name || "", an = r.ad_name || "", vn = r.video_name || "";
  const m14 = vn.match(/(?<!\d)(20\d{12})(?!\d)/) || an.match(/(?<!\d)(20\d{12})(?!\d)/);
  let cr = tag(an, "ID") || (m14 ? m14[1] : null); if (cr && cr.includes("~")) cr = cr.split("~")[0];
  const cm = cn.match(CAMP_NO);
  const o: any = { client_id: client, date: r.date, platform: r.platform, level: "ad", account_id: String(r.account_id), account_name: r.account_name,
    currency: r.currency || "SAR", fx, campaign_id: r.campaign_id ? String(r.campaign_id) : null, campaign_name: cn || null,
    adset_id: r.adset_id ? String(r.adset_id) : null, adset_name: r.adset_name ?? null, ad_id: String(r.ad_id || ""), ad_name: an || null,
    video_id: "", video_name: vn || null, creative_id: cr, product: tag(an, "PR") || tag(cn, "PR"), variation: tag(an, "VR") || tag(cn, "VR"),
    season: tag(cn, "SE"), objective: tag(cn, "OB"), content_type: tag(an, "CT"), influencer: tag(an, "IN"), ad_size: tag(an, "AS"),
    camp_no: cm ? cm[1] : null, pulled_at: now };
  for (const k of ["spend", "revenue"]) { const v = r[k]; o[k] = v === null || v === undefined ? null : Math.round(Number(v) * fx * 100) / 100; }
  for (const k of NUMF) { const v = r[k]; o[k] = v === null || v === undefined ? null : Math.round(Number(v)); }
  return o;
}

// ── camp_struct mapping — identical to camp_struct_prep.py ──
const CAMP = /^\s*-?(?:Copy \d+ of )?([A-Z]{2,4}-\d{3,6})/;
const code = (n: string | null) => { const m = (n || "").match(CAMP); return m ? m[1] : null; };
const META_BID: Record<string, string | null> = { "highest volume": null, "lowest_cost_without_cap": null, "cost per result goal": "Cost cap", "cost_cap": "Cost cap",
  "bid cap": "Bid cap", "lowest_cost_with_bid_cap": "Bid cap", "roas goal": "ROAS goal", "lowest_cost_with_min_roas": "ROAS goal" };
function srow(client: string, pl: string, lvl: string, id: string, parent: string | null, acc: string, name: string | null, status: string,
  mode: string | null, daily: number | null, life: number | null, bt: string | null, bid: number | null, now: string) {
  return { client_id: client, platform: pl, level: lvl, id: String(id), parent_id: parent ? String(parent) : null, account_id: String(acc), name,
    camp_no: code(name), status, budget_mode: mode, daily_budget: daily, lifetime_budget: life, bid_type: bt, bid, updated_at: now };
}
function pausedParents(rows: any[]) {
  const off = new Set(rows.filter((r) => r.level === "campaign" && r.status !== "active").map((r) => r.platform + "|" + r.id));
  for (const r of rows) if (r.level === "adset" && off.has(r.platform + "|" + r.parent_id)) r.status = "paused";
  const offs = new Set(rows.filter((r) => r.level === "adset" && r.status !== "active").map((r) => r.platform + "|" + r.id));
  for (const r of rows) if (r.level === "ad" && offs.has(r.platform + "|" + r.parent_id)) r.status = "paused";
}

// ───────────── Meta (Graph API, read-only) ─────────────
const GRAPH = "https://graph.facebook.com/v21.0/";
async function graphAll(url: string, tok: string, cap = 40) {
  const out: any[] = []; let next: string | null = url + (url.includes("?") ? "&" : "?") + "access_token=" + encodeURIComponent(tok);
  for (let i = 0; next && i < cap; i++) {
    const r = await fetch(next); const t = await r.json().catch(() => ({}));
    if (!r.ok || t.error) {
      const e = t.error || {};
      if (e.code === 190) throw new Fail("توكن ميتا انتهى أو اتلغى — لازم توكن جديد", short(e.message));
      throw new Fail("ميتا رفضت القراية", short(e.message || ("HTTP " + r.status)));
    }
    out.push(...(t.data || [])); next = t.paging?.next || null;
  }
  return out;
}
// absent action = 0, the same value the Meta MCP pull wrote
const act = (list: any[], type: string) => { let s = 0; if (Array.isArray(list)) for (const a of list) if (a.action_type === type) s += Number(a.value || 0); return s; };
const sumv = (list: any[]) => (Array.isArray(list) ? list.reduce((s, a) => s + Number(a.value || 0), 0) : 0);
const META_STATUS = ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "WITH_ISSUES", "IN_PROCESS"];
const minor = (v: unknown) => { const n = num(v); return n ? n / 100 : null; };

async function metaAccount(tok: string, client: string, acc: string, from: string, to: string, now: string) {
  // (to may move to the account's own today below)
  const IF = ["campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name", "spend", "impressions", "reach", "clicks", "actions", "action_values",
    "video_play_actions", "video_continuous_2_sec_watched_actions", "video_thruplay_watched_actions", "video_p25_watched_actions", "video_p50_watched_actions",
    "video_p75_watched_actions", "video_p100_watched_actions", "account_currency"].join(",");
  // the account's own calendar: if the page asks up to today (Riyadh) and the account lives in another timezone, use the account's today
  const tzr = await fetch(GRAPH + "act_" + acc + "?fields=timezone_name&access_token=" + encodeURIComponent(tok)).then((r) => r.json()).catch(() => ({}));
  if (tzr?.error?.code === 190) throw new Fail("توكن ميتا انتهى أو اتلغى — لازم توكن جديد", short(tzr.error.message));
  const tz = tzr?.timezone_name || "Asia/Riyadh";
  if (to === riyadhDay(0)) { const t = tzToday(tz); if (t > to) to = t; }
  const q = new URLSearchParams({ level: "ad", time_increment: "1", time_range: JSON.stringify({ since: from, until: to }), fields: IF, limit: "500" });
  const ins = await graphAll(GRAPH + "act_" + acc + "/insights?" + q, tok);
  const raw = ins.map((r: any) => ({ date: r.date_start, platform: "meta", account_id: acc, account_name: ACC_NAME[acc] || null, currency: r.account_currency || "SAR", fx: 1,
    campaign_id: r.campaign_id, campaign_name: r.campaign_name, adset_id: r.adset_id, adset_name: r.adset_name, ad_id: r.ad_id, ad_name: r.ad_name,
    spend: num(r.spend), impressions: num(r.impressions), reach: num(r.reach), clicks: num(r.clicks), link_clicks: act(r.actions, "link_click"),
    landing_page_views: act(r.actions, "omni_landing_page_view"), video_plays: sumv(r.video_play_actions), video_2s: sumv(r.video_continuous_2_sec_watched_actions),
    video_6s: null, thruplays: sumv(r.video_thruplay_watched_actions), video_p25: sumv(r.video_p25_watched_actions), video_p50: sumv(r.video_p50_watched_actions),
    video_p75: sumv(r.video_p75_watched_actions), video_p100: sumv(r.video_p100_watched_actions), view_content: act(r.actions, "omni_view_content"),
    add_to_cart: act(r.actions, "omni_add_to_cart"), initiate_checkout: act(r.actions, "omni_initiated_checkout"), add_payment_info: null,
    purchases: act(r.actions, "omni_purchase"), revenue: act(r.action_values, "omni_purchase"), app_installs: act(r.actions, "omni_app_install"),
    registrations: act(r.actions, "omni_complete_registration") }))
    .filter((r: any) => (r.spend || 0) > 0 || (r.impressions || 0) > 0);
  const rows = raw.map((r: any) => finalRow(client, r, now));

  // structure: every non-deleted campaign + ad set; ads of the campaigns that spent in the window
  const st = encodeURIComponent(JSON.stringify(META_STATUS));
  const [camps, sets] = await Promise.all([
    graphAll(GRAPH + "act_" + acc + "/campaigns?fields=id,name,effective_status,daily_budget,lifetime_budget,bid_strategy&limit=500&effective_status=" + st, tok),
    graphAll(GRAPH + "act_" + acc + "/adsets?fields=id,name,campaign_id,effective_status,daily_budget,lifetime_budget,bid_strategy,bid_amount&limit=500&effective_status=" + st, tok),
  ]);
  const spentCamps = [...new Set(raw.map((r: any) => String(r.campaign_id)))];
  let ads: any[] = [];
  if (spentCamps.length) {
    const filt = encodeURIComponent(JSON.stringify([{ field: "campaign.id", operator: "IN", value: spentCamps }]));
    ads = await graphAll(GRAPH + "act_" + acc + "/ads?fields=id,name,adset_id,campaign_id,effective_status&limit=500&effective_status=" + st + "&filtering=" + filt, tok);
  }
  const struct: any[] = []; const campBid: Record<string, string | null> = {};
  for (const e of camps) {
    const es = String(e.effective_status || "").toUpperCase(); if (es === "DELETED" || es === "ARCHIVED") continue;
    const daily = minor(e.daily_budget), life = minor(e.lifetime_budget), bt = META_BID[String(e.bid_strategy || "").toLowerCase()] ?? null;
    campBid[e.id] = bt;
    struct.push(srow(client, "meta", "campaign", e.id, null, acc, e.name, es === "ACTIVE" ? "active" : "paused", daily || life ? "CBO" : "ABO", daily, life, bt, null, now));
  }
  for (const e of sets) {
    const es = String(e.effective_status || "").toUpperCase(); if (es === "DELETED" || es === "ARCHIVED") continue;
    const bt = (META_BID[String(e.bid_strategy || "").toLowerCase()] ?? null) || campBid[e.campaign_id] || null;
    struct.push(srow(client, "meta", "adset", e.id, e.campaign_id, acc, e.name, es === "ACTIVE" ? "active" : "paused", null, minor(e.daily_budget), minor(e.lifetime_budget), bt, bt ? minor(e.bid_amount) : null, now));
  }
  for (const e of ads) {
    const es = String(e.effective_status || "").toUpperCase(); if (es === "DELETED" || es === "ARCHIVED") continue;
    struct.push(srow(client, "meta", "ad", e.id, e.adset_id, acc, e.name, es === "ACTIVE" ? "active" : "paused", null, null, null, null, null, now));
  }
  return { rows, struct };
}

// ───────────── Snap (read-only) ─────────────
const SNAP_TOKEN_URL = "https://accounts.snapchat.com/login/oauth2/access_token";
const SNAP_API = "https://adsapi.snapchat.com/v1";
async function snapToken(sb: any): Promise<string | null> {
  const id = await secret(sb, "SNAP_CLIENT_ID"), sec = await secret(sb, "SNAP_CLIENT_SECRET");
  const rtStored = sb.__sec?.SNAP_REFRESH_TOKEN || "", rtEnv = env("SNAP_REFRESH_TOKEN");
  const cands = [...new Set([rtStored, rtEnv].filter(Boolean))];
  if (!id || !sec || !cands.length) return null;
  const { data } = await sb.from("sys_kv").select("v").eq("k", "snap_access").maybeSingle();
  if (data?.v) { try { const a = JSON.parse(data.v); if (a.exp > Date.now()) return a.tok; } catch { /* refresh */ } }
  let r: Response | null = null, used = "";
  for (const rt of cands) {
    r = await fetch(SNAP_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: id, client_secret: sec, refresh_token: rt }) });
    used = rt; if (r.ok) break;
  }
  if (!r || !r.ok) throw new Fail("سناب رفض الدخول — لازم نجدد ربط سناب", "token HTTP " + (r?.status ?? "-"));
  const t = await r.json(); const now = new Date().toISOString();
  await sb.from("sys_kv").upsert([{ k: "snap_access", v: JSON.stringify({ tok: t.access_token, exp: Date.now() + (Number(t.expires_in || 1800) - 120) * 1000 }), updated_at: now }], { onConflict: "k" });
  if (t.refresh_token && (t.refresh_token !== rtStored || used !== rtStored))
    await sb.from("app_secrets").upsert({ name: "SNAP_REFRESH_TOKEN", value: t.refresh_token, updated_at: now }, { onConflict: "name" });
  return t.access_token;
}
async function snapGet(tok: string, path: string) {
  const r = await fetch(SNAP_API + path, { headers: { Authorization: "Bearer " + tok } });
  const t = await r.json().catch(() => ({}));
  if (!r.ok) throw new Fail("سناب رفض القراية", short(t?.debug_message || t?.display_message || ("HTTP " + r.status)));
  return t;
}
async function snapPages(tok: string, path: string, key: string) {
  const out: any[] = []; let url: string | null = path + (path.includes("?") ? "&" : "?") + "limit=1000";
  for (let i = 0; url && i < 20; i++) {
    const t = await snapGet(tok, url);
    out.push(...(t[key] || []).map((x: any) => x[key.slice(0, -1)]));
    const nl = t.paging?.next_link; url = nl ? nl.replace(SNAP_API, "") : null;
  }
  return out;
}
const sv = (v: any) => (v && typeof v === "object" && "value" in v ? v.value : v);
async function snapAccount(tok: string, client: string, acc: string, from: string, to: string, now: string) {
  // (to may move to the account's own today below)
  const fx = USD_SNAP.has(acc) ? 3.75 : 1;
  const info = await snapGet(tok, `/adaccounts/${acc}`).catch(() => ({}));
  const tz = info?.adaccounts?.[0]?.adaccount?.timezone || "Asia/Riyadh";
  if (to === riyadhDay(0)) { const t = tzToday(tz); if (t > to) to = t; }
  const off0 = tzOffset(tz, new Date(from + "T12:00:00Z")), off1 = tzOffset(tz, new Date(addDay(to, 1) + "T12:00:00Z"));
  const [camps, squads, ads] = await Promise.all([
    snapPages(tok, `/adaccounts/${acc}/campaigns`, "campaigns"), snapPages(tok, `/adaccounts/${acc}/adsquads`, "adsquads"), snapPages(tok, `/adaccounts/${acc}/ads`, "ads")]);
  const F = "spend,impressions,swipes,video_views,quartile_1,quartile_2,quartile_3,view_completion,conversion_page_views,conversion_view_content,conversion_add_cart," +
    "conversion_start_checkout,conversion_add_billing,conversion_purchases,conversion_purchases_value,conversion_sign_ups,total_installs";
  const q = new URLSearchParams({ breakdown: "ad", granularity: "DAY", fields: F, omit_empty: "true",
    start_time: from + "T00:00:00" + off0, end_time: addDay(to, 1) + "T00:00:00" + off1 });
  const stats = await snapGet(tok, `/adaccounts/${acc}/stats?` + q);
  const cn: Record<string, any> = {}, sq: Record<string, any> = {}, ad: Record<string, any> = {};
  camps.forEach((c) => (cn[c.id] = c)); squads.forEach((s) => (sq[s.id] = s)); ads.forEach((a) => (ad[a.id] = a));
  const raw: any[] = [];
  for (const ts of stats.timeseries_stats || []) {
    for (const b of ts.timeseries_stat?.breakdown_stats?.ad || []) {
      const a = ad[b.id] || {}, s = sq[a.ad_squad_id] || {}, c = cn[s.campaign_id] || {};
      for (const t of b.timeseries || []) {
        const x = t.stats || {}; if (!x.spend && !x.impressions) continue;
        raw.push({ date: String(sv(t.start_time)).slice(0, 10), platform: "snap", account_id: acc, account_name: ACC_NAME[acc] || null,
          currency: fx === 1 ? "SAR" : "USD", fx, campaign_id: s.campaign_id || null, campaign_name: sv(c.name) || null, adset_id: a.ad_squad_id || null,
          adset_name: sv(s.name) || null, ad_id: b.id, ad_name: sv(a.name) || null, spend: (x.spend || 0) / 1e6, impressions: x.impressions ?? null, reach: null,
          clicks: x.swipes ?? null, link_clicks: x.swipes ?? null, landing_page_views: x.conversion_page_views ?? null, video_plays: x.video_views ?? null,
          video_2s: null, video_6s: null, thruplays: null, video_p25: x.quartile_1 ?? null, video_p50: x.quartile_2 ?? null, video_p75: x.quartile_3 ?? null,
          video_p100: x.view_completion ?? null, view_content: x.conversion_view_content ?? null, add_to_cart: x.conversion_add_cart ?? null,
          initiate_checkout: x.conversion_start_checkout ?? null, add_payment_info: x.conversion_add_billing ?? null, purchases: x.conversion_purchases ?? null,
          revenue: x.conversion_purchases_value != null ? x.conversion_purchases_value / 1e6 : null, app_installs: x.total_installs ?? null,
          registrations: x.conversion_sign_ups ?? null });
      }
    }
  }
  const rows = raw.map((r) => finalRow(client, r, now));
  // structure (camp_struct_prep.py snap branch): USD account ×3.75
  const struct: any[] = []; const spentCamps = new Set(raw.map((r) => String(r.campaign_id)));
  for (const e of camps) {
    const st = String(sv(e.status)).toUpperCase(); if (st === "DELETED" || st === "ARCHIVED") continue;
    const daily = ((e.daily_budget_micro || 0) / 1e6) * fx || null; const cbo = String(sv(e.pacing_level)).toUpperCase() === "CAMPAIGN" && daily;
    struct.push(srow(client, "snap", "campaign", e.id, null, acc, sv(e.name), st === "ACTIVE" ? "active" : "paused", cbo ? "CBO" : "ABO", cbo ? daily : null, null, null, null, now));
  }
  for (const e of squads) {
    const st = String(sv(e.status)).toUpperCase(); if (st === "DELETED" || st === "ARCHIVED") continue;
    const daily = ((e.daily_budget_micro || 0) / 1e6) * fx || null; const bs = String(sv(e.bid_strategy) || "").toUpperCase();
    const bt = bs === "TARGET_COST" ? "Target cost" : bs === "LOWEST_COST_WITH_MAX_BID" ? "Max bid" : null;
    const bid = bt ? ((e.bid_micro || 0) / 1e6) * fx || null : null;
    struct.push(srow(client, "snap", "adset", e.id, e.campaign_id, acc, sv(e.name), st === "ACTIVE" ? "active" : "paused", null, daily, null, bt, bid, now));
  }
  for (const e of ads) {
    const st = String(sv(e.status)).toUpperCase(); if (st === "DELETED" || st === "ARCHIVED") continue;
    const s = sq[e.ad_squad_id] || {}; if (!spentCamps.has(String(s.campaign_id))) continue;
    struct.push(srow(client, "snap", "ad", e.id, e.ad_squad_id, acc, sv(e.name), st === "ACTIVE" ? "active" : "paused", null, null, null, null, null, now));
  }
  return { rows, struct };
}

// ───────────── write ─────────────
async function writeAdDaily(sb: any, client: string, pl: string, acc: string, from: string, to: string, rows: any[]) {
  // "to" is widened to the latest row date (an account in another timezone may already be on the next day)
  // keep name-derived fields a later backfill filled in (e.g. influencer from the creative library) when the ad name doesn't carry them
  const KEEP = ["influencer", "content_type", "product", "variation", "season", "ad_size", "creative_id"];
  const ids = [...new Set(rows.map((r) => r.ad_id))];
  const prev: Record<string, any> = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from("ad_daily").select("ad_id,date," + KEEP.join(",")).eq("client_id", client).eq("platform", pl).eq("account_id", acc).in("ad_id", ids.slice(i, i + 200)).order("date", { ascending: false }).limit(5000);
    for (const o of data || []) if (!prev[o.ad_id]) prev[o.ad_id] = o; else for (const k of KEEP) if (prev[o.ad_id][k] == null && o[k] != null) prev[o.ad_id][k] = o[k];
  }
  for (const r of rows) { const o = prev[r.ad_id]; if (o) for (const k of KEEP) if (r[k] == null && o[k] != null) r[k] = o[k]; }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("ad_daily").upsert(rows.slice(i, i + 500), { onConflict: "client_id,date,platform,level,account_id,ad_id,video_id" });
    if (error) throw new Fail("مقدرتش أحفظ الصرف", short(error.message));
  }
  // rows the platform no longer reports for these days (e.g. a re-attributed ad) → remove, so the page shows exactly the platform
  const keep = new Set(rows.map((r) => r.date + "|" + r.ad_id));
  for (const r of rows) if (r.date > to) to = r.date;
  const { data: old } = await sb.from("ad_daily").select("date,ad_id").eq("client_id", client).eq("platform", pl).eq("account_id", acc).eq("level", "ad").gte("date", from).lte("date", to);
  const gone = (old || []).filter((o: any) => !keep.has(o.date + "|" + o.ad_id));
  for (const g of gone) await sb.from("ad_daily").delete().eq("client_id", client).eq("platform", pl).eq("account_id", acc).eq("level", "ad").eq("date", g.date).eq("ad_id", g.ad_id);
  return gone.length;
}
async function writeStruct(sb: any, client: string, pl: string, acc: string, struct: any[], now: string) {
  for (let i = 0; i < struct.length; i += 500) {
    const { error } = await sb.from("camp_struct").upsert(struct.slice(i, i + 500), { onConflict: "client_id,platform,level,id" });
    if (error) throw new Fail("مقدرتش أحفظ حالة الحملات", short(error.message));
  }
  // campaigns / ad sets that disappeared (deleted / archived) → stale; ads are only refreshed for spending campaigns, so never staled here
  for (const lvl of ["campaign", "adset"]) {
    const ids = new Set(struct.filter((r) => r.level === lvl).map((r) => r.id));
    const { data: old } = await sb.from("camp_struct").select("id").eq("client_id", client).eq("platform", pl).eq("account_id", acc).eq("level", lvl).neq("status", "stale");
    const gone = (old || []).map((o: any) => o.id).filter((id: string) => !ids.has(id));
    for (let i = 0; i < gone.length; i += 100)
      await sb.from("camp_struct").update({ status: "stale", updated_at: now }).eq("client_id", client).eq("platform", pl).eq("account_id", acc).eq("level", lvl).in("id", gone.slice(i, i + 100));
  }
}

// «سرعة الصرف»: per campaign cumulative spend for TODAY (Riyadh) at this moment → public.camp_hourly, one row per
// 15-minute bucket (a later refresh in the same bucket overwrites it). The page compares with yesterday at the same time.
async function writeHourly(sb: any, client: string, pl: string, rows: any[]) {
  const day = riyadhDay(0), nowMs = Date.now();
  const bucket = new Date(Math.floor(nowMs / 900e3) * 900e3).toISOString();
  const hour = new Date(nowMs + 3 * 3600e3).getUTCHours();
  const agg: Record<string, any> = {};
  for (const r of rows) {
    if (r.date !== day || !r.campaign_id) continue;
    const k = String(r.campaign_id);
    const a = agg[k] || (agg[k] = { client_id: client, platform: pl, campaign_id: k, camp_no: r.camp_no || null, date: day, ts: bucket, hour, spend: 0, impressions: 0, clicks: 0, link_clicks: 0 });
    a.spend += r.spend || 0; a.impressions += r.impressions || 0; a.clicks += r.clicks || 0; a.link_clicks += r.link_clicks || 0;
  }
  const list = Object.values(agg).map((a: any) => ({ ...a, spend: Math.round(a.spend * 100) / 100 }));
  if (!list.length) return;
  const { error } = await sb.from("camp_hourly").upsert(list, { onConflict: "client_id,platform,campaign_id,ts" });
  if (error) console.log("camp_hourly", error.message);
}

// ───────────── handler ─────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const t0 = Date.now();
  const ik = req.headers.get("x-ingest-key") || "";
  let admin = false;
  if (ik) admin = (await sha256(ik)) === INGEST_SHA;
  // server-to-server (camp-alerts every 15 min): the project's own service-role key, which never leaves Supabase
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!admin && bearer && bearer === env("SUPABASE_SERVICE_ROLE_KEY")) admin = true;
  if (!admin) {
    const ua = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("authorization") || "" } } });
    const { data: ud } = await ua.auth.getUser().catch(() => ({ data: { user: null } } as any));
    if (!ud?.user) return json({ ok: false, code: "unauthorized", error: "لازم تسجّل دخول" }, 401);
  }
  let b: any; try { b = await req.json(); } catch { b = {}; }
  const client = String(b?.client || "");
  if (!ACCOUNTS[client]) return json({ ok: false, code: "bad", error: "عميل مش معروف" }, 400);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const to = iso.test(b?.to) ? b.to : riyadhDay(0), from = iso.test(b?.from) ? b.from : addDay(to, -1);
  if (from > to || Date.parse(to) - Date.parse(from) > 31 * 86400e3) return json({ ok: false, code: "bad", error: "الفترة لازم تبقى 31 يوم أو أقل" }, 400);
  const dry = !!b?.dry, want = new Set<string>(Array.isArray(b?.platforms) ? b.platforms : ["meta", "snap", "tiktok"]);
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const now = new Date().toISOString();

  const { data: cs } = await sb.from("camp_struct").select("platform,account_id").eq("client_id", client);
  const accs = { meta: new Set(ACCOUNTS[client].meta), snap: new Set(ACCOUNTS[client].snap) };
  for (const r of cs || []) if (r.platform === "meta" || r.platform === "snap") (accs as any)[r.platform].add(String(r.account_id));

  const out: any = { ok: true, client, from, to, dry, platforms: {}, struct_rows: 0 };
  const run = async (pl: "meta" | "snap", tok: string | null, fn: any) => {
    const t1 = Date.now(); const res: any = { rows: 0, spend: 0, accounts: {} as any };
    if (!tok) { out.platforms[pl] = "not_configured"; return; }
    await Promise.all([...accs[pl]].map(async (acc) => {
      try {
        const { rows, struct } = await fn(tok, client, acc, from, to, now);
        pausedParents(struct);
        const sp = Math.round(rows.reduce((s: number, r: any) => s + (r.spend || 0), 0) * 100) / 100;
        const byDay: Record<string, number> = {}; rows.forEach((r: any) => (byDay[r.date] = Math.round(((byDay[r.date] || 0) + (r.spend || 0)) * 100) / 100));
        let removed = 0;
        if (!dry) { removed = await writeAdDaily(sb, client, pl, acc, from, to, rows); await writeStruct(sb, client, pl, acc, struct, now); await writeHourly(sb, client, pl, rows); }
        res.accounts[acc] = { rows: rows.length, spend: sp, byDay, struct: struct.length, removed };
        res.rows += rows.length; res.spend = Math.round((res.spend + sp) * 100) / 100; out.struct_rows += struct.length;
      } catch (e) {
        const f = e instanceof Fail ? e : new Fail("حصل خطأ", short((e as Error)?.message || e));
        res.accounts[acc] = { error: f.ar, detail: f.detail || undefined }; res.error = f.ar;
      }
    }));
    res.ms = Date.now() - t1; out.platforms[pl] = res;
  };
  const jobs: Promise<void>[] = [];
  if (want.has("meta")) jobs.push(secret(sb, "META_TOKEN").then((t) => run("meta", t || null, metaAccount)));
  if (want.has("snap")) jobs.push((async () => { let t: string | null = null; try { await secret(sb, "__load__"); t = await snapToken(sb); } catch (e) { out.platforms.snap = { error: (e as Fail).ar || "سناب" }; return; } await run("snap", t, snapAccount); })());
  if (want.has("tiktok")) jobs.push(secret(sb, "TIKTOK_TOKEN").then((t) => { out.platforms.tiktok = t ? "not_built" : "not_configured"; }));
  await Promise.all(jobs);
  out.ok = !Object.values(out.platforms).some((p: any) => p && typeof p === "object" && p.error);
  out.ms = Date.now() - t0;
  out.at = new Date().toISOString();
  return json(out);
});
