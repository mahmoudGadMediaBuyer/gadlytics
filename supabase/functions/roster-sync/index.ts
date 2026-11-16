// GADLYTICS «إدارة الحملات أوتوماتيك» — pg_cron job gad-roster-sync calls this every 30 minutes, 24 h a day (anon key header, like
// gad-camp-alerts / gad-season-tick; verify_jwt ON). The gateway check is the only gate, so every call must be harmless: it throttles itself.
//
// What it does, per client in docs config/app .clients (one after the other):
//  1) Refresh first: POST camp-refresh {client, from: today, to: today} with the service role — skipped while season mode is running
//     (sys/season.active and a tick < 10 min old), because season-tick already refreshes every 2 minutes.
//  2) Read campaign rows of camp_struct (all platforms) and today's ad_daily rows with spend > 0. A campaign is ON when its status is
//     active/enabled/delivering. The roster entry is its code: camp_no, else the PM_CAMP regex [A-Z]{2,4}-\d{3,6} on the name.
//  3) Maintain one auto doc per client + Riyadh day: docs roster_auto/<client>__<date> =
//       {clientId, date, byPlatform:{pid:{CODE:{first_on, last_seen_on, off_at|null, source, carried, …}}}, platforms:{pid:{fresh, struct_at}}, …}
//     Rules (Mahmoud's): ON → on the platform's row for the day and carried to the next day while it stays ON; turned OFF during a day →
//     still shown that day (off_at set) but NOT carried; turned ON / created during the day → added to that day (carried:false = «جديدة»).
//     At the first run after Riyadh midnight the new day is built from the previous day's codes that are still ON; the previous day's open
//     codes that are no longer ON are closed on the previous day (off_est:true).
//  4) A platform whose camp_struct rows were not refreshed in the last 25 min (TikTok: only the Claude daily pull) is «stale»: no status
//     is read from it. It only gets entries from ad_daily spend > 0 (source «spend», filled in late, when the daily pull lands) and a
//     one-day provisional carry (source «carry», provisional) from yesterday's spend entry; a provisional entry without spend is dropped
//     once its day is over.
//  5) Heartbeat docs sys/roster_sync.
// Manual roster docs (docs roster/*) are NEVER touched. STRICTLY READ-ONLY towards the ad platforms: the only platform traffic is
// the reads camp-refresh already does. No writes, no budget changes.
// Body (all optional): {backfill_days: 1..14} → also build the previous days from ad_daily spend (source «spend», backfill:true; no camp_refresh,
// not throttled); {dry:true} → compute and return, write nothing.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "content-type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const SB_URL = env("SUPABASE_URL"), SRK = env("SUPABASE_SERVICE_ROLE_KEY");
const PM_CAMP = /\b([A-Z]{2,4}-\d{3,6})\b/;
const ON = new Set(["active", "enabled", "enable", "delivering", "live", "running", "on"]);
const FRESH_MS = 25 * 60e3;
const riy = (ms = Date.now()) => new Date(ms + 3 * 3600e3);
const riyDay = (ms = Date.now()) => riy(ms).toISOString().slice(0, 10);
const addDay = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
const dayStartIso = (d: string) => new Date(Date.parse(d + "T00:00:00Z") - 3 * 3600e3).toISOString();
const dayEndIso = (d: string) => new Date(Date.parse(addDay(d, 1) + "T00:00:00Z") - 3 * 3600e3 - 1000).toISOString();
const short = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").slice(0, 200);
const codeOf = (no: unknown, name: unknown) => String(no || "").trim() || (String(name || "").match(PM_CAMP) || [])[1] || "";
const docPath = (cid: string, d: string) => "roster_auto/" + cid + "__" + d;

async function callFn(name: string, body: unknown, ms: number) {
  const r = await fetch(SB_URL + "/functions/v1/" + name, { method: "POST", signal: AbortSignal.timeout(ms),
    headers: { Authorization: "Bearer " + SRK, apikey: SRK, "content-type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.json().catch(() => ({ ok: false, error: "HTTP " + r.status }));
  return { status: r.status, body: t };
}
async function fetchAll(q: (from: number, to: number) => any) {
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await q(f, f + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function syncClient(sb: any, cid: string, today: string, nowIso: string, backfillDays: number, dry: boolean) {
  const nowMs = Date.parse(nowIso), yday = addDay(today, -1);
  const from = addDay(today, -Math.max(1, backfillDays));
  // ── sources ──
  const struct = await fetchAll((a, b) => sb.from("camp_struct").select("platform,id,name,camp_no,status,updated_at").eq("client_id", cid).eq("level", "campaign").order("platform").order("id").range(a, b));
  const spendRows = await fetchAll((a, b) => sb.from("ad_daily").select("platform,date,camp_no,campaign_name").eq("client_id", cid).gte("date", from).lte("date", today).gt("spend", 0).neq("level", "material")
    .order("date").order("platform").order("level").order("account_id").order("ad_id").order("video_id").range(a, b));
  const onNow: Record<string, Set<string>> = {}, info: Record<string, { fresh: boolean; struct_at: string | null }> = {};
  const lastUpd: Record<string, number> = {};
  for (const r of struct) {
    const pid = r.platform; (onNow[pid] ||= new Set());
    lastUpd[pid] = Math.max(lastUpd[pid] || 0, Date.parse(r.updated_at) || 0);
    const code = codeOf(r.camp_no, r.name);
    if (code && ON.has(String(r.status || "").toLowerCase())) onNow[pid].add(code);
  }
  const spent: Record<string, Record<string, Set<string>>> = {};   // date → pid → codes
  for (const r of spendRows) {
    const code = codeOf(r.camp_no, r.campaign_name); if (!code) continue;
    ((spent[r.date] ||= {})[r.platform] ||= new Set()).add(code);
  }
  const pids = new Set<string>([...Object.keys(onNow), ...Object.values(spent).flatMap((m) => Object.keys(m))]);
  for (const pid of pids) {
    const u = lastUpd[pid] || 0;
    info[pid] = { fresh: !!u && nowMs - u < FRESH_MS, struct_at: u ? new Date(u).toISOString() : null };
  }
  const platformHasRows = (d: string, pid: string) => !!spent[d]?.[pid]?.size;

  // ── existing docs ──
  const wantDates: string[] = [];
  for (let d = from; d <= today; d = addDay(d, 1)) wantDates.push(d);
  const { data: ex, error: exErr } = await sb.from("docs").select("path,data").in("path", wantDates.map((d) => docPath(cid, d)));
  if (exErr) throw new Error(exErr.message);
  const docs: Record<string, any> = {}, before: Record<string, string> = {};
  for (const r of ex || []) { const d = r.path.split("__").pop()!; docs[d] = r.data; before[d] = JSON.stringify(r.data); }

  const open = (doc: any, pid: string, code: string) => { const e = doc?.byPlatform?.[pid]?.[code]; return !!e && e.off_at == null; };

  // ── finished days (backfill / late fill / drop unbacked provisional entries) — ascending ──
  const pastDates = wantDates.filter((d) => d < today && (d >= from) && (backfillDays > 1 || d === yday));
  for (const D of pastDates) {
    let doc = docs[D];
    if (!doc) doc = docs[D] = { clientId: cid, date: D, byPlatform: {}, backfill: true, created_at: nowIso };
    const prevDoc = docs[addDay(D, -1)];
    for (const pid of Object.keys(spent[D] || {})) {
      const ents = (doc.byPlatform[pid] ||= {});
      for (const code of spent[D][pid]) {
        const e = ents[code];
        if (!e) ents[code] = { first_on: prevDoc?.byPlatform?.[pid]?.[code]?.first_on || dayStartIso(D), last_seen_on: dayStartIso(D), off_at: null, source: "spend", late: true, carried: !!prevDoc?.byPlatform?.[pid]?.[code] };
        else if (e.provisional) { e.provisional = false; e.source = "spend"; }
      }
    }
    for (const pid of Object.keys(doc.byPlatform)) {
      for (const [code, e] of Object.entries(doc.byPlatform[pid] as Record<string, any>)) {
        if (e.provisional && !spent[D]?.[pid]?.has(code)) delete doc.byPlatform[pid][code];
      }
    }
  }

  // ── today ──
  let doc = docs[today];
  const created = !doc;
  if (!doc) doc = docs[today] = { clientId: cid, date: today, byPlatform: {}, created_at: nowIso };
  const prev = docs[yday];
  const prevLive = !!prev && !prev.backfill;
  const prevEntry = (pid: string, code: string) => prev?.byPlatform?.[pid]?.[code];
  const counts: Record<string, any> = {};
  for (const pid of pids) {
    const ents = (doc.byPlatform[pid] ||= {});
    const sp = spent[today]?.[pid] || new Set<string>();
    if (info[pid].fresh) {
      const on = onNow[pid] || new Set<string>();
      for (const code of on) {
        const e = ents[code], pe = prevEntry(pid, code), carried = !!pe && pe.off_at == null;
        if (!e) ents[code] = { first_on: carried && pe.first_on ? pe.first_on : nowIso, last_seen_on: nowIso, off_at: null, source: "status", carried };
        else { e.last_seen_on = nowIso; if (e.off_at) { e.off_at = null; delete e.off_est; e.reopened_at = nowIso; } if (e.provisional) { e.provisional = false; e.source = "status"; } }
      }
      for (const code of sp) {
        if (on.has(code) || ents[code]) continue;
        const pe = prevEntry(pid, code), carried = !!pe && pe.off_at == null;
        ents[code] = { first_on: carried && pe.first_on ? pe.first_on : nowIso, last_seen_on: nowIso, off_at: nowIso, off_est: true, source: "spend", carried };
      }
      for (const [code, e] of Object.entries(ents) as [string, any][]) if (e.off_at == null && !on.has(code)) e.off_at = nowIso;
      // yesterday's open codes that stopped before this run → closed on yesterday, never carried
      if (prevLive) for (const [code, pe] of Object.entries(prev.byPlatform?.[pid] || {}) as [string, any][]) {
        if (pe.off_at == null && !pe.late && !on.has(code) && !sp.has(code)) { pe.off_at = nowIso < dayEndIso(yday) ? nowIso : dayEndIso(yday); pe.off_est = true; }
      }
    } else {
      for (const code of sp) {
        const e = ents[code], pe = prevEntry(pid, code);
        if (!e) ents[code] = { first_on: pe?.first_on || nowIso, last_seen_on: nowIso, off_at: null, source: "spend", carried: !!pe && pe.off_at == null };
        else if (e.provisional) { e.provisional = false; e.source = "spend"; }
      }
      for (const [code, pe] of Object.entries(prev?.byPlatform?.[pid] || {}) as [string, any][]) {
        if (pe.off_at == null && pe.source === "spend" && !pe.provisional && !ents[code])
          ents[code] = { first_on: pe.first_on, last_seen_on: nowIso, off_at: null, source: "carry", provisional: true, carried: true };
      }
    }
    const list = Object.values(ents) as any[];
    counts[pid] = { fresh: info[pid].fresh, total: list.length, on: list.filter((e) => e.off_at == null).length, closed: list.filter((e) => e.off_at != null).length,
      carried: list.filter((e) => e.carried).length, new: list.filter((e) => !e.carried).length };
  }
  for (const pid of Object.keys(doc.byPlatform)) if (!pids.has(pid)) delete doc.byPlatform[pid];
  doc.platforms = info; doc.synced_at = nowIso; doc.created = created || undefined;

  if (!dry) {
    const up: any[] = [];
    for (const [d, dd] of Object.entries(docs)) {
      if (d !== today && JSON.stringify(dd) === before[d]) continue;
      up.push({ path: docPath(cid, d), coll: "roster_auto", data: dd, updated_at: nowIso });
    }
    if (up.length) { const { error } = await sb.from("docs").upsert(up); if (error) throw new Error(error.message); }
  }
  return { counts, written: dry ? 0 : Object.keys(docs).filter((d) => d === today || JSON.stringify(docs[d]) !== before[d]).length, doc: dry ? doc : undefined };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const t0 = Date.now(), nowIso = new Date(t0).toISOString(), today = riyDay(t0);
  let b: any = {}; try { b = await req.json(); } catch { /* cron sends {} */ }
  const backfill = Math.min(14, Math.max(0, Math.floor(Number(b?.backfill_days) || 0))), dry = !!b?.dry;
  const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });
  const [{ data: hbRow }, { data: seasonRow }, { data: cl }] = await Promise.all([
    sb.from("docs").select("data").eq("path", "sys/roster_sync").maybeSingle(),
    sb.from("docs").select("data").eq("path", "sys/season").maybeSingle(),
    sb.from("docs").select("c:data->clients").eq("path", "config/app").maybeSingle(),
  ]);
  const hb: any = (hbRow as any)?.data || {}, sh: any = (seasonRow as any)?.data || {};
  const started = hb.started_at ? Date.parse(hb.started_at) : 0;
  if (!dry && hb.running && t0 - started < 5 * 60e3) return json({ ok: true, skipped: "overlap", started_at: hb.started_at, ms: Date.now() - t0 });
  if (!dry && !backfill && !hb.running && t0 - started < 4 * 60e3) return json({ ok: true, skipped: "throttled", started_at: hb.started_at, ms: Date.now() - t0 });

  const seasonRunning = !!sh.active && !!sh.last_tick_at && t0 - Date.parse(sh.last_tick_at) < 10 * 60e3;
  const run: any = { ...hb, running: true, started_at: nowIso };
  if (!dry) await sb.from("docs").upsert({ path: "sys/roster_sync", coll: "sys", data: run, updated_at: nowIso });

  const clients: any[] = (((cl as any)?.c) || []).filter((c: any) => c && c.id);
  const res: Record<string, any> = {};
  let allOk = true;
  for (const c of clients) {
    const t1 = Date.now(), r1: any = {};
    // 1) refresh first (skipped in season mode and for backfill/dry calls)
    if (!seasonRunning && !backfill && !dry) {
      try {
        const { status, body: r } = await callFn("camp-refresh", { client: c.id, from: today, to: today }, 70e3);
        r1.refresh = status === 400 && r?.code === "bad" ? "skipped: no platform configured" : (r?.ok ? "ok" : short(r?.error || "HTTP " + status));
        r1.refresh_ms = Date.now() - t1;
      } catch (e) { r1.refresh = "error: " + short((e as Error)?.message || e); }
    } else r1.refresh = seasonRunning ? "skipped: season mode refreshes every 2 min" : "skipped";
    // 2) read + maintain the auto docs
    try {
      const s = await syncClient(sb, c.id, today, new Date().toISOString(), backfill || 1, dry);
      r1.ok = true; r1.platforms = s.counts; r1.docs_written = s.written; if (dry) r1.doc = s.doc;
    } catch (e) { r1.ok = false; r1.error = short((e as Error)?.message || e); allOk = false; }
    r1.ms = Date.now() - t1; res[c.id] = r1;
  }
  const fin = new Date().toISOString();
  const out: any = { running: false, started_at: nowIso, last_run_at: fin, day: today, ms: Date.now() - t0, ok: allOk, season_running: seasonRunning, backfill_days: backfill || undefined, clients: res,
    runs: (Number(hb.runs) || 0) + (dry ? 0 : 1) };
  if (!allOk) out.last_error_at = fin; else if (hb.last_error_at) out.last_error_at = hb.last_error_at;
  if (!dry) await sb.from("docs").upsert({ path: "sys/roster_sync", coll: "sys", data: out, updated_at: fin });
  return json({ ok: allOk, ...out });
});
