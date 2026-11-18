// GADLYTICS · «تحديث تلقائي» (1.6.0, Nov 18 2026) — the 4th job of the extension, next to Khzama / links / launch tool.
// Every N minutes (5 / 15 / 30 / 60, popup) AND within a minute of the site's «تحديث الأرقام» / «حدّث كل حاجة», it opens
// in ONE pinned tab of its own (never the user's tabs) and READS WHAT THE PAGE ALREADY RENDERED — no platform API, no cookies,
// no storage, no headers, no request hooks — then sends it to the edge function live-push, which merges + rebuilds the numbers:
//   1. TikTok Ads Manager «Ad» tab (/i18n/manage/creative) — ديمان 7267941711098494977 + ملبي 7338783723795595266, today + yesterday:
//      the table's own React props (one row per ad group for Smart+) + the footer total, which must match the rows (else nothing is sent).
//   2. ديمان backend dashboard.dimaan.sa/admin/marketing/statistics — clicks the 4 day tabs (today + 3 back) and reads
//      «الطلبات» (عدد / إجمالي) and «العملاء الجدد» (عملاء جدد / إجمالي طلباتهم). Clicking a day tab only changes what is shown.
// Nothing is typed, nothing is saved on any platform. A login page → that source pauses, badge «دخول», one notification.
// AppsFlyer and Salla are NOT read here: AppsFlyer widgets only load while the tab is visible, and the Salla user has no orders/reports access.

const LIVE_API = 'https://ibpwudzjwjraqhfdmzet.supabase.co/functions/v1/live-push';
const LIVE_ALARM = 'live-tick';
const LIVE_SOURCES = [
  { id: 'tiktok_dm1n4an', ar: 'تيك توك ديمان', kind: 'tiktok', acc: '7267941711098494977' },
  { id: 'tiktok_3sa3k1k', ar: 'تيك توك ملبي', kind: 'tiktok', acc: '7338783723795595266' },
  { id: 'backend_dm1n4an', ar: 'الباك إند (ديمان)', kind: 'backend' },
];
const TT_URL = (acc, d) => `https://ads.tiktok.com/i18n/manage/creative?aadvid=${acc}&st=${d}&et=${d}`;
const BK_URL = 'https://dashboard.dimaan.sa/admin/marketing/statistics';

async function liveApi(path, body) {
  const { apiKey, anonKey } = await keys();
  const r = await fetch(LIVE_API + path, { method: 'POST', body: JSON.stringify(body || {}),
    headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + anonKey, apikey: anonKey, 'x-api-key': apiKey } });
  let j = {}; try { j = await r.json(); } catch { /* */ }
  return { status: r.status, ...j };
}

// ───────── page readers (chrome.scripting.executeScript, world MAIN) — they only read what is on screen ─────────
function readTikTokPage(acc, day) {
  if (/login|passport|signin/i.test(location.pathname) || document.querySelector('input[type=password]')) return { state: 'login' };
  const q = new URLSearchParams(location.search);
  if (!/\/manage\/creative/.test(location.pathname)) return { state: 'wrong-page', path: location.pathname };
  if (q.get('aadvid') !== acc || q.get('st') !== day || q.get('et') !== day) return { state: 'wrong-page', path: 'params' };
  // the table component: walk up from a rendered name cell to the props that hold dataSource + columns
  let p = null;
  const root = document.querySelector('[data-testid=campaign-list-main-table]');
  if (!root) return { state: 'not-ready' };
  // the table's own element carries the fiber (works in a hidden tab too, where no row cells are rendered)
  const cells = [root, ...[...root.querySelectorAll('*')].filter((e) => e.children.length === 0 && /\S/.test(e.textContent)).slice(0, 300)];
  for (const el of cells) {
    let n = el; while (n && !Object.keys(n).some((x) => x.startsWith('__reactFiber'))) n = n.parentElement;
    if (!n) continue;
    let f = n[Object.keys(n).find((x) => x.startsWith('__reactFiber'))];
    for (let j = 0; j < 60 && f; j++, f = f.return) { const mp = f.memoizedProps; if (mp && Array.isArray(mp.dataSource) && Array.isArray(mp.columns)) { p = mp; break; } }
    if (p) break;
  }
  // the footer «Total of N …  Spend 774.75 SAR … Impressions 62,693 … Clicks (destination) 337»
  const leaf = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^Total of \d/.test(e.textContent.trim()));
  if (!leaf) {
    if (/no data|no ads|لا توجد/i.test(document.body.innerText) && p && !p.dataSource.some((x) => x.ad_id)) return { state: 'ok', rows: [], total: { spend: 0 }, currency: null };
    // background (hidden) tab: TikTok renders no rows and no footer, but the table props hold the data.
    // Accept only when every row is loaded (estimatedCount == rows in hand) and every stat has arrived.
    if (p && !p.loading && document.visibilityState === 'hidden') {
      const n0 = (s) => Number(String(s ?? '').replace(/,/g, '')) || 0;
      const all0 = p.dataSource.filter((x) => x && x.ad_id && x.campaign_id);
      if (!all0.length || all0.some((x) => x.stat_cost === undefined)) return { state: 'not-ready' };
      if (typeof p.estimatedCount === 'number' && p.estimatedCount > p.dataSource.length) return { state: 'partial', path: p.dataSource.length + ' من ' + p.estimatedCount + ' صف' };
      // estimatedCount is only the loaded chunk (ملبي: 21 with 874 ads). When the chunk is full (≥ 20 ads), accept only if
      // its last 5 ads delivered nothing — the list puts delivering ads first, so a delivering tail means more may be below.
      if (all0.length >= 20 && all0.slice(-5).some((x) => n0(x.stat_cost) > 0 || n0(x.show_cnt) > 0)) return { state: 'partial', path: 'آخر الصفوف المحمّلة فيها صرف' };
      const rows0 = all0.filter((x) => n0(x.stat_cost) > 0 || n0(x.show_cnt) > 0).map((x) => ({
        adgroup_id: String(x.ad_id), adgroup_name: x.ad_name ?? null, ad_name: x.creative_name ?? null,
        campaign_id: String(x.campaign_id), campaign_name: x.campaign_name ?? null,
        spend: n0(x.stat_cost), impressions: n0(x.show_cnt), clicks: n0(x.click_cnt) }));
      const t0 = rows0.reduce((a, r) => ({ spend: +(a.spend + r.spend).toFixed(2), impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks }), { spend: 0, impressions: 0, clicks: 0 });
      const cur = (all0.find((x) => x.currency) || {}).currency || 'SAR';
      return { state: 'ok', currency: cur, total: t0, rows: rows0, count: all0.length, hidden: true };
    }
    return { state: 'not-ready' };
  }
  let box = leaf; for (let i = 0; i < 15 && box && !/Spend\s+[\d,.]+\s+[A-Z]{3}/.test(box.innerText); i++) box = box.parentElement;
  if (!box) return { state: 'not-ready' };
  const ft = box.innerText.replace(/\s+/g, ' ');
  const sm = /Spend ([\d,.]+) ([A-Z]{3})/.exec(ft), im = /Impressions ([\d,.]+)/.exec(ft), cm = /Clicks(?: \(destination\))? ([\d,.]+)/.exec(ft);
  if (!sm || !p || p.loading) return { state: 'not-ready' };
  const n = (s) => Number(String(s ?? '').replace(/,/g, '')) || 0;
  const all = p.dataSource.filter((x) => x && x.ad_id && x.campaign_id);
  if (all.some((x) => x.stat_cost === undefined)) return { state: 'not-ready' };       // stats still loading
  const rows = all.filter((x) => n(x.stat_cost) > 0 || n(x.show_cnt) > 0).map((x) => ({
    adgroup_id: String(x.ad_id), adgroup_name: x.ad_name ?? null, ad_name: x.creative_name ?? null,
    campaign_id: String(x.campaign_id), campaign_name: x.campaign_name ?? null,
    spend: n(x.stat_cost), impressions: n(x.show_cnt), clicks: n(x.click_cnt) }));
  const total = { spend: n(sm[1]), impressions: n(im && im[1]), clicks: n(cm && cm[1]) }, sum = rows.reduce((a, r) => a + r.spend, 0);
  // the table loads its rows in chunks: when the spending ads are not all in the loaded chunk, the footer total is bigger → don't send
  if (Math.abs(total.spend - sum) > 0.05 + total.spend * 0.001) return { state: 'partial', path: sum.toFixed(2) + ' من ' + total.spend.toFixed(2) };
  return { state: 'ok', currency: sm[2], total, rows, count: all.length };
}

// clicks each day tab (today + 3 back) and reads the two cards; a value is accepted only when two reads 700 ms apart agree
async function readBackendPage() {
  if (/login|signin/i.test(location.pathname) || document.querySelector('input[type=password]')) return { state: 'login' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tabs = () => [...document.querySelectorAll('[role=tab]')].filter((e) => /\d{1,2}\/\d{1,2}/.test(e.innerText));
  if (tabs().length < 1) return { state: 'not-ready' };
  const num = (s) => Number(String(s).replace(/[,\s]/g, '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const grab = () => {
    const t = (document.querySelector('main') || document.body).innerText;
    const pick = (re) => { const m = re.exec(t); return m ? num(m[1]) : NaN; };
    return { orders: pick(/عدد الطلبات\s*\n\s*([\d,٠-٩]+)/), revenue: pick(/إجمالي الطلبات\s*\n\s*([\d,.٠-٩]+)/),
      new_customers: pick(/عملاء جدد\s*\n\s*([\d,٠-٩]+)/), new_customer_revenue: pick(/إجمالي طلباتهم\s*\n\s*([\d,.٠-٩]+)/) };
  };
  const out = [];
  const year = new Date(Date.now() + 3 * 3600e3).getUTCFullYear(), month = new Date(Date.now() + 3 * 3600e3).getUTCMonth() + 1;
  for (let i = 0; i < Math.min(4, tabs().length); i++) {
    const b = tabs()[i], m = /(\d{1,2})\/(\d{1,2})/.exec(b.innerText);
    const dd = +m[1], mm = +m[2], yy = mm > month ? year - 1 : year;                    // 31/12 seen on 2 Jan → last year
    const date = `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    if (b.getAttribute('aria-selected') !== 'true') b.click();
    let ok = null;
    for (let k = 0; k < 20 && !ok; k++) {
      await sleep(500);
      if (tabs()[i].getAttribute('aria-selected') !== 'true') continue;
      const a = grab(); await sleep(700); const c = grab();
      if (Object.values(a).every((v) => isFinite(v)) && JSON.stringify(a) === JSON.stringify(c)) ok = a;
    }
    if (!ok) return { state: 'not-ready', at: date };
    out.push({ date, ...ok });
  }
  if (tabs()[0].getAttribute('aria-selected') !== 'true') tabs()[0].click();          // leave it on «اليوم»
  return { state: 'ok', days: out };
}

// ───────── the tab + the loop ─────────
async function liveTab() {
  const { liveTabId } = await get('liveTabId');
  if (liveTabId != null) {
    try { const t = await chrome.tabs.get(liveTabId); if (t.pinned) return t; } catch { /* closed */ }
  }
  const t = await chrome.tabs.create({ url: 'about:blank', pinned: true, active: false });
  try { await chrome.tabs.update(t.id, { autoDiscardable: false }); } catch { /* */ }
  await set({ liveTabId: t.id });
  return t;
}
async function liveOpen(url) {
  const t = await liveTab(), wait = loaded(t.id);
  // a tab parked by a tab suspender (Tiny Suspender etc.) or discarded by Chrome is simply loaded again with our URL
  await chrome.tabs.update(t.id, { url });
  await wait;
  return t.id;
}
async function liveRead(tabId, func, args, tries = 25) {
  let last = 'not-ready';
  for (let i = 0; i < tries; i++) {
    await sleep(2000);
    let r;
    try { [{ result: r }] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args: args || [] }); } catch (e) { last = String(e.message || e); continue; }
    if (!r) continue;
    if (r.state === 'login') throw new LoginNeeded('login');
    if (r.state === 'ok') return r;
    last = r.state + (r.path ? ' ' + r.path : '');
  }
  if (/^partial/.test(last)) throw new Error('الإعلانات اللي بتصرف مش كلها ظاهرة في أول جزء من الجدول (' + last.replace('partial ', '') + ') — مفيش حاجة اتبعتت');
  throw new Error('الصفحة محمّلتش (' + last + ')');
}

async function liveSource(src, T, Y) {
  if (src.kind === 'tiktok') {
    const out = [];
    for (const d of [T, Y]) {
      const tabId = await liveOpen(TT_URL(src.acc, d));
      const r = await liveRead(tabId, readTikTokPage, [src.acc, d]);
      const res = await liveApi('/tiktok', { account_id: src.acc, date: d, currency: r.currency, total: r.total, rows: r.rows });
      if (res.status === 429) { out.push(d + ': بدري'); continue; }
      if (!res.ok) throw new Error((res.error_ar || 'HTTP ' + res.status) + ' (' + d + ')');
      out.push({ date: d, spend: r.total.spend });
    }
    return out;
  }
  const tabId = await liveOpen(BK_URL);
  const r = await liveRead(tabId, readBackendPage, [], 20);
  const res = await liveApi('/backend', { days: r.days });
  if (res.status === 429) return ['بدري'];
  if (!res.ok) throw new Error(res.error_ar || 'HTTP ' + res.status);
  return r.days;
}

async function liveRun(reason, reqAt) {
  const { liveRunning } = await chrome.storage.session.get('liveRunning');
  if (liveRunning && Date.now() - liveRunning < 6 * MIN) return;
  await chrome.storage.session.set({ liveRunning: Date.now() });
  const s = await get(['liveSrc', 'liveInterval', 'liveOn']);
  const st = { ...(s.liveSrc || {}) }, T = today(), Y = addDays(T, -1), summary = {};
  await set({ liveBusy: Date.now() });
  try {
    await keys();
    for (const src of LIVE_SOURCES) {
      const cur = st[src.id] || {};
      if (cur.off) continue;                                                          // turned off in the popup
      if (cur.login && reason === 'timer' && Date.now() - (cur.loginAt || 0) < 15 * MIN) continue;
      if ((cur.fails || 0) >= 5 && reason === 'timer' && Date.now() - (cur.errAt || 0) < 60 * MIN) continue;   // keeps failing → once an hour
      try {
        const r = await liveSource(src, T, Y);
        st[src.id] = { ...cur, okAt: Date.now(), err: null, login: false, fails: 0, last: r };
        summary[src.id] = 'ok';
        if (cur.login || (cur.fails || 0) >= 3) await liveApi('/status', { source: src.id, state: 'ok' }).catch(() => {});
      } catch (e) {
        if (e instanceof LoginNeeded) {
          st[src.id] = { ...cur, login: true, loginAt: Date.now(), err: 'محتاج تسجيل دخول' };
          summary[src.id] = 'login';
          if (!cur.login) await liveApi('/status', { source: src.id, state: 'login_required', detail: 'login page' }).catch(() => {});
        } else {
          const fails = (cur.fails || 0) + 1, msg = String(e.message || e).slice(0, 220);
          st[src.id] = { ...cur, fails, err: msg, errAt: Date.now() };
          summary[src.id] = 'error';
          if (fails === 3) await liveApi('/status', { source: src.id, state: 'error', detail: msg }).catch(() => {});
        }
      }
      await set({ liveSrc: st });
    }
    await liveApi('/done', { req_at: reqAt || 0, summary, interval_min: s.liveInterval || 5, enabled: s.liveOn !== false }).catch(() => {});
    await set({ liveLast: { at: Date.now(), reason, summary } });
  } catch (e) {
    await set({ liveLast: { at: Date.now(), reason, error: String(e.message || e).slice(0, 200) } });
  } finally {
    // park the tab on a blank page so it uses no memory between runs
    try { const { liveTabId } = await get('liveTabId'); if (liveTabId != null) await chrome.tabs.update(liveTabId, { url: 'about:blank' }); } catch { /* */ }
    await chrome.storage.session.set({ liveRunning: 0 });
    await set({ liveBusy: 0 });
    await badge();
  }
}

// every minute: is a run due (interval) or did the site ask for one (sys/campreq / sys/pullreq newer than what we saw)?
async function liveTick(force) {
  const s = await get(['liveOn', 'liveInterval', 'liveLast', 'liveReqSeen', 'apiKey']);
  if (!s.apiKey) return;
  let req = null;
  try { req = await liveApi('/req'); } catch { /* offline: the timer still decides */ }
  const seen = s.liveReqSeen || 0;
  const asked = req && req.ok ? [req.campreq, req.pullreq].filter((x) => x && x.at > seen && Date.now() - x.at < 30 * MIN) : [];
  if (asked.length) {
    const newest = Math.max(...asked.map((x) => x.at));
    await set({ liveReqSeen: newest });
    const camp = req.campreq && req.campreq.at === newest && req.campreq.status === 'pending' ? req.campreq.at : 0;
    if (s.liveOn !== false || force) return liveRun('site', camp);
  }
  if (s.liveOn === false && !force) return;
  const every = (s.liveInterval || 5) * MIN;
  if (force || !s.liveLast || Date.now() - s.liveLast.at >= every - 20e3) return liveRun(force ? 'manual' : 'timer', 0);
}

async function liveAlarm() {
  if (!(await chrome.alarms.get(LIVE_ALARM))) chrome.alarms.create(LIVE_ALARM, { periodInMinutes: 1, delayInMinutes: 0.5 });
}
