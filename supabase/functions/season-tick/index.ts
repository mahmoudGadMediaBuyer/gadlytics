// GADLYTICS «وضع الموسم» (season mode) — pg_cron job gad-season-tick calls this every 2 minutes, 24 h a day (anon key header, like
// gad-camp-alerts; verify_jwt ON). The gateway check is the only gate, so every call must be harmless: it throttles itself.
// Config: its own doc config/season = {auto_start:'2027-01-09', on, off, label, note} (NOT inside config/app — the site's settings save rewrites config/app and would drop it). Active = !off && (on || today(Riyadh) >= auto_start).
// If the key is missing (a settings save from the site rewrites config/app with only the keys it knows), auto_start falls back to 2027-01-09.
// Inactive → returns at once (one tiny read). Active → for each client in config/app .clients, one after the other (they share the Snap
// token refresh), POST camp-refresh {client, from: today, to: today} with the service role (00:00–00:10 Riyadh: from = yesterday, once a night).
// Every ~5 minutes (UTC minute % 5 < 2) outside 05:00–20:59 UTC — the hours the gad-camp-alerts cron does not cover — it also calls camp-alerts
// with force (camp-alerts skips 00:00–07:59 Riyadh otherwise); media alerts only every 15 minutes, as in the daytime.
// Heartbeat: docs sys/season {active, running, started_at, last_tick_at, ms, clients:{id:{ok,ms,from,to,spend,errors}}, last_alerts_at, …}.
// Guard: skip if the last tick started < 90 s ago and has not finished (overlap), or finished and started < 60 s ago (throttle).
// READ-ONLY on the ad platforms: the only platform traffic is the reads camp-refresh already does. No writes, no budget changes.
// Body (all optional): {probe_alerts:true} → also call camp-alerts with dry:true (evaluate only, nothing sent) — for testing the call path.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "content-type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const SB_URL = env("SUPABASE_URL"), SRK = env("SUPABASE_SERVICE_ROLE_KEY");
const AUTO_START = "2027-01-09";            // 1 Sha'ban 1448 (Umm al-Qura)
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const riy = (ms = Date.now()) => new Date(ms + 3 * 3600e3);
const riyDay = (ms = Date.now()) => riy(ms).toISOString().slice(0, 10);
const addDay = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
const short = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").slice(0, 200);

async function callFn(name: string, body: unknown, ms: number) {
  const r = await fetch(SB_URL + "/functions/v1/" + name, { method: "POST", signal: AbortSignal.timeout(ms),
    headers: { Authorization: "Bearer " + SRK, apikey: SRK, "content-type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.json().catch(() => ({ ok: false, error: "HTTP " + r.status }));
  return { status: r.status, body: t };
}
function seasonState(s: any, day: string) {
  s = s && typeof s === "object" ? s : {};
  const auto = ISO.test(String(s.auto_start || "")) ? String(s.auto_start) : AUTO_START;
  const active = !s.off && (!!s.on || day >= auto);
  return { active, auto_start: auto, on: !!s.on, off: !!s.off, label: s.label || null, why: s.off ? "forced off" : s.on ? "forced on" : day >= auto ? "auto (from " + auto + ")" : "waiting for " + auto };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const t0 = Date.now();
  let b: any = {}; try { b = await req.json(); } catch { /* cron sends {} */ }
  const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });
  const day = riyDay(t0);
  const [{ data: app }, { data: hbRow }] = await Promise.all([
    sb.from("docs").select("s:data").eq("path", "config/season").maybeSingle(),
    sb.from("docs").select("data").eq("path", "sys/season").maybeSingle(),
  ]);
  const S = seasonState((app as any)?.s, day);
  const hb: any = (hbRow as any)?.data || {};

  if (!S.active) {
    // switched off since the last tick → mark the heartbeat inactive once; otherwise nothing is written
    if (hb.active) await sb.from("docs").upsert({ path: "sys/season", coll: "sys", data: { ...hb, active: false, running: false, stopped_at: new Date().toISOString(), why: S.why }, updated_at: new Date().toISOString() });
    return json({ ok: true, active: false, why: S.why, auto_start: S.auto_start, ms: Date.now() - t0 });
  }

  // overlap / throttle guard
  const startedMs = hb.started_at ? Date.parse(hb.started_at) : 0;
  if (hb.running && t0 - startedMs < 90e3) return json({ ok: true, active: true, skipped: "overlap", started_at: hb.started_at, ms: Date.now() - t0 });
  if (!hb.running && t0 - startedMs < 60e3) return json({ ok: true, active: true, skipped: "throttled", started_at: hb.started_at, ms: Date.now() - t0 });

  const startedAt = new Date(t0).toISOString();
  const yday = addDay(day, -1), minOfDay = riy(t0).getUTCHours() * 60 + riy(t0).getUTCMinutes();
  const withYesterday = minOfDay < 10 && hb.yesterday_done !== yday;
  const run: any = { ...hb, active: true, running: true, started_at: startedAt, why: S.why, label: S.label, auto_start: S.auto_start };
  await sb.from("docs").upsert({ path: "sys/season", coll: "sys", data: run, updated_at: startedAt });

  // 1) platform spend, one client after the other — one failing never blocks the next
  const { data: cl } = await sb.from("docs").select("c:data->clients").eq("path", "config/app").maybeSingle();
  const clients: any[] = (((cl as any)?.c) || []).filter((c: any) => c && c.id);
  const res: Record<string, any> = {};
  let allOk = true;
  for (const c of clients) {
    const t1 = Date.now(), from = withYesterday ? yday : day;
    try {
      const { status, body: r } = await callFn("camp-refresh", { client: c.id, from, to: day }, 70e3);
      if (status === 400 && r?.code === "bad") { res[c.id] = { ok: null, skipped: "no platform configured in camp-refresh", ms: Date.now() - t1 }; continue; }
      const spend: Record<string, number | string> = {}, errors: string[] = [];
      for (const [pl, v] of Object.entries(r?.platforms || {}) as [string, any][]) {
        if (typeof v === "string") { spend[pl] = v; continue; }
        if (v && typeof v === "object") {
          if (typeof v.spend === "number") spend[pl] = v.spend;
          if (v.error) errors.push(pl + ": " + short(v.error));
          for (const [acc, a] of Object.entries(v.accounts || {}) as [string, any][]) if (a?.error) errors.push(pl + " " + acc + ": " + short(a.error) + (a.detail ? " (" + short(a.detail) + ")" : ""));
        }
      }
      if (!r?.ok && !errors.length) errors.push(short(r?.error || "HTTP " + status));
      res[c.id] = { ok: !!r?.ok, ms: Date.now() - t1, fn_ms: r?.ms ?? null, from, to: day, spend, errors: errors.length ? [...new Set(errors)].slice(0, 8) : undefined };
      if (!r?.ok) allOk = false;
    } catch (e) {
      res[c.id] = { ok: false, ms: Date.now() - t1, from, to: day, errors: [short((e as Error)?.message || e)] }; allOk = false;
    }
  }

  // 2) alerts during the hours the gad-camp-alerts cron does not cover (21:00–04:59 UTC = 00:00–07:59 Riyadh), every ~5 minutes
  const U = new Date(), uh = U.getUTCHours(), um = U.getUTCMinutes();
  const night = uh >= 21 || uh < 5, alertSlot = um % 5 < 2;
  const lastAl = hb.last_alerts_at ? Date.parse(hb.last_alerts_at) : 0;
  let alerts: any = hb.last_alerts || null, lastAlertsAt = hb.last_alerts_at || null;
  const real = night && alertSlot && Date.now() - lastAl > 3 * 60e3;
  let called = false;
  if (real || b?.probe_alerts) {
    const t2 = Date.now(), dry = !real; called = true;
    const body: any = dry ? { dry: true } : { force: true };
    if (!dry && um % 15 >= 5) body.only = ["roas", "spike", "norev", "meta"];   // media (Airtable) stays on its 15-minute cadence
    try {
      const { status, body: r } = await callFn("camp-alerts", body, 140e3);
      alerts = { ok: !!r?.ok, dry, ms: Date.now() - t2, status, skipped: r?.skipped || undefined, refresh: r?.refresh || undefined,
        alerts: Array.isArray(r?.alerts) ? r.alerts.length : undefined, sent: Array.isArray(r?.sent) ? r.sent.length : undefined, error: r?.ok ? undefined : short(r?.error || "HTTP " + status) };
    } catch (e) { alerts = { ok: false, dry, ms: Date.now() - t2, error: short((e as Error)?.message || e) }; }
    if (!dry) lastAlertsAt = new Date().toISOString();
  }

  const fin = new Date().toISOString();
  const out: any = { ...run, running: false, last_tick_at: fin, ms: Date.now() - t0, ok: allOk, clients: res, last_alerts_at: lastAlertsAt, last_alerts: alerts,
    ticks: (Number(hb.ticks) || 0) + 1, yesterday_done: withYesterday && allOk ? yday : (hb.yesterday_done || null) };
  if (!allOk) out.last_error_at = fin;
  await sb.from("docs").upsert({ path: "sys/season", coll: "sys", data: out, updated_at: fin });
  return json({ ok: allOk, active: true, why: S.why, ms: out.ms, clients: res, alerts: called ? alerts : undefined, with_yesterday: withYesterday || undefined });
});
