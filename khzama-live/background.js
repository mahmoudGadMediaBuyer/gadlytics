// GADLYTICS · خزامى لحظي — every 2 minutes: load today's Khzama links (pages 1..3, full reload each), read the rows the page
// already rendered (reader.js, world MAIN), and POST them to gad-api /khzama/push as a complete snapshot of the day.
// Never touches Khzama cookies, storage, tokens or headers. Never types anything into Khzama.
importScripts('reader.js');

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
  const s = await get(['enabled', 'paused', 'fails']);
  const [text, color] = s.enabled === false ? ['off', '#888'] : s.paused === 'login' ? ['دخول', '#d93025'] : s.fails ? ['!', '#e37400'] : ['', '#188038'];
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

async function ensureAlarm() {
  if (!(await chrome.alarms.get(ALARM))) chrome.alarms.create(ALARM, { periodInMinutes: 2, delayInMinutes: 0.2 });
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) tick(); });
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m?.cmd === 'run') { tick(true).then(() => reply({ ok: true })); return true; }
  if (m?.cmd === 'badge') { badge().then(() => reply({ ok: true })); return true; }
});
ensureAlarm();
