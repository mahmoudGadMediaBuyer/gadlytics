// GADLYTICS · خزامى لحظي — «روابط الحملات»: registers the Khzama affiliate links of a campaign build.
// The build agent on the Mac submits the list (launch_status.py <id> khzama-links); this file takes ONE job at a time from the
// server (rpc kz_jobs, the extension's own khzama key), and in a SECOND Khzama tab of its own (never the pinned donations tab):
//   1. the campaign's links are loaded once (?keyword=<code>-&size=1000), then read from the page's own table → the exact
//      Parameters string already there? done, nothing is added
//   2. «إضافة» → fills العنوان + كلمة دلالية مخصصة, picks the advertiser whose name is EXACTLY the job's (TSW, never TSW-1)
//   3. checks the form's own values (react-hook-form) and the fields, «تكرار أضافة الرابط» off → «حفظ البيانات»
//   4. the table again (in place; a fresh load if it does not show it) → the link id → reports done
// Any unexpected page state (login page, a missing field, a form that does not match) stops the whole batch: the server marks
// what is left as failed and the agents register those by hand. It never edits or deletes a link, and only titles that start
// with a campaign code (XXX-12345-…) are accepted. No cookies, storage, tokens or headers are read.
const LINKS_V = '1.2.0';
const LINKS_RPC = 'https://ibpwudzjwjraqhfdmzet.supabase.co/rest/v1/rpc/kz_jobs';
const LINKS_ALARM = 'kz-links';
const LINK_TITLE_RE = /^[A-Z]{2,4}-\d{3,6}-[A-Za-z0-9_~-]+$/;
const LINK_ADVERTISERS = ['TSW'];
class LinksHalt extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

// null = may be added · otherwise the reason it is refused (the same rule is enforced again on the server and in the page step)
function linkGuard(job) {
  if (!job || typeof job.title !== 'string' || job.title.length > 300 || !LINK_TITLE_RE.test(job.title)) return 'العنوان مش بادئ بكود حملة';
  if (!LINK_ADVERTISERS.includes(job.advertiser)) return 'معلن غير مسموح: ' + job.advertiser;
  if (job.code && !job.title.startsWith(job.code + '-')) return 'العنوان مش تبع كود الحملة';
  return null;
}
const linkSame = (x, t) => typeof x === 'string' && x.trim().toLowerCase() === t.toLowerCase();
const linkHit = (r, title) => r.rows.find((x) => linkSame(x.title, title) || linkSame(x.key, title)) || null;

// ───────── runs INSIDE the Khzama page (world MAIN) — one short synchronous step per call, no timers, no network ─────────
function kzLinkStep(step, a) {
  a = a || {};
  if (document.querySelector('input[type=password]') || /login|signin|auth/i.test(location.pathname)) return { state: 'login' };
  const SAVE = 'حفظ البيانات', RE = /^[A-Z]{2,4}-\d{3,6}-[A-Za-z0-9_~-]+$/;
  const fiber = (el) => { const k = Object.keys(el).find((x) => x.startsWith('__reactFiber')); return k ? el[k] : null; };
  const dialog = () => [...document.querySelectorAll('[role=dialog]')].find((d) => getComputedStyle(d).display !== 'none' && (d.innerText || '').includes(SAVE)) || null;
  const parts = (d) => ({
    title: d.querySelector('input[name=title]'), key: d.querySelector('input[name=queryValue]'),
    select: d.querySelector('.react-select__input, input[role=combobox]'), advertiserId: d.querySelector('input[name=affiliateId]'),
    repeat: d.querySelector('input[type=checkbox]'), save: d.querySelector('button[type=submit]'), close: d.querySelector('button[aria-label="إغلاق"]'),
  });
  const setv = (el, v, blur) => {
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    s.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (blur) { el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); }   // the form reads the field on blur
  };
  // the form's own values (react-hook-form control._formValues), found from the component hooks above the field
  const formValues = (el) => {
    const look = (o) => { try { if (o && typeof o === 'object') { if ('_formValues' in o) return o; if (o.control && typeof o.control === 'object' && '_formValues' in o.control) return o.control; } } catch (e) { /* */ } return null; };
    let f = fiber(el), depth = 0;
    while (f && depth < 60) {
      let h = f.memoizedState, i = 0;
      while (h && typeof h === 'object' && 'next' in h && i < 200) {
        const s = h.memoizedState, c = look(s) || (s && typeof s === 'object' ? look(s.current) : null);
        if (c) return c._formValues;
        h = h.next; i++;
      }
      f = f.return; depth++;
    }
    return null;
  };
  const check = (d) => {
    const p = parts(d), why = [], single = [...d.querySelectorAll('.react-select__single-value')].map((e) => e.innerText.trim());
    if (!RE.test(a.title || '')) why.push('العنوان مش كود حملة');
    if (!p.title || p.title.value !== a.title) why.push('العنوان');
    if (!p.key || p.key.value !== a.title) why.push('الكلمة الدلالية');
    if (single.length !== 1 || single[0] !== a.advertiser) why.push('المعلن=' + (single.join('|') || 'فاضي'));
    if (!p.advertiserId || !/^\d+$/.test(p.advertiserId.value)) why.push('رقم المعلن');
    if (!p.repeat || p.repeat.checked) why.push('تكرار الرابط');
    if (!p.save) why.push('زرار الحفظ');
    const fv = p.title ? formValues(p.title) : null;
    if (!fv) why.push('قيم الفورم مش مقروءة');
    else {
      if (fv.title !== a.title) why.push('form.title');
      if (fv.queryValue !== a.title) why.push('form.queryValue');
      if (fv.affiliateId == null || String(fv.affiliateId) !== (p.advertiserId ? p.advertiserId.value : '')) why.push('form.affiliateId');
      if (fv.createCopies) why.push('form.createCopies');
      if (Number(fv.numberOfCopies) > 0) why.push('form.numberOfCopies');
    }
    return why;
  };

  if (step === 'read') {                                   // the rows the table already rendered for ?keyword=<title>
    const t = document.querySelector('table');
    if (!t) return { state: 'not-ready' };
    let f = fiber(t), i = 0;
    while (f && i < 80 && !(f.memoizedProps && Array.isArray(f.memoizedProps.data) && f.memoizedProps.columns)) { f = f.return; i++; }
    if (!f || i >= 80) return { state: 'not-ready' };
    const p = f.memoizedProps, pg = p.pagination || {};
    if (p.isLoading) return { state: 'loading' };
    return {
      state: 'ok', keyword: new URLSearchParams(location.search).get('keyword'), page: pg.page, size: pg.size, total: pg.rows,
      box: [...document.querySelectorAll('input[type=text]')].some((x) => x.value === a.title),            // the search box shows the keyword
      sum: p.data.some((r) => r && r.id === 'customRow'),                                                    // the «المجموع» row = the list arrived
      rows: p.data.filter((r) => r && r.id !== 'customRow' && typeof r.title === 'string').map((r) => ({ id: String(r.id), title: r.title, key: r.queryValue, adv: r.affiliateName })),
      dialog: !!dialog(),
    };
  }
  if (step === 'open') {
    if (dialog()) return { state: 'ok', already: true };
    const b = [...document.querySelectorAll('button')].filter((x) => (x.innerText || '').trim() === 'إضافة');
    if (b.length !== 1) return { state: 'no-add-button', n: b.length };
    b[0].click();
    return { state: 'ok' };
  }
  if (step === 'dialog') {
    const d = dialog();
    if (!d) return { state: 'ok', open: false };
    const p = parts(d);
    return { state: 'ok', open: true, missing: Object.keys(p).filter((k) => !p[k]),
      err: [...d.querySelectorAll('[class*=error],[class*=invalid],[role=alert],.text-red-500,.text-danger')].map((e) => (e.innerText || '').trim()).filter(Boolean).join(' · ').slice(0, 160) };
  }
  if (step === 'fill') {
    const d = dialog();
    if (!d) return { state: 'no-dialog' };
    if (!RE.test(a.title || '')) return { state: 'refused', why: 'العنوان مش كود حملة' };
    const p = parts(d), missing = Object.keys(p).filter((k) => !p[k]);
    if (missing.length) return { state: 'missing', why: missing.join(', ') };
    setv(p.title, a.title, true);
    setv(p.key, a.title, true);
    setv(p.select, a.advertiser, false);                 // typing in the advertiser list opens its options
    return { state: 'ok' };
  }
  if (step === 'pick') {                                    // the option whose text is EXACTLY the advertiser (TSW-1 is listed first)
    const d = dialog();
    if (!d) return { state: 'no-dialog' };
    const o = [...document.querySelectorAll('[role=option]')], texts = o.map((x) => (x.innerText || '').trim());
    if (!o.length) return { state: 'waiting' };
    const exact = o.filter((x, i) => texts[i] === a.advertiser);
    if (exact.length !== 1) return { state: 'no-option', options: texts.slice(0, 8) };
    exact[0].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    exact[0].click();
    return { state: 'ok' };
  }
  if (step === 'save') {                                    // the last check and the click happen in the same step
    const d = dialog();
    if (!d) return { state: 'no-dialog', why: 'النافذة مقفولة' };
    const why = check(d);
    if (why.length) return { state: 'mismatch', why: why.join(' · ') };
    if (a.stub === true) return { state: 'ok', clicked: false };          // test mode: everything but the save
    parts(d).save.click();
    return { state: 'ok', clicked: true };
  }
  if (step === 'cancel') {
    const d = dialog();
    if (!d) return { state: 'ok', open: false };
    const x = parts(d).close;
    if (x) x.click();
    return { state: 'ok', open: true, closed: !!x };
  }
  return { state: 'unknown-step' };
}

// ───────── service worker side ─────────
async function linksRpc(info) {
  const { apiKey, anonKey } = await keys();
  const s = await get(['linksOn', 'linksTest']);
  const r = await fetch(LINKS_RPC, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + anonKey, apikey: anonKey },
    body: JSON.stringify({ p_key: apiKey, p_info: { v: LINKS_V, cap: ['links'], on: s.linksOn !== false, test: s.linksTest === true, ...info } }) });
  let j = {}; try { j = await r.json(); } catch { /* */ }
  if (!r.ok || !j || j.ok !== true) throw new Error('السيرفر رفض (kz_jobs ' + r.status + ')');
  return j;
}

// the extension's SECOND Khzama tab: a normal background tab, never the pinned donations tab; closed when the batch ends
async function linksTab() {
  const { linksTabId, tabId } = await get(['linksTabId', 'tabId']);
  if (linksTabId != null && linksTabId !== tabId) {
    try {
      const t = await chrome.tabs.get(linksTabId);
      if (!t.pinned && (!t.url || t.url === 'about:blank' || t.url.includes('admin.molabi.sa'))) return t;
    } catch { /* closed */ }
  }
  const t = await chrome.tabs.create({ url: 'about:blank', pinned: false, active: false });
  if (t.id === tabId) throw new LinksHalt('tab', 'التبويب اتلخبط مع تبويب التبرعات');
  await chrome.tabs.update(t.id, { autoDiscardable: false });
  await set({ linksTabId: t.id });
  return t;
}
async function closeLinksTab() {
  const { linksTabId, tabId } = await get(['linksTabId', 'tabId']);
  if (linksTabId != null && linksTabId !== tabId) {
    try { const t = await chrome.tabs.get(linksTabId); if (!t.pinned) await chrome.tabs.remove(linksTabId); } catch { /* already closed */ }
  }
  await set({ linksTabId: null });
}

async function linkStep(tabId, step, a) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: kzLinkStep, args: [step, a || {}] });
  if (!result) throw new LinksHalt('no-result', 'صفحة خزامى مردّتش');
  if (result.state === 'login') throw new LinksHalt('login', 'خزامى محتاج تسجيل دخول');
  return result;
}

// a tab-suspender extension (or Chrome itself) may have parked the tab: its URL is then not Khzama's any more
async function linkAwake(tabId) {
  const t = await chrome.tabs.get(tabId);
  return !t.discarded && typeof t.url === 'string' && t.url.startsWith(KZ);
}

// full load of ?keyword=<kw>[&size=N], then two identical reads half a second apart of the right search (≤ 20 s).
// A tab that was suspended or discarded on the way is simply loaded again (twice at most).
async function linkFind(tabId, kw, size) {
  const url = KZ + '?keyword=' + encodeURIComponent(kw) + (size ? '&size=' + size : '');
  const go = async () => {
    const wait = loaded(tabId), t = await chrome.tabs.get(tabId);
    if (t.url === url && !t.discarded) await chrome.tabs.reload(tabId); else await chrome.tabs.update(tabId, { url });
    await wait;
  };
  await go();
  let prev = null, last = 'not-ready', woke = 0;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    let r;
    try { r = await linkStep(tabId, 'read', { title: kw }); } catch (e) {
      if (e instanceof LinksHalt) throw e;
      last = String(e.message || e); prev = null;
      if (woke < 2 && !(await linkAwake(tabId).catch(() => false))) { woke++; last = 'التاب اتعلّق (suspended) — بيتفتح تاني'; await go(); }
      continue;
    }
    last = r.state;
    if (r.state !== 'ok') { prev = null; continue; }
    if (r.keyword !== kw || !r.box || !r.sum || r.dialog) { last = 'الصفحة مش على البحث المطلوب'; prev = null; continue; }
    const sig = r.total + ':' + r.rows.map((x) => x.id).join(',');
    if (prev === sig) return r;
    prev = sig;
  }
  throw new LinksHalt('no-table', 'جدول خزامى محمّلش (' + last + ')');
}

// the campaign's links. One full load per batch (?keyword=<code>-&size=1000 lists them all on one page); after that the
// page's own table is read in place — the app refreshes it after every save — so a link costs no page load at all.
async function linkList(tabId, B, code, fresh) {
  const kw = code + '-';
  let r = null;
  if (!fresh && B.code === code && B.ok) {
    try { r = await linkStep(tabId, 'read', { title: kw }); } catch (e) { if (e instanceof LinksHalt) throw e; r = null; }
    if (r && !(r.state === 'ok' && r.keyword === kw && r.box && r.sum && !r.dialog && r.total === r.rows.length)) r = null;
  }
  if (!r) r = await linkFind(tabId, kw, 1000);
  B.code = code; B.ok = r.total === r.rows.length;
  return r;
}

// one link. → {state:'done', link_id, existed, note} · {state:'failed', error} · throws LinksHalt on an unexpected page
async function linkAdd(tabId, job, test, t0, B) {
  const title = job.title, adv = job.advertiser, byCode = !!(B && job.code), kw = byCode ? job.code + '-' : title;
  const look = async (fresh) => (byCode ? await linkList(tabId, B, job.code, fresh) : await linkFind(tabId, title));
  let r = await look(false), hit = linkHit(r, title);
  if (hit) return { state: 'done', link_id: hit.id, existed: true, note: hit.adv !== adv ? 'موجود قبل كده بمعلن ' + hit.adv : 'موجود قبل كده' };
  if (r.total > r.rows.length) return { state: 'failed', error: 'نتايج البحث أكتر من صفحة — اتأكد بإيدك' };
  const stop = async (code, msg) => { await linkStep(tabId, 'cancel').catch(() => {}); throw new LinksHalt(code, msg); };
  let d = null;
  for (let attempt = 0; ; attempt++) {
    r = await linkStep(tabId, 'open');
    if (r.state !== 'ok') throw new LinksHalt('no-add-button', 'زرار «إضافة» مش موجود');
    d = null;
    for (let i = 0; i < 20 && !(d && d.open); i++) { await sleep(250); d = await linkStep(tabId, 'dialog'); }
    if (!d || !d.open) throw new LinksHalt('no-dialog', 'نافذة الإضافة مفتحتش');
    if (d.missing.length) await stop('missing-field', 'ناقص في فورم خزامى: ' + d.missing.join(', '));
    r = await linkStep(tabId, 'fill', { title, advertiser: adv });
    if (r.state !== 'ok') await stop('fill', 'الفورم متملاش: ' + (r.why || r.state));
    let p = { state: 'waiting' };
    for (let i = 0; i < 32 && p.state === 'waiting'; i++) { await sleep(250); p = await linkStep(tabId, 'pick', { advertiser: adv }); }
    if (p.state !== 'ok') await stop('no-advertiser', 'المعلن ' + adv + ' مش في القائمة' + (p.options ? ' (' + p.options.join('، ') + ')' : ''));
    await sleep(300);
    if (Date.now() - t0 > 70e3) await stop('slow', 'الصفحة بطيئة — اتلغى قبل الحفظ');
    r = await linkStep(tabId, 'save', { title, advertiser: adv, stub: test === true });
    if (r.state === 'ok') break;
    // the form kept something from the link before (the page was not reloaded): once more on a freshly loaded page
    if (attempt === 0 && byCode) {
      await linkStep(tabId, 'cancel').catch(() => {});
      r = await look(true); hit = linkHit(r, title);
      if (hit) return { state: 'done', link_id: hit.id, existed: true, note: 'موجود قبل كده' };
      continue;
    }
    await stop('check', 'الفورم مش مطابق قبل الحفظ: ' + (r.why || r.state));
  }
  if (!r.clicked) {                                         // test mode: cancel instead of saving
    await linkStep(tabId, 'cancel');
    for (let i = 0; i < 12; i++) { await sleep(250); d = await linkStep(tabId, 'dialog'); if (!d.open) break; }
    if (d.open) throw new LinksHalt('cancel', 'النافذة مقفلتش بعد الإلغاء');
    return { state: 'done', existed: false, note: 'تجربة: اتملى واتراجع واتلغى من غير حفظ' };
  }
  let closed = false, err = '';
  for (let i = 0; i < 60 && !closed; i++) {                 // ≤ 15 s for the dialog to close
    await sleep(250);
    try { d = await linkStep(tabId, 'dialog'); } catch (e) { if (e instanceof LinksHalt) throw e; continue; }
    if (!d.open) closed = true; else err = d.err || err;
  }
  if (!closed) await linkStep(tabId, 'cancel').catch(() => {});
  // verify: the page's own table first (≈5 s), then a fresh load of the campaign list, then the exact-title search
  hit = null;
  for (let i = 0; byCode && closed && i < 12 && !hit; i++) {
    await sleep(400);
    try { r = await linkStep(tabId, 'read', { title: kw }); } catch (e) { if (e instanceof LinksHalt) throw e; continue; }
    if (r.state === 'ok' && r.keyword === kw) hit = linkHit(r, title);
  }
  if (!hit && byCode) { r = await look(true); hit = linkHit(r, title); }
  for (let i = 0; i < 2 && !hit; i++) {
    await sleep(1500);
    if (B) B.ok = false;                                    // the tab leaves the campaign list: the next link loads it again
    r = await linkFind(tabId, title); hit = linkHit(r, title);
  }
  if (!hit) return { state: 'failed', error: closed ? 'اتحفظ بس مش ظاهر في البحث — اتأكد بإيدك' : 'الحفظ ماتمّش: ' + (err || 'النافذة مقفلتش') };
  if (hit.adv !== adv) return { state: 'failed', link_id: hit.id, error: 'اتحفظ بمعلن ' + hit.adv + ' بدل ' + adv + ' (رابط ' + hit.id + ') — صلّحه بإيدك' };
  return { state: 'done', link_id: hit.id, existed: false };
}

// heartbeat + take jobs one after another until none is left. Any failure stops the batch (the server fails the rest).
async function linksTick() {
  const now = Date.now(), { linksRunning } = await chrome.storage.session.get('linksRunning');
  if (linksRunning && now - linksRunning < 150e3) return;
  await chrome.storage.session.set({ linksRunning: now });
  let tab = null, report = null, worked = false, lingered = false;
  const B = {};                                             // the campaign list already loaded in the links tab (linkList)
  try {
    for (;;) {
      await chrome.storage.session.set({ linksRunning: Date.now() });
      const s = await get(['linksOn', 'linksTest']), on = s.linksOn !== false, test = s.linksTest === true;
      const r = await linksRpc({ take: on && !(report && report.halt), report });
      const halted = !!(report && report.halt);
      report = null;
      await set({ linksSeen: Date.now(), linksPending: r.pending || 0, ...(r.batch ? { linksBatch: r.batch } : {}) });
      if (halted) break;
      const job = r.job;
      if (!job) {
        if (worked && !lingered) { lingered = true; await sleep(5000); continue; }      // a second campaign may submit right after
        break;
      }
      worked = true; lingered = false;
      const t0 = Date.now(), bad = linkGuard(job) || (!!job.test !== test ? 'وضع التجربة مش مطابق' : null);
      await set({ linksNow: { title: job.title, at: t0 } });
      if (bad) { report = { id: job.id, state: 'failed', error: bad }; continue; }
      try {
        tab = tab || await linksTab();
        report = { id: job.id, ...(await linkAdd(tab.id, job, test, t0, B)) };
        if (report.state !== 'done') report.halt = true;
        else await set({ linksError: null });
      } catch (e) {
        report = { id: job.id, state: 'failed', error: String(e.message || e).slice(0, 200), halt: true };
      }
      if (report.halt) await set({ linksError: { at: Date.now(), msg: report.error } });
    }
  } catch (e) {
    if (report) { try { await linksRpc({ take: false, report }); } catch { /* the server re-queues a silent job after 2 minutes */ } }
    await set({ linksError: { at: Date.now(), msg: String(e.message || e).slice(0, 200) } });
  } finally {
    if (tab) await closeLinksTab().catch(() => {});
    await set({ linksNow: null });
    await chrome.storage.session.set({ linksRunning: 0 });
  }
}

async function ensureLinksAlarm() {
  if (!(await chrome.alarms.get(LINKS_ALARM))) chrome.alarms.create(LINKS_ALARM, { periodInMinutes: 0.5, delayInMinutes: 0.1 });
}
chrome.runtime.onInstalled.addListener(ensureLinksAlarm);
chrome.runtime.onStartup.addListener(ensureLinksAlarm);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === LINKS_ALARM) linksTick(); });
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m?.cmd === 'links') { linksTick().then(() => reply({ ok: true })); return true; }
});
ensureLinksAlarm();
