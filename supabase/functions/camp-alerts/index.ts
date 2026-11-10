// GADLYTICS — server alerts engine. pg_cron calls it every 5 minutes, 08:00–24:00 Riyadh. The gateway JWT check stays on: cron sends the
// project's public anon key (the same one config.js ships), so no secret lives in SQL. Calls are harmless anyway — it throttles itself
// to one real run per 4 minutes and never repeats an alert unless it got worse / its cooldown passed.
// Each run: refresh today's platform spend (camp-refresh; also writes camp_hourly) → record fine snapshots in public.alert_snap
// (cumulative spend per campaign at every ad-account pull + Khzama cumulative revenue at every Khzama pull) → evaluate the rules →
// push through the `push` function (applies each device's settings: rule off, delivery hours, quiet hours, silent) → every alert is
// logged in public.alerts_sent («سجل التنبيهات»). Server-to-server calls use the service-role key, which never leaves Supabase.
// Rules (keys = prefs.rules on each device): roas · spike · norev · media · meta (meta is off unless switched on in config/alerts).
// Thresholds: each device's own numbers from the notifications screen (push_subs.prefs spikePct/spikeMin/norevWin/norevMin) win;
// ROAS uses the client's roasAlarm (config/app); everything else: docs 'config/alerts' {defaults:{rule:{…}}, clients:{id:{rule:{…}}}} over DEF.
// Revenue = Khzama only (khzama_link_daily); platform purchases are never used. Rules that need revenue only run when Khzama is fresh.
// Input (all optional): {dry:true → evaluate only, no refresh / snapshot / send · force:true → ignore throttle + hours · only:[rule keys]}
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "content-type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const SITE = "https://mahmoudgadmediabuyer.github.io/gadlytics/";
const FN = () => env("SUPABASE_URL") + "/functions/v1/";
const MIN = 60e3, DAY = 86400e3;
const riy = (ms = Date.now()) => new Date(ms + 3 * 3600e3);
const dayOf = (ms = Date.now()) => riy(ms).toISOString().slice(0, 10);
const addDay = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const hhmm = (ms: number) => riy(ms).toISOString().slice(11, 16);
const fmt = (n: number, d = 0) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const PL: Record<string, string> = { meta: "ميتا", snap: "سناب", tiktok: "تيك توك" };

// defaults — every value can be overridden per client in docs 'config/alerts'
const DEF: Record<string, any> = {
  roas: { on: true, alarm: 0, minSpend: 300, cpaMult: 2, total: true, maxKzAgeMin: 180 },   // alarm = the client's roasAlarm (config/app); this only if that is empty; else 2.0
  spike: { on: true, pct: 40, minSar: 150, windowMin: 15, cooldownMin: 60 },
  norev: { on: true, minSar: 200, windowMin: 30, campaigns: true, campMinSar: 200, cooldownMin: 60 },   // same defaults as the page (PUSH_DEF)
  media: { on: true, everyMin: 15 },
  meta: { on: false, days: 7 },
};
function cfgFor(doc: any, cid: string | null) {
  const o: any = {};
  for (const k of Object.keys(DEF)) o[k] = { ...DEF[k], ...(doc?.defaults?.[k] || {}), ...(cid ? doc?.clients?.[cid]?.[k] || {} : {}) };
  o.norev.windowMin = Number(o.norev.windowMin) === 15 ? 15 : 30;
  o.spike.windowMin = Math.min(60, Math.max(5, Number(o.spike.windowMin) || 15));
  return o;
}

async function callFn(name: string, body: unknown) {
  const r = await fetch(FN() + name, { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY") }, body: JSON.stringify(body) });
  return await r.json().catch(() => ({ ok: false, error: "HTTP " + r.status }));
}
async function pageAll(q: any) {
  const out: any[] = [];
  for (let i = 0; ; i += 1000) { const { data, error } = await q.range(i, i + 999); if (error || !data) break; out.push(...data); if (data.length < 1000) break; }
  return out;
}
const ms = (s: string) => Date.parse(s);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const t0 = Date.now();
  let b: any = {}; try { b = await req.json(); } catch { /* cron sends {} */ }
  const dry = !!b?.dry, force = !!b?.force, only: Set<string> | null = Array.isArray(b?.only) ? new Set(b.only) : null;
  const want = (k: string) => !only || only.has(k);
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const now = Date.now(), D = dayOf(now), R = riy(now), H = R.getUTCHours(), M = R.getUTCMinutes();
  const dayStart = Date.parse(D + "T00:00:00+03:00");
  if (H < 8 && !force && !dry) return json({ ok: true, skipped: "outside 08:00–24:00 Riyadh" });

  // throttle: one real run per 4 minutes (the endpoint has no secret, so repeated calls must be harmless)
  if (!dry) {
    const { data: last } = await sb.from("sys_kv").select("v").eq("k", "alerts_last").maybeSingle();
    if (!force && last?.v && now - Number(last.v) < 4 * MIN) return json({ ok: true, skipped: "throttled" });
    await sb.from("sys_kv").upsert({ k: "alerts_last", v: String(now), updated_at: new Date().toISOString() }, { onConflict: "k" });
  }

  const [{ data: app }, { data: ac }] = await Promise.all([
    sb.from("docs").select("data").eq("path", "config/app").maybeSingle(),
    sb.from("docs").select("data").eq("path", "config/alerts").maybeSingle(),
  ]);
  const clients: any[] = (app?.data?.clients || []).filter((c: any) => c && c.id);
  const G = cfgFor(ac?.data, null);

  // per-device thresholds — what Mahmoud sets on the notifications screen (push_subs.prefs: spikePct · spikeMin · norevWin 15/30 · norevMin).
  // Devices with the same numbers form one profile; spike / norev are evaluated per profile and sent only to that profile's devices.
  const { data: subs } = await sb.from("push_subs").select("endpoint,prefs").eq("active", true);
  const profMap: Record<string, any> = {};
  for (const s of subs || []) {
    const p = s.prefs || {}, pos = (x: any) => (Number(x) > 0 ? Number(x) : null), w = Number(p.norevWin);
    const pr = { spikePct: pos(p.spikePct), spikeMin: pos(p.spikeMin), norevWin: w === 15 || w === 30 ? w : null, norevMin: pos(p.norevMin) };
    const id = [pr.spikePct ?? "-", pr.spikeMin ?? "-", pr.norevWin ?? "-", pr.norevMin ?? "-"].join("/");
    (profMap[id] = profMap[id] || { id, ...pr, eps: [] }).eps.push(s.endpoint);
  }
  const profiles: any[] = Object.values(profMap);
  if (!profiles.length) profiles.push({ id: "default", spikePct: null, spikeMin: null, norevWin: null, norevMin: null, eps: null });
  const profC = (C: any, P: any) => ({
    spike: { ...C.spike, pct: P.spikePct ?? C.spike.pct, minSar: P.spikeMin ?? C.spike.minSar },
    norev: { ...C.norev, windowMin: P.norevWin ?? C.norev.windowMin, minSar: P.norevMin ?? C.norev.minSar, campMinSar: P.norevMin ?? C.norev.campMinSar },
  });
  const out: any = { ok: true, day: D, at: new Date().toISOString(), dry, refresh: {}, profiles: profiles.map((p) => ({ id: p.id, devices: p.eps ? p.eps.length : 0 })), eval: {}, alerts: [], sent: [], skipped: [] };
  const alerts: any[] = [];
  const add = (a: any) => alerts.push(a);

  // 1) refresh today's platform spend — one client after the other (they share the Snap token refresh)
  if (!dry) for (const c of clients) {
    const r = await callFn("camp-refresh", { client: c.id, from: D, to: D });
    out.refresh[c.id] = r?.ok ? "ok" : (r?.error || Object.entries(r?.platforms || {}).filter(([, v]: any) => v?.error).map(([k, v]: any) => k + ": " + v.error).join(" · ") || "failed");
  }

  // normal CPA per client (last 7 full days: platform spend ÷ Khzama donations), cached once a day
  let cpaCache: any = null;
  { const { data } = await sb.from("sys_kv").select("v").eq("k", "alerts_cpa").maybeSingle(); try { cpaCache = data?.v ? JSON.parse(data.v) : null; } catch { cpaCache = null; } }
  if (!cpaCache || cpaCache.day !== D) {
    cpaCache = { day: D, vals: {} };
    for (const c of clients) {
      const [ad, kz] = await Promise.all([
        pageAll(sb.from("ad_daily").select("spend").eq("client_id", c.id).eq("level", "ad").gte("date", addDay(D, -7)).lte("date", addDay(D, -1)).order("ad_id")),
        pageAll(sb.from("khzama_link_daily").select("donations").eq("client_id", c.id).gte("date", addDay(D, -7)).lte("date", addDay(D, -1)).order("link_id")),
      ]);
      const s = ad.reduce((t, r) => t + Number(r.spend || 0), 0), o = kz.reduce((t, r) => t + Number(r.donations || 0), 0);
      cpaCache.vals[c.id] = o >= 10 && s > 0 ? Math.round(s / o * 100) / 100 : null;
    }
    if (!dry) await sb.from("sys_kv").upsert({ k: "alerts_cpa", v: JSON.stringify(cpaCache), updated_at: new Date().toISOString() }, { onConflict: "k" });
  }

  // 2) per-client rules
  for (const c of clients) {
    const cid = c.id, C = cfgFor(ac?.data, cid), hasKz = !c.convSource || /khzama/i.test(String(c.convSource));
    const ev: any = out.eval[cid] = { notes: [] }; const note = (s: string) => ev.notes.push(s);
    const url = SITE + "?p=campperf&ws=" + cid, cname = c.name || cid;

    // today's spend now, per campaign (ad_daily is what camp-refresh just wrote)
    const ad = await pageAll(sb.from("ad_daily").select("platform,account_id,campaign_id,camp_no,spend,pulled_at").eq("client_id", cid).eq("date", D).eq("level", "ad").order("ad_id"));
    const cur: Record<string, any> = {}, acctAt: Record<string, number> = {};
    for (const r of ad) {
      if (!r.campaign_id) continue;
      const k = r.platform + "|" + r.campaign_id, a = r.platform + "|" + r.account_id, t = ms(r.pulled_at);
      const o = cur[k] || (cur[k] = { key: k, pl: r.platform, acct: a, code: null, spend: 0, at: 0 });
      o.spend += Number(r.spend || 0); if (!o.code && r.camp_no) o.code = r.camp_no; if (t > o.at) o.at = t;
      if (!acctAt[a] || t > acctAt[a]) acctAt[a] = t;
    }
    ev.spend = Math.round(Object.values(cur).reduce((t: number, o: any) => t + o.spend, 0));
    ev.campaigns = Object.keys(cur).length;
    ev.spendAt = Object.keys(acctAt).length ? new Date(Math.max(...Object.values(acctAt))).toISOString() : null;

    // Khzama now
    let kzAt = 0; const kzCode: Record<string, number> = {}; let kzTotal = 0, kzDon = 0;
    if (hasKz) {
      const kz = await pageAll(sb.from("khzama_link_daily").select("camp_no,donations,amount,pulled_at").eq("client_id", cid).eq("date", D).order("link_id"));
      for (const r of kz) { const t = ms(r.pulled_at || ""); if (t > kzAt) kzAt = t; kzTotal += Number(r.amount || 0); kzDon += Number(r.donations || 0); if (r.camp_no) kzCode[r.camp_no] = (kzCode[r.camp_no] || 0) + Number(r.amount || 0); }
      ev.khzamaAt = kzAt ? new Date(kzAt).toISOString() : null; ev.revenue = Math.round(kzTotal); ev.donations = kzDon;
    }

    // snapshots: write this run's, then read the history the windows need
    const iso = (t: number) => new Date(t).toISOString();
    const snapNow: any[] = [];
    for (const o of Object.values(cur) as any[]) snapNow.push({ client_id: cid, scope: "camp", key: o.key, at: iso(o.at), acct: o.acct, code: o.code, spend: Math.round(o.spend * 100) / 100 });
    for (const [a, t] of Object.entries(acctAt)) snapNow.push({ client_id: cid, scope: "acct", key: a, at: iso(t) });
    if (kzAt) {
      snapNow.push({ client_id: cid, scope: "rev", key: "_total", at: iso(kzAt), rev: Math.round(kzTotal * 100) / 100, don: kzDon });
      for (const [code, v] of Object.entries(kzCode)) snapNow.push({ client_id: cid, scope: "rev", key: code, at: iso(kzAt), rev: Math.round(v * 100) / 100 });
    }
    if (!dry && snapNow.length) for (let i = 0; i < snapNow.length; i += 500) {
      const { error } = await sb.from("alert_snap").upsert(snapNow.slice(i, i + 500), { onConflict: "client_id,scope,key,at", ignoreDuplicates: true });
      if (error) note("snapshot write: " + error.message);
    }
    const W_MAX = Math.max(C.spike.windowMin, 30) * MIN;
    const sinceToday = Math.max(dayStart, now - (Number(C.roas.maxKzAgeMin) || 180) * MIN - W_MAX - 15 * MIN);
    const [hT, hY, hR] = await Promise.all([
      pageAll(sb.from("alert_snap").select("scope,key,at,acct,code,spend").eq("client_id", cid).in("scope", ["camp", "acct"]).gte("at", iso(sinceToday)).order("at")),
      pageAll(sb.from("alert_snap").select("scope,key,at,acct,code,spend").eq("client_id", cid).in("scope", ["camp", "acct"]).gte("at", iso(now - DAY - W_MAX - 30 * MIN)).lte("at", iso(now - DAY + 15 * MIN)).order("at")),
      hasKz ? pageAll(sb.from("alert_snap").select("key,at,rev").eq("client_id", cid).eq("scope", "rev").gte("at", iso(dayStart)).order("at")) : Promise.resolve([]),
    ]);
    // in-memory index (this run's rows are added too, so a dry run sees the same picture)
    const marks: Record<string, number[]> = {}, val = new Map<string, number>(), campsOf: Record<string, Set<string>> = {}, codeOf: Record<string, string | null> = {};
    const ingest = (r: any) => {
      const t = ms(r.at);
      if (r.scope === "acct") { (marks[r.key] = marks[r.key] || []).push(t); return; }
      val.set(r.key + "@" + t, Number(r.spend || 0));
      (campsOf[r.acct] = campsOf[r.acct] || new Set()).add(r.key); if (r.code && !codeOf[r.key]) codeOf[r.key] = r.code;
    };
    [...hT, ...hY, ...snapNow.filter((r) => r.scope !== "rev")].forEach(ingest);
    for (const a of Object.keys(marks)) marks[a] = [...new Set(marks[a])].sort((x, y) => x - y);
    for (const o of Object.values(cur) as any[]) { codeOf[o.key] = o.code; (campsOf[o.acct] = campsOf[o.acct] || new Set()).add(o.key); }
    const TOL = 12 * MIN;
    // latest pull of an ad account at or before t (within 12 min), else null
    const markAt = (a: string, t: number) => { const l = marks[a] || []; let m: number | null = null; for (const x of l) { if (x <= t) m = x; else break; } return m != null && t - m <= TOL ? m : null; };
    const v = (k: string, m: number) => val.get(k + "@" + m) ?? 0;     // a campaign missing from a pull had no spend yet
    // client spend (total + by campaign code) as of time t, or null when some spending account has no pull near t
    const spendAt = (t: number) => {
      let total = 0; const byCode: Record<string, number> = {};
      for (const a of Object.keys(acctAt)) {
        const m = markAt(a, t); if (m == null) return null;
        for (const k of campsOf[a] || []) { const s = v(k, m); total += s; const cd = codeOf[k]; if (cd) byCode[cd] = (byCode[cd] || 0) + s; }
      }
      return { total, byCode };
    };

    for (const P of profiles) {
      const CP = profC(C, P), multi = profiles.length > 1, lbl = multi ? " [" + P.id + "]" : "", sfx = multi ? "~" + P.id : "", to = P.eps || "all";
      const addP = (x: any) => add({ ...x, obj: x.obj + sfx, to });
      // ── spike: last window vs the same window yesterday and vs today's average pace (per campaign)
      if (want("spike") && CP.spike.on) {
        const W = CP.spike.windowMin * MIN, pct = Number(CP.spike.pct) || 40, minSar = Number(CP.spike.minSar) || 150;
        let checked = 0;
        for (const o of Object.values(cur) as any[]) {
          const m1 = markAt(o.acct, now + MIN); if (m1 == null || now - m1 > 15 * MIN) continue;
          const m0 = markAt(o.acct, m1 - W); if (m0 == null || m1 - m0 < W / 2) continue;
          checked++;
          const s1 = v(o.key, m1), s0 = v(o.key, m0), rate = (s1 - s0) * W / (m1 - m0);
          if (rate < minSar) continue;
          const bases: number[] = []; let pace: number | null = null, yRate: number | null = null;
          const quarters = (m0 - dayStart) / W; if (quarters >= 60 * MIN / W && s0 > 0) { pace = s0 / quarters; bases.push(pace); }
          const y1 = markAt(o.acct, m1 - DAY), y0 = markAt(o.acct, m0 - DAY);
          if (y1 != null && y0 != null && y1 > y0) { yRate = Math.max(0, (v(o.key, y1) - v(o.key, y0)) * W / (y1 - y0)); bases.push(yRate); }
          if (!bases.length || !bases.every((x) => rate > (1 + pct / 100) * x)) continue;
          const wm = CP.spike.windowMin;
          addP({ rule: "spike", client: cid, campaign: o.code || o.key.split("|")[1], platform: o.pl, obj: cid + "|" + o.key, level: Math.round(rate), better: "low", cooldownMin: CP.spike.cooldownMin,
            title: `صرف مفاجئ · ${o.code || "حملة"} (${PL[o.pl] || o.pl})`,
            body: `صرف ${fmt(rate)} ر.س في آخر ${wm} دقيقة — ` + [yRate != null ? `امبارح نفس الوقت ${fmt(yRate)}` : "", pace != null ? `متوسط النهارده ${fmt(pace)} لكل ${wm} دقيقة` : ""].filter(Boolean).join(" · ") + ` · إجمالي النهارده ${fmt(s1)} ر.س`, url });
        }
        ev["spike" + lbl] = checked ? `checked ${checked} campaigns` : "no 15-min history yet (needs two pulls ~" + CP.spike.windowMin + " min apart)";
      }

      // ── norev: spend in the last window with zero new Khzama revenue (client total, then campaigns)
      if (want("norev") && CP.norev.on) {
        const W = CP.norev.windowMin * MIN;
        if (!hasKz) ev["norev" + lbl] = "no Khzama for this client (conversions come from " + (c.convSource || "?") + ")";
        else if (!kzAt || now - kzAt > W) ev["norev" + lbl] = "skipped — Khzama not updated in the last " + CP.norev.windowMin + " min (last " + (kzAt ? new Date(kzAt).toISOString() : "never today") + ")";
        else {
          const sp1 = spendAt(kzAt), sp0 = spendAt(kzAt - W);
          if (!sp1 || !sp0) ev["norev" + lbl] = "skipped — no platform pull near " + hhmm(kzAt) + " / " + hhmm(kzAt - W);
          else {
            // revenue at the window start: the last Khzama pull at or before it (none today → 0 at midnight)
            let r0At = dayStart; for (const r of hR) if (r.key === "_total" && ms(r.at) <= kzAt - W) r0At = Math.max(r0At, ms(r.at));
            const r0: Record<string, number> = { _total: 0 }; for (const r of hR) if (ms(r.at) === r0At) r0[r.key] = Number(r.rev || 0);
            const dRev = kzTotal - (r0._total || 0), dS = sp1.total - sp0.total;
            const camps = Object.keys(sp1.byCode).map((cd) => ({ cd, dS: sp1.byCode[cd] - (sp0.byCode[cd] || 0), dR: (kzCode[cd] || 0) - (r0[cd] || 0) }))
              .filter((x) => x.dS >= (Number(CP.norev.campMinSar) || 200) && x.dR <= 0).sort((a, b) => b.dS - a.dS);
            ev["norev" + lbl] = `window ${hhmm(kzAt - W)}–${hhmm(kzAt)}: spend ${fmt(dS)} · new revenue ${fmt(dRev)} (since ${hhmm(r0At)})`;
            const wm = CP.norev.windowMin;
            if (dS >= (Number(CP.norev.minSar) || 200) && dRev <= 0)
              addP({ rule: "norev", client: cid, obj: cid + "|total", level: Math.round(dS), better: "low", cooldownMin: CP.norev.cooldownMin,
                title: "صرف من غير تبرعات · " + cname,
                body: `صرف ${fmt(dS)} ر.س في آخر ${wm} دقيقة (لحد ${hhmm(kzAt)}) ومفيش ولا تبرع جديد في خزامى` + (CP.norev.campaigns && camps.length ? "\n" + camps.slice(0, 3).map((x) => `${x.cd}: ${fmt(x.dS)} ر.س`).join(" · ") : ""), url });
            else if (CP.norev.campaigns) for (const x of camps.slice(0, 3))
              addP({ rule: "norev", client: cid, campaign: x.cd, obj: cid + "|" + x.cd, level: Math.round(x.dS), better: "low", cooldownMin: CP.norev.cooldownMin,
                title: "صرف من غير تبرعات · " + x.cd, body: `الحملة صرفت ${fmt(x.dS)} ر.س في آخر ${wm} دقيقة (لحد ${hhmm(kzAt)}) ومفيش تبرع جديد ليها في خزامى`, url });
          }
        }
      }
    }

    // ── roas: «إنذار» under the alarm level — per campaign code and the client's total, both as of the last Khzama pull
    if (want("roas") && C.roas.on) {
      const alarm = Number(c.roasAlarm) || Number(C.roas.alarm) || 2, maxAge = (Number(C.roas.maxKzAgeMin) || 180) * MIN;
      const cpa = cpaCache.vals?.[cid] ?? null, minSpend = Number(C.roas.minSpend) || 300, mult = Number(C.roas.cpaMult) || 0;
      const thr = cpa && mult ? Math.min(mult * cpa, minSpend) : minSpend;
      ev.cpaNormal = cpa; ev.roasAlarm = alarm; ev.roasMinSpend = Math.round(thr);
      if (!hasKz) ev.roas = "no Khzama for this client";
      else if (!kzAt || now - kzAt > maxAge) ev.roas = "skipped — Khzama older than " + C.roas.maxKzAgeMin + " min (last " + (kzAt ? new Date(kzAt).toISOString() : "never today") + ")";
      else {
        // spend at the moment Khzama was read, so both sides cover the same time; right after a pull the live spend is the same thing
        let sp = spendAt(kzAt);
        if (!sp && now - kzAt <= 10 * MIN) { sp = { total: 0, byCode: {} }; for (const o of Object.values(cur) as any[]) { sp.total += o.spend; if (o.code) sp.byCode[o.code] = (sp.byCode[o.code] || 0) + o.spend; } }
        if (!sp) ev.roas = "skipped — no platform pull near the Khzama time " + hhmm(kzAt);
        else {
          const asOf = hhmm(kzAt); let n = 0;
          for (const [cd, s] of Object.entries(sp.byCode)) {
            if (s < thr) continue; n++;
            const r = kzCode[cd] || 0, ro = r / s;
            if (ro < alarm) add({ rule: "roas", client: cid, campaign: cd, obj: cid + "|" + cd, level: Math.round(ro * 100) / 100, better: "high",
              title: "إنذار ROAS · " + cd, body: `ROAS ${ro.toFixed(2)}x (الإنذار تحت ${alarm}) — صرف ${fmt(s)} وإيراد ${fmt(r)} ر.س لحد ${asOf}`, url });
          }
          if (C.roas.total && sp.total >= minSpend) {
            const ro = kzTotal / sp.total;
            if (ro < alarm) add({ rule: "roas", client: cid, obj: cid + "|total", level: Math.round(ro * 100) / 100, better: "high",
              title: "إنذار ROAS الإجمالي · " + cname, body: `ROAS النهارده ${ro.toFixed(2)}x (الإنذار تحت ${alarm}) — صرف ${fmt(sp.total)} وإيراد خزامى ${fmt(kzTotal)} ر.س لحد ${asOf}`, url });
          }
          ev.roas = `as of ${asOf}: total ${sp.total ? (kzTotal / sp.total).toFixed(2) : "-"}x on ${fmt(sp.total)} · ${n} campaigns over ${fmt(thr)} SAR`;
        }
      }
    }
  }

  // 3) Meta token expiry — kept, but only when switched on in config/alerts (defaults.meta.on)
  if (want("meta") && G.meta.on) {
    try {
      const { data: s } = await sb.from("app_secrets").select("value").eq("name", "META_TOKEN").maybeSingle();
      const tok = env("META_TOKEN") || s?.value || "";
      if (tok) {
        const r = await fetch("https://graph.facebook.com/v21.0/debug_token?" + new URLSearchParams({ input_token: tok, access_token: tok })).then((x) => x.json()).catch(() => ({}));
        const d = r?.data || {}, exp = Number(d.expires_at || 0) * 1000, valid = d.is_valid !== false && !r?.error, days = Number(G.meta.days) || 7;
        if (!valid) add({ rule: "meta", obj: "meta|token", level: 0, better: "high", title: "توكن ميتا مبقاش شغال", body: "تعديلات ميتا من الصفحة واقفة — طلّع توكن جديد واحفظه بـ push_meta_token.py", url: SITE });
        else if (exp && exp - now < days * DAY) { const left = Math.max(0, Math.round((exp - now) / DAY));
          add({ rule: "meta", obj: "meta|token", level: left, better: "high", title: "توكن ميتا هيخلص بعد " + left + " يوم", body: "جدّده: Graph API Explorer ← Generate ← Debugger ← Extend ← push_meta_token.py", url: SITE }); }
      }
    } catch { /* ignore */ }
  }

  // 4) new media on Airtable — grouped, one notification per run (Airtable is synced every `everyMin` minutes)
  if (want("media") && G.media.on) {
    try {
      const every = Math.max(5, Number(G.media.everyMin) || 15);
      if (!dry && (force || M % every < 5)) out.mediaSync = (await callFn("media-sync", {}))?.ok ?? "failed";
      const { data: wm } = await sb.from("sys_kv").select("v").eq("k", "media_wm").maybeSingle();
      const { data: top } = await sb.from("media").select("created_at").order("created_at", { ascending: false }).limit(1);
      const newest = top?.[0]?.created_at || null;
      if (!wm?.v) { if (!dry && newest) await sb.from("sys_kv").upsert({ k: "media_wm", v: newest, updated_at: new Date().toISOString() }, { onConflict: "k" }); out.media = "watermark set " + newest; }
      else {
        const { data: fresh } = await sb.from("media").select("creative_id,product,advertiser,kind,client,created_at").gt("created_at", wm.v).order("created_at", { ascending: true }).limit(50);
        out.media = (fresh?.length || 0) + " new since " + wm.v;
        if (fresh && fresh.length) {
          const lines = fresh.slice(0, 3).map((m: any) => [m.product, m.advertiser, m.kind].filter(Boolean).join(" · ") || m.creative_id);
          add({ rule: "media", obj: "media|" + fresh[fresh.length - 1].creative_id, level: fresh.length, better: "none", title: "ميديا جديدة على Airtable: " + fresh.length,
            body: lines.join("\n") + (fresh.length > 3 ? `\n+${fresh.length - 3} كمان` : ""), url: SITE + "?p=library", _wm: fresh[fresh.length - 1].created_at });
        }
      }
    } catch (e) { out.media = "error: " + String((e as Error)?.message || e).slice(0, 120); }
  }

  // 5) dedupe against today's log, then send
  const { data: todayLog } = await sb.from("alerts_sent").select("rule,obj,level,status,sent_at").eq("day", D).limit(5000);
  for (const a of alerts) {
    const prev = (todayLog || []).filter((x: any) => x.rule === a.rule && x.obj === a.obj);
    const sent = prev.filter((x: any) => x.status === "sent");
    let why = "";
    if (sent.length) {
      const lastSent = Math.max(...sent.map((x: any) => ms(x.sent_at)));
      const lv = sent.map((x: any) => Number(x.level)).filter((x) => isFinite(x));
      const worst = a.better === "low" ? Math.max(...lv) : a.better === "high" ? Math.min(...lv) : NaN;
      const worse = a.better === "low" ? a.level >= worst * 1.2 && a.level - worst >= 1 : a.better === "high" ? a.level <= worst * 0.85 : false;
      const cooled = a.cooldownMin ? now - lastSent >= Number(a.cooldownMin) * MIN : false;
      if (!worse && !cooled) why = a.cooldownMin ? "sent " + Math.round((now - lastSent) / MIN) + " min ago" : "already sent today";
    } else if (prev.length) {
      const lastT = Math.max(...prev.map((x: any) => ms(x.sent_at)));
      if (now - lastT < 60 * MIN) why = "held/off < 1h ago";   // held (quiet hours) → tried again hourly while still true
    }
    out.alerts.push({ rule: a.rule, obj: a.obj, level: a.level, devices: Array.isArray(a.to) ? a.to.length : "all", title: a.title, body: a.body, skip: why || undefined });
    if (why || dry) { if (why) out.skipped.push(a.rule + " " + a.obj); continue; }
    const r = await callFn("push", { action: "send", to: a.to || "all", kind: a.rule, rule: a.rule, client: a.client || null, campaign: a.campaign || null, platform: a.platform || null,
      obj: a.obj, level: a.level, title: a.title, body: a.body, url: a.url, tag: (a.rule + "-" + (a.campaign || a.obj)).slice(0, 32) });
    out.sent.push({ rule: a.rule, obj: a.obj, ok: !!r?.ok, held: r?.held || 0 });
    if (a._wm && r && (r.ok || r.held)) await sb.from("sys_kv").upsert({ k: "media_wm", v: a._wm, updated_at: new Date().toISOString() }, { onConflict: "k" });
  }

  // 6) keep alert_snap small (3 days), once an hour
  if (!dry && M < 5) await sb.from("alert_snap").delete().lt("at", new Date(now - 3 * DAY).toISOString());

  out.ms = Date.now() - t0;
  return json(out);
});
