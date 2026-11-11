// GADLYTICS widget for Scriptable (iPhone / iPad) \u2014 today's spend \u00b7 donations \u00b7 revenue \u00b7 ROAS from gad-api.
// Widget parameter (long-press the widget \u2192 Edit Widget \u2192 Parameter), optional:  meta | tiktok | snap (or \u0645\u064a\u062a\u0627 | \u062a\u064a\u0643 \u062a\u0648\u0643 | \u0633\u0646\u0627\u0628) for one platform,  \u0645\u0644\u0628\u064a | \u062f\u064a\u0645\u0627\u0646  and  today | yesterday
//   e.g.  \u0645\u0644\u0628\u064a   or   \u062f\u064a\u0645\u0627\u0646,yesterday
// Tap \u00ab\u062a\u062d\u062f\u064a\u062b\u00bb \u2192 pulls today's spend from the platforms now (camp-refresh) and redraws. Tap elsewhere \u2192 opens GADLYTICS.
// The API key is asked once and kept in the iOS Keychain (never in this file). Key needs scopes read + refresh:
//   python3 ~/.gadlytics/make_api_key.py widget --refresh
const SB = "https://ibpwudzjwjraqhfdmzet.supabase.co";
const API = SB + "/functions/v1/gad-api";
const SITE = "https://mahmoudgadmediabuyer.github.io/gadlytics/";
const KC = "gadlytics_api_key", KC_ANON = "gadlytics_anon";
const C = { bg: new Color("#1a1d2e"), dim: new Color("#9aa0c3"), line: new Color("#2e3350"), txt: Color.white(),
  scale: new Color("#5DCAA5"), ok: new Color("#9FE1CB"), watch: new Color("#EF9F27"), alarm: new Color("#F09595") };

const p = String(args.widgetParameter || "").split(/[,\u060c\s]+/).filter(Boolean);
const q = args.queryParameters || {};
const CLIENT = q.client || (p.find((x) => /\u062f\u064a\u0645\u0627\u0646|deiman|dm1n4an/i.test(x)) ? "dm1n4an" : "3sa3k1k");
const PLAT = q.platform || (p.find((x) => /meta|facebook|\u0645\u064a\u062a\u0627|\u0641\u064a\u0633/i.test(x)) ? "meta" : p.find((x) => /tiktok|\u062a\u064a\u0643/i.test(x)) ? "tiktok" : p.find((x) => /snap|\u0633\u0646\u0627\u0628/i.test(x)) ? "snap" : "");
const PLAT_AR = { meta: "\u0645\u064a\u062a\u0627", tiktok: "\u062a\u064a\u0643 \u062a\u0648\u0643", snap: "\u0633\u0646\u0627\u0628" };
const PERIOD = q.period || (p.find((x) => /yesterday|\u0627\u0645\u0628\u0627\u0631\u062d/i.test(x)) ? "yesterday" : "today");

async function anonKey() {
  try {
    const js = await new Request(SITE + "config.js?_=" + Date.now()).loadString();
    const m = js.match(/supabaseAnonKey:\s*"([^"]+)"/); if (m) { Keychain.set(KC_ANON, m[1]); return m[1]; }
  } catch (e) { /* offline \u2192 cached copy */ }
  return Keychain.contains(KC_ANON) ? Keychain.get(KC_ANON) : null;
}
async function askKey(msg) {
  const a = new Alert(); a.title = "\u0645\u0641\u062a\u0627\u062d GADLYTICS";
  a.message = msg || "\u0627\u0644\u0635\u0642 \u0627\u0644\u0645\u0641\u062a\u0627\u062d \u0627\u0644\u0644\u064a \u0628\u064a\u0628\u062f\u0623 \u0628\u0640 gad_ (\u0645\u0646 \u0627\u0644\u0623\u0645\u0631 make_api_key.py widget --refresh)";
  a.addSecureTextField("gad_\u2026", ""); a.addAction("\u062d\u0641\u0638"); a.addCancelAction("\u0625\u0644\u063a\u0627\u0621");
  if ((await a.present()) < 0) return null;
  const k = a.textFieldValue(0).trim(); if (!/^gad_/.test(k)) return null;
  Keychain.set(KC, k); return k;
}
async function call(path, method, body) {
  const anon = await anonKey(), key = Keychain.contains(KC) ? Keychain.get(KC) : null;
  if (!anon) throw new Error("\u0645\u0634 \u0642\u0627\u062f\u0631 \u0623\u0648\u0635\u0644 \u0644\u0644\u0633\u064a\u0633\u062a\u0645 \u2014 \u0627\u062a\u0623\u0643\u062f \u0645\u0646 \u0627\u0644\u0646\u062a");
  if (!key) throw new Error("NO_KEY");
  const r = new Request(API + path); r.method = method || "GET"; r.timeoutInterval = 45;
  r.headers = { Authorization: "Bearer " + anon, apikey: anon, "x-api-key": key, "content-type": "application/json" };
  if (body) r.body = JSON.stringify(body);
  const j = await r.loadJSON(), st = r.response ? r.response.statusCode : 0;
  if (st === 401) throw new Error("NO_KEY");
  if (st >= 400 || j.ok === false) throw new Error(j.error_ar || ("\u062e\u0637\u0623 " + st));
  return j;
}

const fmt = (v, d) => v == null ? "\u2014" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 });
const rx = (v, d) => v == null ? "\u2014" : fmt(v, d) + "x";
const short = (v) => v == null ? "\u2014" : v >= 1e6 ? fmt(v / 1e6, 1) + "M" : v >= 1e4 ? fmt(v / 1e3, 1) + "k" : fmt(v);
function verdict(ro, rules) {
  const alarm = rules && rules.alarm_below || 2, min = rules && rules.watch_below || 2.1, good = rules && rules.scale_from || 2.8;
  if (ro == null) return null;
  return ro >= good ? ["\u0632\u0648\u0651\u062f", C.scale] : ro >= min ? ["\u0643\u0648\u064a\u0633", C.ok] : ro >= alarm ? ["\u0631\u0627\u0642\u0628", C.watch] : ["\u0625\u0646\u0630\u0627\u0631", C.alarm];
}
function hhmm(d) { const f = new DateFormatter(); f.locale = "en"; f.dateFormat = "h:mm"; return f.string(d); }

function text(st, s, size, color, bold) {
  const t = st.addText(String(s)); t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.textColor = color || C.txt; t.lineLimit = 1; t.minimumScaleFactor = 0.6; t.rightAlignText(); return t;
}
function cell(row, label, value, color) {
  const s = row.addStack(); s.layoutVertically();
  const a = s.addStack(); a.addSpacer(); text(a, label, 11, C.dim);
  const b = s.addStack(); b.addSpacer(); text(b, value, 18, color, true);
}
const runURL = (extra) => "scriptable:///run/" + encodeURIComponent(Script.name()) + "?refresh=1&client=" + CLIENT + "&period=" + PERIOD + (PLAT ? "&platform=" + PLAT : "") + (extra || "");

function build(d, family, note) {
  const w = new ListWidget(); w.backgroundColor = C.bg; w.url = SITE + "#campperf";
  w.refreshAfterDate = new Date(Date.now() + 15 * 60e3);
  const k = {}; (d.kpis || []).forEach((x) => { k[x.key] = x.value; });
  const v = verdict(k.roas, d.roas_rules), roasCol = v ? v[1] : C.txt;
  const who = (d.client && d.client.name || "") + (PLAT ? " \u00b7 " + PLAT_AR[PLAT] : "") + " \u00b7 " + (PERIOD === "today" ? "\u0627\u0644\u0646\u0647\u0627\u0631\u062f\u0647" : "\u0627\u0645\u0628\u0627\u0631\u062d");
  const upd = hhmm(new Date());

  if (family === "accessoryRectangular" || family === "accessoryInline" || family === "accessoryCircular") {
    w.backgroundColor = null; w.url = runURL();
    if (family === "accessoryInline") { text(w, who + " " + short(k.spend) + " \u00b7 " + rx(k.roas, 2), 12); return w; }
    if (family === "accessoryCircular") { text(w, rx(k.roas, 1), 14, null, true); text(w, short(k.spend), 10); return w; }
    text(w, who, 11, null); const r = w.addStack(); r.centerAlignContent();
    text(r, rx(k.roas, 2), 16, null, true); r.addSpacer(); text(r, short(k.spend), 18, null, true);
    text(w, "\u0627\u0636\u063a\u0637 \u0644\u0644\u062a\u062d\u062f\u064a\u062b \u00b7 " + upd, 10); return w;
  }

  w.setPadding(12, 14, 12, 14);
  const top = w.addStack(); top.centerAlignContent();
  const btn = top.addStack(); btn.backgroundColor = C.line; btn.cornerRadius = 9; btn.setPadding(4, 8, 4, 8); btn.centerAlignContent();
  btn.url = runURL();
  const ic = btn.addImage(SFSymbol.named("arrow.clockwise").image); ic.imageSize = new Size(11, 11); ic.tintColor = C.txt;
  if (family !== "small") { btn.addSpacer(4); text(btn, "\u062a\u062d\u062f\u064a\u062b", 11, C.txt); }
  top.addSpacer(); text(top, family === "small" ? who : "GADLYTICS \u00b7 " + who, 11, C.dim);
  w.addSpacer();

  if (family === "small") {
    w.url = runURL();   // small widgets have one tap target \u2192 tap anywhere = refresh
    const a = w.addStack(); a.addSpacer(); text(a, "\u0627\u0644\u0635\u0631\u0641", 11, C.dim);
    const b = w.addStack(); b.addSpacer(); text(b, fmt(k.spend), 24, null, true);
    w.addSpacer();
    const c = w.addStack(); c.bottomAlignContent();
    if (v) { const pill = c.addStack(); pill.backgroundColor = new Color(v[1].hex, 0.18); pill.cornerRadius = 8; pill.setPadding(2, 7, 2, 7); text(pill, v[0], 11, v[1]); }
    c.addSpacer();
    const r = c.addStack(); r.layoutVertically(); const r1 = r.addStack(); r1.addSpacer(); text(r1, "\u0627\u0644\u0631\u0648\u0632", 11, C.dim);
    const r2 = r.addStack(); r2.addSpacer(); text(r2, rx(k.roas, 2), 19, roasCol, true);
  } else {
    const row = w.addStack();
    cell(row, "\u0627\u0644\u0631\u0648\u0632", rx(k.roas, 2), roasCol); row.addSpacer();
    cell(row, "\u0627\u0644\u0625\u064a\u0631\u0627\u062f", fmt(k.revenue)); row.addSpacer();
    cell(row, d.client && d.client.id === "dm1n4an" ? "\u0627\u0644\u0637\u0644\u0628\u0627\u062a" : "\u0627\u0644\u062a\u0628\u0631\u0639\u0627\u062a", fmt(k.orders)); row.addSpacer();
    cell(row, "\u0627\u0644\u0635\u0631\u0641", fmt(k.spend));
    if (family === "large") {
      w.addSpacer(10);
      const r2 = w.addStack();
      cell(r2, "\u062a\u0643\u0644\u0641\u0629 \u0627\u0644\u062a\u0628\u0631\u0639", fmt(k.cpa)); r2.addSpacer(); cell(r2, "\u0645\u062a\u0648\u0633\u0637 \u0627\u0644\u062a\u0628\u0631\u0639", fmt(k.aov)); r2.addSpacer();
      cell(r2, "\u0627\u0644\u0645\u064a\u0632\u0627\u0646\u064a\u0629", fmt(k.budget)); r2.addSpacer(); cell(r2, "\u0627\u0644\u062d\u0645\u0644\u0627\u062a", fmt(k.campaigns));
    }
    w.addSpacer();
    const pl = w.addStack(); pl.centerAlignContent();
    text(pl, note || ("\u0622\u062e\u0631 \u062a\u062d\u062f\u064a\u062b " + upd), 10, C.dim); pl.addSpacer();
    (PLAT ? [] : d.by_platform || []).slice().reverse().forEach((x, i) => {
      if (i) text(pl, "  \u00b7  ", 10, C.dim);
      const vv = verdict(x.roas, d.roas_rules);
      text(pl, (x.platform_ar || x.platform) + " " + rx(x.roas, 1), 10, vv && (vv[0] === "\u0625\u0646\u0630\u0627\u0631" || vv[0] === "\u0631\u0627\u0642\u0628") ? vv[1] : C.dim);
    });
  }
  return w;
}
function errWidget(msg) {
  const w = new ListWidget(); w.backgroundColor = C.bg; w.url = runURL(); w.setPadding(12, 14, 12, 14);
  text(w, "GADLYTICS", 12, C.dim); w.addSpacer(); w.addText(msg).textColor = C.alarm; w.addSpacer();
  text(w, "\u0627\u0636\u063a\u0637 \u0647\u0646\u0627 \u0639\u0644\u0634\u0627\u0646 \u062a\u0635\u0644\u0651\u062d\u0647\u0627", 10, C.dim); return w;
}

async function main() {
  let note = null;
  if (!config.runsInWidget) {
    if (!Keychain.contains(KC)) { if (!(await askKey())) return; }
    if (q.refresh) {
      try { await call("/refresh", "POST", { client: CLIENT }); note = "\u0627\u062a\u062d\u062f\u0651\u062b " + hhmm(new Date()) + " \u2713"; }
      catch (e) {
        if (e.message === "NO_KEY") { if (!(await askKey("\u0627\u0644\u0645\u0641\u062a\u0627\u062d \u063a\u0644\u0637 \u0623\u0648 \u0627\u062a\u0644\u063a\u0649 \u2014 \u0627\u0644\u0635\u0642 \u0645\u0641\u062a\u0627\u062d \u062c\u062f\u064a\u062f"))) return; }
        else note = String(e.message).slice(0, 60);
      }
    }
  }
  let w;
  try {
    const d = await call("/summary?client=" + CLIENT + "&period=" + PERIOD + (PLAT ? "&platform=" + PLAT : ""));
    const fam = config.runsInWidget ? config.widgetFamily : "medium";
    w = build(d, fam, note);
  } catch (e) {
    if (e.message === "NO_KEY" && !config.runsInWidget && (await askKey("\u0627\u0644\u0645\u0641\u062a\u0627\u062d \u063a\u0644\u0637 \u0623\u0648 \u0627\u062a\u0644\u063a\u0649 \u2014 \u0627\u0644\u0635\u0642 \u0645\u0641\u062a\u0627\u062d \u062c\u062f\u064a\u062f"))) return main();
    w = errWidget(e.message === "NO_KEY" ? "\u0645\u062d\u062a\u0627\u062c \u0645\u0641\u062a\u0627\u062d \u2014 \u0627\u0636\u063a\u0637 \u0647\u0646\u0627" : String(e.message).slice(0, 80));
  }
  if (config.runsInWidget) Script.setWidget(w);
  else { await w.presentMedium(); }
  Script.complete();
}
await main();
