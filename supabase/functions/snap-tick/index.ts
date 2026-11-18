// GADLYTICS · snap-tick — «السناب شوت» من السيرفر (Nov 18 2026). Replaces the Claude task gadlytics-snapshots (off since Oct 25).
// pg_cron gad-snap-tick calls it every minute (anon key, verify_jwt ON). It is harmless when nothing is due: one small read.
// Schedule: docs config/snapsched {every (min; 0 = on demand), start "HH:MM" (Riyadh), nextAt, requested, last} — set from the site
// («كل ربع ساعة / نص ساعة / ساعة»، «خدها دلوقتي»، «ابدأ سناب شوت»).
// Due = requested, or every > 0 && Riyadh time >= start && now >= nextAt − 30 s.
// For each client in config/app: refresh Meta + Snap spend (camp-refresh, skipped when season-tick did it < 3 min ago), then read today:
//   spend per platform  ← ad_daily (TikTok comes from the Chrome extension every ~5 min; ASA from the daily pull)
//   ملبي orders/revenue ← khzama_link_daily per platform (extension «خزامى لحظي», every ~2 min)
//   ديمان orders/revenue ← conv_daily channel backend (extension, every ~5 min)
// and writes one snapshot (public.snapshots, one row per source) at the minute, then pushes ONE notification per client with the totals,
// the change since the previous snapshot, and a warning when a source the numbers depend on is stale.
// Heartbeat: docs sys/snaptick. READ-ONLY on every ad platform (camp-refresh only reads).
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "content-type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const SB_URL = env("SUPABASE_URL"), SRK = env("SUPABASE_SERVICE_ROLE_KEY");
const SITE = "https://mahmoudgadmediabuyer.github.io/gadlytics/";
const MIN = 60e3;
const riy = (ms = Date.now()) => new Date(ms + 3 * 3600e3);
const riyDay = (ms = Date.now()) => riy(ms).toISOString().slice(0, 10);
const hm = (s: unknown) => { const x = /^(\d{1,2}):(\d{2})$/.exec(String(s || "")); return x ? +x[1] * 60 + +x[2] : null; };
const n = (v: unknown) => Number(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const sgn = (v: number) => (v >= 0 ? "+" : "−") + fmt(Math.abs(v));
const PL_AR: Record<string, string> = { meta: "ميتا", tiktok: "تيك توك", snap: "سناب", asa: "Apple", google: "جوجل" };
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });

async function getDoc(path: string) { const { data } = await sb.from("docs").select("data").eq("path", path).maybeSingle(); return (data as any)?.data ?? null; }
async function setDoc(path: string, data: unknown) { await sb.from("docs").upsert({ path, coll: path.split("/")[0], data, updated_at: new Date().toISOString() }); }
async function callFn(name: string, body: unknown, ms: number) {
  const r = await fetch(SB_URL + "/functions/v1/" + name, { method: "POST", signal: AbortSignal.timeout(ms),
    headers: { Authorization: "Bearer " + SRK, apikey: SRK, "content-type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.json().catch(() => ({ ok: false, error: "HTTP " + r.status }));
  return { status: r.status, body: t };
}
async function all(q: (a: number, b: number) => any) {
  const out: any[] = [];
  for (let i = 0; ; i += 1000) { const { data, error } = await q(i, i + 999); if (error || !data) break; out.push(...data); if (data.length < 1000) break; }
  return out;
}
const ago = (ms: number) => { const m = Math.round((Date.now() - ms) / MIN); return m < 60 ? m + " د" : Math.round(m / 60) + " س"; };

async function snapClient(c: any, day: string, T: string, live: any, kz: any, seasonFresh: boolean) {
  const cid = c.id, conv = !!c.convSource && !/khzama/i.test(String(c.convSource));
  const res: any = { client: cid, name: c.name || cid };
  if (!seasonFresh) {
    try { const { body } = await callFn("camp-refresh", { client: cid, from: day, to: day }, 70e3); res.refresh = body?.ok ? "ok" : (body?.error || "partial"); }
    catch (e) { res.refresh = String((e as Error)?.message || e).slice(0, 120); }
  } else res.refresh = "season";

  // spend per platform, today
  const ad = await all((a, b) => sb.from("ad_daily").select("platform,spend").eq("client_id", cid).eq("date", day).eq("level", "ad").range(a, b));
  const spend: Record<string, number> = {};
  for (const r of ad) spend[r.platform] = r2((spend[r.platform] || 0) + n(r.spend));

  // orders + revenue
  const rev: Record<string, { r: number; d: number }> = {};
  if (conv) {
    const cv = await all((a, b) => sb.from("conv_daily").select("purchases,revenue").eq("client_id", cid).eq("date", day).eq("channel", "backend").range(a, b));
    rev.store = { r: r2(cv.reduce((s, x) => s + n(x.revenue), 0)), d: cv.reduce((s, x) => s + n(x.purchases), 0) };
  } else {
    const kd = await all((a, b) => sb.from("khzama_link_daily").select("platform,donations,amount").eq("client_id", cid).eq("date", day).range(a, b));
    for (const r of kd) { if (!r.platform) continue; const k = String(r.platform); rev[k] = rev[k] || { r: 0, d: 0 }; rev[k].r = r2(rev[k].r + n(r.amount)); rev[k].d += n(r.donations); }
  }

  const S = Object.values(spend).reduce((a, b) => a + b, 0), R = Object.values(rev).reduce((a, x) => a + x.r, 0), D = Object.values(rev).reduce((a, x) => a + x.d, 0);
  Object.assign(res, { spend, rev, total: { spend: r2(S), revenue: r2(R), orders: D } });
  if (!S && !R && !D) { res.skipped = "no spend and no orders today"; return res; }

  // previous snapshot today (for the change)
  const prev = await all((a, b) => sb.from("snapshots").select("taken_at,spend,revenue,donations").eq("client_id", cid).eq("date", day).lt("taken_at", T).order("taken_at", { ascending: false }).range(a, b));
  const lastAt = prev[0]?.taken_at, pr = prev.filter((x) => x.taken_at === lastAt);
  const P = lastAt ? { s: pr.reduce((a, x) => a + n(x.spend), 0), r: pr.reduce((a, x) => a + n(x.revenue), 0), d: pr.reduce((a, x) => a + n(x.donations), 0) } : null;

  // write: one row per source
  const src = new Set([...Object.keys(spend), ...Object.keys(rev)]);
  const rows = [...src].map((s) => ({ client_id: cid, date: day, taken_at: T, source: s, spend: s in spend ? spend[s] : null, revenue: rev[s] ? rev[s].r : null, donations: rev[s] ? rev[s].d : null }));
  const { error } = await sb.from("snapshots").upsert(rows, { onConflict: "client_id,taken_at,source" });
  if (error) { res.error = error.message; return res; }
  res.rows = rows.length;

  // freshness of what the numbers depend on
  const warn: string[] = [], now = Date.now(), lv = live?.sources || {};
  const tt = lv["tiktok_" + cid]; if (spend.tiktok != null && tt?.today?.date === day && now - n(tt.today.at) > 15 * MIN) warn.push("تيك توك من " + ago(n(tt.today.at)));
  if (conv) { const bk = lv["backend_" + cid]; if (bk?.ok_at && now - n(bk.ok_at) > 15 * MIN) warn.push("الباك إند من " + ago(n(bk.ok_at))); }
  else if (kz?.last_ok_at && now - n(kz.last_ok_at) > 10 * MIN) warn.push("خزامى من " + ago(n(kz.last_ok_at)));
  if (typeof res.refresh === "string" && res.refresh !== "ok" && res.refresh !== "season") warn.push("ميتا/سناب ما اتحدّثوش");

  // push
  const time = new Intl.DateTimeFormat("ar-EG", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit" }).format(new Date(T));
  const ord = conv ? "طلبات" : "تبرعات", roas = S > 0 ? (R / S).toFixed(2) + "x" : "—";
  const l1 = "صرف " + fmt(S) + (P ? " (" + sgn(S - P.s) + ")" : "") + " · " + ord + " " + D + (P ? " (" + sgn(D - P.d) + ")" : "") + " · إيراد " + fmt(R) + (P ? " (" + sgn(R - P.r) + ")" : "") + " · ROAS " + roas;
  const pl = Object.entries(spend).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => (PL_AR[k] || k) + " " + fmt(v)).join(" · ");
  const body = l1 + (pl ? "\n" + pl : "") + (warn.length ? "\n⚠️ " + warn.join(" · ") : "");
  try {
    const { status, body: pb } = await callFn("push", { action: "send", to: "all", title: "📸 لقطة " + time + " — " + res.name, body, url: SITE + "?p=campperf",
      tag: "snap-" + cid, kind: "snapshot", client: cid, urgency: "normal" }, 30e3);
    res.push = pb?.ok === false ? (pb?.error || "HTTP " + status) : "sent";
  } catch (e) { res.push = String((e as Error)?.message || e).slice(0, 120); }
  res.body = body;
  return res;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const t0 = Date.now();
  let b: any = {}; try { b = await req.json(); } catch { /* cron sends {} */ }
  const cfg: any = (await getDoc("config/snapsched")) || {};
  const every = n(cfg.every), start = hm(cfg.start) ?? 9 * 60, r = riy(t0), minOfDay = r.getUTCHours() * 60 + r.getUTCMinutes();
  const requested = cfg.requested ? Date.parse(cfg.requested) : 0;
  const nextAt = cfg.nextAt ? Date.parse(cfg.nextAt) : 0;
  const reqDue = requested > 0 && requested <= t0 + 60e3;                                   // a press from the site (never one from the future)
  const timerDue = every > 0 && minOfDay >= start && (!nextAt || t0 >= nextAt - 30e3);
  if (!reqDue && !timerDue && !b?.force) return json({ ok: true, due: false, every, nextAt: cfg.nextAt || null, ms: Date.now() - t0 });

  const hb: any = (await getDoc("sys/snaptick")) || {};
  if (hb.running && t0 - n(hb.started_at) < 4 * MIN) return json({ ok: true, skipped: "running" });
  await setDoc("sys/snaptick", { ...hb, running: true, started_at: t0 });

  const T = new Date(Math.floor(t0 / MIN) * MIN).toISOString(), day = riyDay(t0);
  // the schedule moves first, so a slow run is never taken twice
  const nx = every > 0 ? new Date(Math.floor(t0 / MIN) * MIN + every * MIN).toISOString() : null;
  await setDoc("config/snapsched", { ...cfg, requested: null, nextAt: nx, last: T });

  const out: any[] = [];
  try {
    const [app, live, kz, season] = await Promise.all([getDoc("config/app"), getDoc("sys/live_sync"), getDoc("sys/khzama_live"), getDoc("sys/season")]);
    const seasonFresh = !!season?.active && season?.last_tick_at && t0 - Date.parse(season.last_tick_at) < 3 * MIN;
    const clients: any[] = ((app?.clients) || []).filter((c: any) => c && c.id && (!b?.client || c.id === b.client));
    for (const c of clients) {
      try { out.push(await snapClient(c, day, T, live, kz, seasonFresh)); }
      catch (e) { out.push({ client: c.id, error: String((e as Error)?.message || e).slice(0, 200) }); }
    }
  } finally {
    await setDoc("sys/snaptick", { running: false, started_at: t0, last_at: Date.now(), taken_at: T, reason: reqDue ? "request" : timerDue ? "timer" : "force", ms: Date.now() - t0,
      clients: Object.fromEntries(out.map((x) => [x.client, { total: x.total, push: x.push, skipped: x.skipped, error: x.error, refresh: x.refresh }])) });
  }
  return json({ ok: true, taken_at: T, next: nx, ms: Date.now() - t0, clients: out });
});
