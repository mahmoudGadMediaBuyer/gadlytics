// GADLYTICS · خزامى لحظي — every 2 minutes: load today's Khzama links (pages 1..3, full reload each), read the rows the page
// already rendered (reader.js, world MAIN), and POST them to gad-api /khzama/push as a complete snapshot of the day.
// Never touches Khzama cookies, storage, tokens or headers. This loop never types anything into Khzama.
// links.js is the second job: it registers the affiliate links of campaign builds, one tab of its own per campaign.
// launchtool.js is the third: it runs the Tamkeen launch tool for campaign builds, one tab of its own per campaign.
// live.js is the fourth: «تحديث تلقائي» — TikTok Ads Manager (ديمان + ملبي) and the ديمان backend, read from the page (1.6.0).
importScripts('reader.js', 'links.js', 'launchtool.js', 'live.js');

const API = 'https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/gad-api';
const CONFIG_JS = 'https://mahmoudgadmediabuyer.github.io/gadlytics/config.js';
const KZ = 'https://admin.molabi.sa/affiliateLinks';
const ALARM = 'kz-tick';
const MIN = 60e3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const riyadh = () => new Date(Date.now() + 3 * 3600e3);                 // Riyadh = UTC+3, no DST
const today = () => riyadh().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const pageUrl = (d, n) => `${KZ}?fromDate=${d}&toDate=${addDays(d, 1)}&size=1000&page=${n}`;
const get = (k) => chrome.storage.local.get(k);
const set = (o) => chrome.storage.local.set(o);
class LoginNeeded extends Error {}

// ───────── keys: anon key from the site's public config.js · API key from storage (or key.local.json once) ─────────
async function keys() {
  let { apiKey, anonKey, anonAt } = await get(['apiKey', 'anonKey', 'anonAt']);
  if (!apiKey) {
    try {
      const k = (await (await fetch(chrome.runtime.getURL('key.local.json'))).json()).key;
      if (typeof k === 'string' && k.startsWith('gad_')) { apiKey = k; await set({ apiKey }); }
    } catch { /* no key file */ }
  }
  if (!apiKey) throw new Error('مفيش مفتاح — حطه في صفحة الإعدادات');
  if (!anonKey || Date.now() - (anonAt || 0) > 24 * 60 * MIN) {
    const js = await (await fetch(CONFIG_JS, { cache: 'no-store' })).text();
    const m = /supabaseAnonKey\s*:\s*["']([^"']+)/.exec(js);
    if (!m) throw new Error('مقدرتش أقرا الـ anon key من config.js');
    anonKey = m[1]; await set({ anonKey, anonAt: Date.now() });
  }
  return { apiKey, anonKey };
}

async function api(path, body) {
  const { apiKey, anonKey } = await keys();
  const r = await fetch(API + path, { method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + anonKey, apikey: anonKey, 'x-api-key': apiKey } });
  let j = {}; try { j = await r.json(); } catch { /* */ }
  return { status: r.status, ...j };
}

// ───────── the extension's own pinned Khzama tab (re-created if closed) ─────────
async function kzTab() {
  const { tabId } = await get('tabId');
  if (tabId != null) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.pinned && (!t.url || t.url === 'about:blank' || t.url.includes('admin.molabi.sa'))) return t;
    } catch { /* closed */ }
  }
  const t = await chrome.tabs.create({ url: 'about:blank', pinned: true, active: false });
  await chrome.tabs.update(t.id, { autoDiscardable: false });
  await set({ tabId: t.id });
  return t;
}

function loaded(tabId) {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(to); chrome.tabs.onUpdated.removeListener(fn); resolve(); };
    const fn = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const to = setTimeout(done, 45e3);
    chrome.tabs.onUpdated.addListener(fn);
  });
}

// ───────── tab calls shared by the links and launch-tool workers (1.4.2) ─────────
// Chrome sometimes answers a tab create / navigation with «Navigation rejected.» (a tab that is closing, a tab parked by a tab
// suspender, another extension or a policy). Before 1.4.2 that one error stopped a whole batch, and two campaigns that opened
// their first tab in the same second hit it together. Now: (1) every tab create / navigation goes through ONE queue with
// TAB_GAP between calls, so two loops never navigate at the same instant; (2) a rejected navigation is retried on a FRESH tab
// that is loaded with the URL (never the old tab), with a growing pause, TAB_TRIES attempts in all; only when all of them fail
// is the error passed on. A tab belongs to ONE loop (its handle is only ever used by that loop) — the old tab of a retry is
// closed by the loop that owns it, never another one's. `own` = { set: the owner's Set of real tab ids, key: session key }.
const TAB_GAP = 300, TAB_TRIES = 4;
const TAB_REAL = new Map();                                  // a loop's stable tab handle → the tab id behind it now
const tabNow = (h) => (TAB_REAL.has(h) ? TAB_REAL.get(h) : h);
let tabQ = Promise.resolve(), tabLast = 0;
function tabSerial(fn) {
  const run = tabQ.then(async () => {
    const w = tabLast + TAB_GAP - Date.now();
    if (w > 0) await sleep(w);
    try { return await fn(); } finally { tabLast = Date.now(); }
  });
  tabQ = run.catch(() => {});
  return run;
}
// errors that a fresh tab / another try can cure (a tab that closed or was parked under us, a rejected navigation)
const tabTransient = (e) => !e || !e.final && /navigation rejected|no tab with id|tab was closed|tabs cannot be edited|cannot access|frame with id|is showing error page|rejected|discarded/i.test(String(e.message || e));
const tabPersist = async (own) => { try { await chrome.storage.session.set({ [own.key]: [...own.set] }); } catch { /* */ } };
async function tabCreate(own, url, tries) {
  let last = null;
  for (let k = 0; k < (tries || TAB_TRIES); k++) {
    if (k) await sleep(400 * k);
    try {
      const t = await tabSerial(() => chrome.tabs.create({ url: url || 'about:blank', pinned: false, active: false }));
      own.set.add(t.id);
      try { await chrome.tabs.update(t.id, { autoDiscardable: false }); } catch { /* the tab is already going away: the next step finds out */ }
      await tabPersist(own);
      return t;
    } catch (e) { last = e; }
  }
  if (tries === 1) throw last;                              // the caller's own loop is the retry
  const e = new Error('فتح تاب فشل ' + (tries || TAB_TRIES) + ' مرات: ' + String(last && last.message || last).slice(0, 120)); e.final = true; throw e;
}
async function tabClose(own, h) {
  if (h == null) return;
  const real = tabNow(h);
  own.set.delete(real); own.set.delete(h); TAB_REAL.delete(h);
  try { const t = await chrome.tabs.get(real); if (!t.pinned) await chrome.tabs.remove(real); } catch { /* already closed */ }
  await tabPersist(own);
}
// a tab that was just created with its URL: loaded when its status is complete (≤ 45 s) — the callers poll the page anyway
async function loadedNew(id) {
  for (let i = 0; i < 300; i++) {
    try { const t = await chrome.tabs.get(id); if (t.status === 'complete' && t.url && t.url !== 'about:blank') return; } catch { return; }
    await sleep(150);
  }
}
// load `url` in the loop's tab `h` and wait for it. The first try uses the tab itself; every retry opens a fresh tab with the URL
// and swaps it in behind the same handle (the old tab is closed). → the handle stays valid for the caller.
async function tabNavigate(own, h, url) {
  let last = null;
  for (let k = 0; k < TAB_TRIES; k++) {
    const real = tabNow(h);
    try {
      if (k === 0) {
        const wait = loaded(real);
        await tabSerial(async () => {
          const t = await chrome.tabs.get(real);
          if (t.url === url && !t.discarded) await chrome.tabs.reload(real); else await chrome.tabs.update(real, { url });
        });
        await wait;
        return;
      }
      await sleep(400 * k);
      const t = await tabCreate(own, url, 1);               // one try: this loop is the retry
      TAB_REAL.set(h, t.id);
      own.set.delete(real);
      try { const o = await chrome.tabs.get(real); if (!o.pinned) await chrome.tabs.remove(real); } catch { /* the old one is gone already */ }
      await tabPersist(own);
      await loadedNew(t.id);
      return;
    } catch (e) { last = e; }
  }
  const e = new Error('فتح الصفحة فشل ' + TAB_TRIES + ' مرات: ' + String(last && last.message || last).slice(0, 120)); e.final = true; throw e;
}

// one page: full reload, then poll the reader until the table shows the right day + page (≤ 40 s)
async function readPage(tabId, d, n) {
  const url = pageUrl(d, n), wait = loaded(tabId);
  const t = await chrome.tabs.get(tabId);
  if (t.url === url) await chrome.tabs.reload(tabId); else await chrome.tabs.update(tabId, { url });
  await wait;
  let last = 'not-ready';
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    let r;
    try { [{ result: r }] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: readKhzama }); } catch (e) { last = String(e.message || e); continue; }
    if (!r) continue;
    if (r.state === 'login') throw new LoginNeeded('login');
    last = r.state;
    if (r.state === 'ok' && r.from === d && r.urlPage === n && r.page === n && r.dates[0] === d && r.dates[1] === addDays(d, 1)) return r;
    if (r.state === 'ok') last = `الصفحة ${n} بتعرض ${r.dates.join('→') || '؟'} صفحة ${r.page}`;
  }
  throw new Error(`صفحة ${n} محمّلتش (${last})`);
}

// a whole day → [{link_id, title, donations, amount}] — only if every page validated
async function readDay(d) {
  const tab = await kzTab(), rows = [], sums = new Set();
  let pages = 1, total = 0;
  for (let n = 1; n <= pages; n++) {
    const r = await readPage(tab.id, d, n);
    if (n === 1) { total = r.total; pages = Math.ceil(total / 1000); if (!(total > 0) || pages > 10 || r.size !== 1000) throw new Error('عدد الروابط غريب: ' + total); }
    if (r.total !== total) throw new Error('عدد الروابط اتغير في نص السحبة');
    const want = n < pages ? 1000 : total - 1000 * (pages - 1);
    if (r.count !== want) throw new Error(`صفحة ${n}: ${r.count} صف بدل ${want}`);
    if (sums.has(r.idSum)) throw new Error(`صفحة ${n} مكررة`);
    sums.add(r.idSum);
    r.rows.forEach(([id, title, donations, amount]) => rows.push({ link_id: String(id), title: title ?? null, donations: Number(donations) || 0, amount: Number(amount) || 0 }));
  }
  return { rows, pages, total };
}

// ───────── the loop ─────────
async function tick(manual = false) {
  const s = await get(null), now = Date.now();
  if (!manual && s.enabled === false) return;
  if (!manual && s.paused === 'login' && now - (s.loginCheckAt || 0) < 10 * MIN) return;
  if (!manual && s.nextTryAt && now < s.nextTryAt) return;
  const { running } = await chrome.storage.session.get('running');
  if (running && now - running < 4 * MIN) return;
  await chrome.storage.session.set({ running: now });
  await set({ busy: now });
  try {
    await keys();
    const T = today(), Y = addDays(T, -1), mins = riyadh().getUTCHours() * 60 + riyadh().getUTCMinutes();
    const days = mins < 20 && s.finalDone !== Y ? [Y, T] : [T];          // 00:00–00:20 → final pass for yesterday too
    let pushedAt = 0;
    for (const d of days) {
      const { rows, pages } = await readDay(d);
      if (pushedAt) await sleep(Math.max(0, 31e3 - (Date.now() - pushedAt)));   // server: 1 push / 30 s
      const r = await api('/khzama/push', { date: d, complete: true, rows });
      pushedAt = Date.now();
      if (r.status === 429) continue;                                         // too soon — the next tick sends it
      if (!r.ok) throw new Error(r.error_ar || r.error_en || 'HTTP ' + r.status);
      if (d === Y) await set({ finalDone: Y });
      else await set({ last: { at: Date.now(), date: d, pages, stored: r.stored, deleted: r.deleted } });
    }
    await set({ fails: 0, nextTryAt: 0, paused: null, errorReported: false, loginReported: false, lastError: null });
  } catch (e) {
    if (e instanceof LoginNeeded) {
      await set({ paused: 'login', loginCheckAt: Date.now(), lastError: { at: Date.now(), msg: 'خزامى محتاج تسجيل دخول' } });
      if (!s.loginReported) { await api('/khzama/status', { state: 'login_required', detail: 'login page' }).catch(() => {}); await set({ loginReported: true }); }
    } else {
      const fails = (s.fails || 0) + 1, msg = String(e.message || e).slice(0, 250);
      await set({ fails, nextTryAt: Date.now() + Math.min(16, 2 ** fails - 2) * MIN, lastError: { at: Date.now(), msg } });   // 0, 2, 6, 14, 16 min
      if (fails >= 3 && !s.errorReported && !/مفيش مفتاح/.test(msg)) { await api('/khzama/status', { state: 'error', detail: msg }).catch(() => {}); await set({ errorReported: true }); }
    }
  } finally {
    await chrome.storage.session.set({ running: 0 });
    await set({ busy: 0 });
    await badge();
  }
}

async function badge() {
  const s = await get(['enabled', 'paused', 'fails', 'liveSrc', 'liveOn']);
  const lv = s.liveOn === false ? [] : Object.values(s.liveSrc || {}).filter((x) => x && !x.off);
  const liveLogin = lv.some((x) => x.login), liveFail = lv.some((x) => (x.fails || 0) >= 2);
  const [text, color] = s.enabled === false && s.liveOn === false ? ['off', '#888'] : s.paused === 'login' || liveLogin ? ['دخول', '#d93025'] : s.fails || liveFail ? ['!', '#e37400'] : ['', '#188038'];
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

async function ensureAlarm() {
  if (!(await chrome.alarms.get(ALARM))) chrome.alarms.create(ALARM, { periodInMinutes: 2, delayInMinutes: 0.2 });
}

chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); liveAlarm(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); liveAlarm(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) tick(); if (a.name === LIVE_ALARM) liveTick(false); });
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m?.cmd === 'run') { tick(true).then(() => reply({ ok: true })); return true; }
  if (m?.cmd === 'badge') { badge().then(() => reply({ ok: true })); return true; }
  if (m?.cmd === 'live-run') { liveTick(true).then(() => reply({ ok: true })); return true; }
});
ensureAlarm();
liveAlarm();
