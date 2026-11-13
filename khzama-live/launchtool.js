// GADLYTICS · خزامى لحظي — «أداة الإطلاق»: runs the Tamkeen launch tool (launch.tamkeen-agency.com) for a campaign build.
// The build agent on the Mac submits the inputs ONCE (launch_status.py <id> tool-launch); the server keeps one job per ad set
// (Custom). Campaigns run side by side (up to LT_MAX_PARALLEL, one tab each); inside a campaign the launches go one after the
// other (New, then Select …). Each job (rpc tl_jobs, the extension's own khzama key) runs in a fresh tab of this worker's own
// (never the pinned donations tab, a Khzama links tab, or a tab the user or an agent opened; closed when the campaign ends):
//   1. Select launches: reads the campaign's own list first — an ad set that is already there is adopted, never launched twice
//   2. loads /launch, opens the right tab (Single / Bulk / Smart) and fills the form with fixed code: native value setters +
//      input/change events (the selects are Radix selects with a hidden native <select>; the country is a popover list)
//   3. reads back that the app registered every field (Radix select state, field values, «N IDs detected», the Launch button)
//   4. asks the server «may I press Launch?» — for the FIRST launch (Campaign = New) that is the campaign-number lock, held
//      only from this moment until the number is read on the result page (seconds); everything else needs no lock
//   5. one page step re-checks every field and presses Launch
//   6. waits for the result page, reads every result (the page's own data, not the truncated text) and compares it with the
//      inputs with === : Creative IDs, count, Custom, platform, objective, country, client, campaign
//   7. reports campaign number + name, ad names, Parameters and UTM URLs
// A submit is NEVER repeated: if the tool does not answer, the tool's History decides. Anything unexpected (login page, a
// changed form, a field that does not read back, a result that does not match) stops the batch and the agents take over by
// hand. ملبي only. It never deletes anything, and reads no cookies, storage, tokens or headers.
const LT_V = '1.4.1';
const LT_RPC = 'https://ibpwudzjwjraqhfdmzet.supabase.co/rest/v1/rpc/tl_jobs';
const LT_ALARM = 'lt-tick';
const LT_ORIGIN = 'https://launch.tamkeen-agency.com';
const LT_FORM = LT_ORIGIN + '/launch';
const LT_MAX_PARALLEL = 4;                                   // campaigns launched at the same time — one tab each; inside a campaign one launch at a time
const LT_TABS = new Set();                                   // the tabs this worker opened and has not closed yet
const LT_KINDS = ['Single', 'Bulk', 'Smart'];
const LT_PLATFORMS = { ME: 'meta', TT: 'tiktok', SC: 'snapchat' };
const LT_CODE_RE = /^[A-Z]{2,4}-\d{3,6}$/;
const LT_PARAM_RE = /^[A-Z]{2,4}-\d{3,6}-[A-Za-z0-9_~-]+$/;
let LT_STUB_IN_TEST = true;                                  // «وضع تجربة»: fills and checks, never presses Launch
let LT_GAP = 1;                                              // waits × this (the tests shorten them)
// scope 'all' = the tool itself looks wrong → every waiting launch goes to the agents · 'launch' = only this campaign
class LtHalt extends Error { constructor(code, msg, scope, partial) { super(msg || code); this.code = code; this.scope = scope || 'all'; this.partial = partial || null; } }
const ltSleep = (ms) => sleep(Math.max(1, Math.round(ms * LT_GAP)));

// null = may be launched · otherwise the reason it is refused (the server checked the same rules when the inputs were submitted)
function ltGuard(job) {
  if (!job || typeof job !== 'object') return 'مفيش بيانات';
  if (!LT_KINDS.includes(job.kind)) return 'نوع الإطلاق غلط';
  if (job.client !== 'Molabi') return 'العميل مش ملبي';
  if (!Array.isArray(job.ids) || !job.ids.length || job.ids.length > 50 || job.ids.some((x) => typeof x !== 'string' || !/^\d{14}$/.test(x)) || new Set(job.ids).size !== job.ids.length) return 'Creative IDs غلط';
  if ((job.kind === 'Single' && job.ids.length !== 1) || (job.kind === 'Smart' && job.ids.length > 10)) return 'عدد الـ Creative IDs مش مناسب للنوع';
  if (!LT_PLATFORMS[job.platform] || String(job.platform_name || '').toLowerCase() !== LT_PLATFORMS[job.platform]) return 'المنصة غلط';
  if (!/^[A-Z]{3,5}$/.test(job.objective || '') || !job.objective_name) return 'الهدف غلط';
  if (!/^[A-Z]{2}$/.test(job.country || '')) return 'الدولة غلط';
  if (typeof job.custom !== 'string' || !/^[A-Za-z0-9_]{0,40}$/.test(job.custom)) return 'الـ Custom غلط';
  if (typeof job.link !== 'string' || !/^https:\/\/\S+$/.test(job.link)) return 'Product Link غلط';
  if (job.mode !== 'New' && job.mode !== 'Select') return 'Campaign لازم New أو Select';
  if (job.mode === 'Select' && !/^\d{3,6}$/.test(job.campaign || '')) return 'رقم الحملة لـ Select غلط';
  if (job.mode === 'New' && job.campaign) return 'New مع رقم حملة';
  if (job.code && (!LT_CODE_RE.test(job.code) || !job.code.endsWith('-' + job.campaign))) return 'كود الحملة مش مطابق للرقم';
  return null;
}
// the Custom of an ad name: «… | AS:Riyadh» → 'Riyadh' · no AS part → '' · two AS parts → null
function ltCustomOf(adName) {
  const as = String(adName || '').split(' | ').filter((s) => s.startsWith('AS:'));
  return as.length === 1 ? as[0].slice(3) : as.length === 0 ? '' : null;
}
const ltSameIds = (joined, ids) => String(joined || '').split('~').slice().sort().join(',') === ids.slice().sort().join(',');
// which of the job's creatives a listed ad belongs to: the Creative ID itself, or (Smart) the whole set joined with ~
const ltMine = (job, creative, adName) => ltCustomOf(adName) === job.custom && (job.kind === 'Smart' ? ltSameIds(creative, job.ids) : job.ids.includes(creative));

// every reason a result does not match the inputs ([] = it matches). Strict === on each part.
function ltValid(job, d, id) {
  const why = [];
  if (!d || typeof d !== 'object') return ['مفيش بيانات'];
  const s = (k) => (typeof d[k] === 'string' ? d[k] : '');
  const seg = s('campaign_name').split(' | '), code = seg[0], ad = s('ad_name').split(' | ');
  if (d.id !== id) why.push('id');
  if (!/^\d{3,6}$/.test(s('campaign_num'))) why.push('campaign_num');
  if (!LT_CODE_RE.test(code) || !code.endsWith('-' + s('campaign_num'))) why.push('campaign code');
  if (job.mode === 'Select' && s('campaign_num') !== job.campaign) why.push('campaign=' + s('campaign_num'));
  if (job.mode === 'Select' && job.code && code !== job.code) why.push('code=' + code);
  if (!seg.includes('CL:' + job.client) || d.client_name_en !== job.client) why.push('client');
  if (!seg.includes('OB:' + job.objective_name)) why.push('objective');
  if (!seg.includes('GE:' + job.country)) why.push('country');
  if (d.platform_code !== job.platform) why.push('platform=' + d.platform_code);
  if (job.kind === 'Smart' ? !ltSameIds(s('creative_id'), job.ids) : !job.ids.includes(s('creative_id'))) why.push('creative=' + s('creative_id').slice(0, 40));
  if (ad[0] !== 'ID:' + s('creative_id')) why.push('ad name');
  if (ltCustomOf(s('ad_name')) !== job.custom) why.push('custom=' + ltCustomOf(s('ad_name')));
  if ((job.kind === 'Smart') !== ad.includes('Smart:ON')) why.push('smart');
  const p = s('parameters');
  if (!LT_PARAM_RE.test(p) || !p.startsWith(code + '-') || !p.includes('-' + s('creative_id') + '-' + job.platform + '-')) why.push('parameters');
  if (job.custom && !p.startsWith(code + '-' + job.custom + '-')) why.push('parameters custom');
  try {
    const u = new URL(s('utm_url'));
    if (u.protocol !== 'https:' || u.searchParams.get('affiliate') !== p) why.push('utm affiliate');
    if (u.searchParams.get('utm_id') !== s('campaign_num')) why.push('utm_id');
  } catch { why.push('utm url'); }
  if (d.rowsOk !== true) why.push('الصفحة بتعرض قيم غير البيانات (' + String(d.labels || '').slice(0, 60) + ')');
  return why;
}
const ltAd = (d) => ({ creative_id: d.creative_id, ad_name: d.ad_name, parameters: d.parameters, utm_url: d.utm_url, product_link: d.product_link, result_id: d.id });

// ───────── runs INSIDE the launch tool page (world MAIN) — one short synchronous step per call, no timers, no network ─────────
function ltStep(step, a) {
  a = a || {};
  if (location.hostname !== 'launch.tamkeen-agency.com') return { state: 'wrong-host' };
  const path = location.pathname;
  if (document.querySelector('input[type=password]') || /^\/(login|signin|sign-in|auth)(\/|$)/i.test(path)) return { state: 'login' };
  const KINDS = { Single: { key: 'single', tab: 'Single Ad', ids: 'single_creative' }, Bulk: { key: 'bulk', tab: 'Bulk Ads', ids: 'bulk_ids' }, Smart: { key: 'smart', tab: 'Smart Ad', ids: 'smart_ids' } };
  const txt = (e) => ((e && e.textContent) || '').replace(/\s+/g, ' ').trim();
  // the CURRENT fiber of a DOM node: the pointer React leaves on the node may be the stale twin (one commit behind), so the
  // twin whose props are the ones the node shows now is taken; `up` climbs to the parent that really holds this child
  const fiber = (el) => {
    const ks = el ? Object.keys(el) : [], fk = ks.find((x) => x.startsWith('__reactFiber')), pk = ks.find((x) => x.startsWith('__reactProps'));
    const f = fk ? el[fk] : null, props = pk ? el[pk] : undefined;
    return f && f.alternate && props !== undefined && f.memoizedProps !== props && f.alternate.memoizedProps === props ? f.alternate : f;
  };
  const up = (f) => {
    const p = f.return;
    if (!p || !p.alternate) return p;
    const has = (q) => { for (let c = q.child; c; c = c.sibling) if (c === f) return true; return false; };
    return has(p) ? p : has(p.alternate) ? p.alternate : p;
  };
  const press = (el) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));   // Radix tabs switch on mousedown
  const setv = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  };
  // the Radix select's own state (its context value), found above the trigger button
  const selCtx = (btn) => {
    let f = fiber(btn), i = 0;
    while (f && i < 40) { const v = f.memoizedProps && f.memoizedProps.value; if (v && typeof v === 'object' && 'onValueChange' in v && 'value' in v && 'open' in v) return v; f = up(f); i++; }
    return null;
  };
  const resId = (/^\/launch\/result\/([0-9a-f]{8}-[0-9a-f-]{27})$/.exec(path) || [])[1] || null;
  const tabOf = (key) => [...document.querySelectorAll('[role=tab]')].find((t) => t.id.endsWith('-trigger-' + key)) || null;
  const toasts = () => [...document.querySelectorAll('[data-sonner-toast]')].map(txt).filter(Boolean).slice(0, 6);

  // ── the launch form ──
  const formOf = (kind) => {
    const K = KINDS[kind], forms = document.querySelectorAll('form');
    if (!K || forms.length !== 1) return null;
    const form = forms[0], ids = form.querySelector('#' + K.ids);
    if (!ids) return null;
    const field = (name) => {
      const lab = [...form.querySelectorAll('label')].find((l) => txt(l).replace(/\s*\*$/, '') === name);
      const box = lab && lab.parentElement;
      return box ? { btn: box.querySelector('button[role=combobox]'), sel: box.querySelector('select') } : null;
    };
    const subs = [...form.querySelectorAll('button[type=submit]')];
    return { K, form, ids, mode: field('Campaign ID'), platform: field('Platform'), objective: field('Objective'), country: field('Country'), campaign: field('Existing campaign'),
      custom: form.querySelector('#' + K.key + '_adset'), link: form.querySelector('#' + K.key + '_link'), subs };
  };
  const rs = (F, withOpts) => {
    if (!F || !F.btn) return null;
    const c = selCtx(F.btn), o = F.sel ? [...F.sel.options] : [], v = c && c.value != null ? String(c.value) : '', cur = o.find((x) => x.value === v);
    return { v, text: txt(F.btn), dis: !!F.btn.disabled, n: o.length, cur: cur ? txt(cur) : null, ctx: !!c, dom: F.sel ? F.sel.value : null, opts: withOpts ? o.map((x) => [x.value, txt(x)]) : undefined };
  };
  const popOf = (btn) => { const p = btn && document.getElementById(btn.getAttribute('aria-controls') || '-'); return p && p.getAttribute('data-state') === 'open' ? p : null; };
  const snap = (kind) => {
    const P = formOf(kind);
    if (!P) return null;
    const cb = P.country && P.country.btn, ct = txt(cb), pop = popOf(cb), al = P.form.querySelector('[role=alert], [class*="border-amber-500"]');
    const camp = rs(P.campaign), wanted = a.campaign && P.campaign && P.campaign.sel ? [...P.campaign.sel.options].find((x) => x.value === a.campaign) : null;
    const det = /(\d+) IDs? detected/.exec(P.form.innerText || '');
    return { ids: P.ids.value, detected: det ? Number(det[1]) : null, mode: rs(P.mode, true), platform: rs(P.platform, true), objective: rs(P.objective, true),
      country: cb ? { text: ct, code: (/\(([A-Z]{2})\)$/.exec(ct) || [])[1] || null, dis: !!cb.disabled, open: !!pop, items: pop ? pop.querySelectorAll('[cmdk-item]').length : 0 } : null,
      campaign: camp ? { ...camp, has: !!wanted, hasText: wanted ? txt(wanted) : null } : null,
      custom: P.custom ? P.custom.value : null, link: P.link ? P.link.value : null,
      submit: { n: P.subs.length, text: P.subs[0] ? txt(P.subs[0]) : '', dis: P.subs[0] ? !!P.subs[0].disabled : true },
      busy: !!(P.subs[0] && /^Launching/i.test(txt(P.subs[0]))), alert: al ? txt(al).slice(0, 300) : '' };
  };
  // every reason the form is not exactly what the job asks for ([] = it is)
  const check = (kind) => {
    const s = snap(kind), why = [];
    if (!s) return ['الفورم مش مفتوح'];
    const idsText = kind === 'Single' ? a.ids[0] : a.ids.join('\n');
    if (s.ids !== idsText) why.push('Creative IDs');
    if (kind !== 'Single' && s.detected !== a.ids.length) why.push('IDs detected=' + s.detected);
    // the select's state must also be what the page itself shows: the hidden <select> value and the text on the button
    const shown = (F) => !!F && F.dom === F.v && F.text === F.cur;
    if (!s.mode || !s.mode.ctx || s.mode.v !== a.mode || s.mode.text !== a.mode || !shown(s.mode)) why.push('Campaign ID=' + (s.mode ? s.mode.v : '؟'));
    if (a.mode === 'Select') {
      const c = s.campaign;
      if (!c || !c.ctx || c.v !== a.campaign || !shown(c)) why.push('Existing campaign=' + (c ? c.v : 'مش ظاهر'));
      else if (!c.cur || c.text !== c.cur || !(a.code ? c.cur.startsWith(a.code + ' ') : new RegExp('^[A-Z]{2,4}-' + a.campaign + ' ').test(c.cur))) why.push('اسم الحملة المختارة=' + (c.cur || '').slice(0, 30));
    } else if (s.campaign) why.push('Existing campaign ظاهر مع New');
    if (!s.platform || !s.platform.ctx || s.platform.v !== a.platform || !shown(s.platform) || String(s.platform.cur || '').toLowerCase() !== String(a.platform_name).toLowerCase()) why.push('Platform=' + (s.platform ? s.platform.v : '؟'));
    if (!s.objective || !s.objective.ctx || s.objective.v !== a.objective || !shown(s.objective) || s.objective.cur !== a.objective_name) why.push('Objective=' + (s.objective ? s.objective.v : '؟'));
    if (!s.country || s.country.code !== a.country) why.push('Country=' + (s.country ? s.country.code : '؟'));
    if (s.custom !== a.custom) why.push('Custom=' + s.custom);
    if (s.link !== a.link) why.push('Product Link');
    if (s.submit.n !== 1 || s.submit.dis || s.busy) why.push('زرار Launch');
    if (s.alert) why.push('رسالة في الفورم: ' + s.alert.slice(0, 80));
    return why;
  };

  if (step === 'read') {                                    // where the tab is + (on /launch) what the form holds
    if (resId) return { state: 'ok', page: 'result', id: resId, toasts: toasts() };
    if (path !== '/launch') return { state: 'ok', page: 'other', path: path.slice(0, 60) };
    const K = KINDS[a.kind], tabs = document.querySelectorAll('[role=tab]');
    if (!K) return { state: 'changed', why: 'kind' };
    if (!tabs.length) return { state: 'not-ready' };
    const trig = tabOf(K.key);
    if (!trig || txt(trig) !== K.tab) return { state: 'changed', why: 'التاب ' + K.tab + ' مش موجود' };
    const active = trig.getAttribute('data-state') === 'active', s = active ? snap(a.kind) : null;
    return { state: 'ok', page: 'launch', active, form: !!s, ...(s || {}), toasts: toasts() };
  }
  if (step === 'tab') {
    const K = KINDS[a.kind], trig = K && tabOf(K.key);
    if (!trig || txt(trig) !== K.tab) return { state: 'changed', why: 'التاب مش موجود' };
    press(trig);
    return { state: 'ok' };
  }
  if (step === 'fill') {                                    // every field but the existing campaign and the country
    const P = formOf(a.kind);
    if (!P) return { state: 'no-form' };
    const miss = ['mode', 'platform', 'objective', 'country', 'custom', 'link'].filter((k) => !P[k] || (k !== 'custom' && k !== 'link' && (!P[k].btn || (k !== 'country' && !P[k].sel))));
    if (miss.length || P.subs.length !== 1) return { state: 'changed', why: 'ناقص في الفورم: ' + (miss.join(', ') || 'زرار Launch') };
    const has = (F, v) => [...F.sel.options].some((o) => o.value === v);
    if (!has(P.mode, a.mode)) return { state: 'changed', why: 'Campaign ID مفيهوش ' + a.mode };
    if (a.mode === 'New' && (!has(P.platform, a.platform) || !has(P.objective, a.objective))) return { state: 'changed', why: 'المنصة أو الهدف مش في القائمة' };
    setv(P.ids, a.kind === 'Single' ? a.ids[0] : a.ids.join('\n'));
    setv(P.custom, a.custom);
    setv(P.link, a.link);
    setv(P.mode.sel, a.mode);
    if (a.mode === 'New') { setv(P.platform.sel, a.platform); setv(P.objective.sel, a.objective); }
    return { state: 'ok' };
  }
  if (step === 'campaign') {                                // Campaign ID = Select → that exact campaign number
    const P = formOf(a.kind), F = P && P.campaign;
    if (!F || !F.sel) return { state: 'no-field' };
    const o = [...F.sel.options].filter((x) => x.value === a.campaign);
    if (o.length !== 1) return { state: 'no-option', n: o.length };
    setv(F.sel, a.campaign);
    return { state: 'ok', text: txt(o[0]) };
  }
  if (step === 'country-open') {
    const P = formOf(a.kind), cb = P && P.country && P.country.btn;
    if (!cb || cb.disabled) return { state: 'no-field' };
    if (!popOf(cb)) cb.click();
    return { state: 'ok' };
  }
  if (step === 'country-pick') {                            // the one item that ends with «(SA)»
    const P = formOf(a.kind), pop = P && P.country && popOf(P.country.btn);
    if (!pop) return { state: 'waiting' };
    const it = [...pop.querySelectorAll('[cmdk-item]')].filter((e) => txt(e).endsWith('(' + a.country + ')'));
    if (it.length !== 1) return { state: 'no-option', n: it.length };
    it[0].click();
    return { state: 'ok' };
  }
  if (step === 'check') { const why = check(a.kind); return { state: 'ok', why }; }
  if (step === 'submit') {                                  // the last check and the click happen in the same step
    if (path !== '/launch') return { state: 'mismatch', why: 'الصفحة مش /launch' };
    const why = check(a.kind);
    if (why.length) return { state: 'mismatch', why: why.join(' · ') };
    if (a.stub === true) return { state: 'ok', clicked: false };          // test mode: everything but the click
    formOf(a.kind).subs[0].click();
    return { state: 'ok', clicked: true };
  }

  // ── result pages (History) ──
  if (step === 'result') {                                  // the launch on screen: the page's own data + the values its rows show
    if (!resId) return { state: 'ok', page: path === '/launch' ? 'launch' : 'other' };
    const tThis = tabOf('this'), tList = tabOf('bulk');
    const panel = [...document.querySelectorAll('[role=tabpanel]')].find((p) => p.getAttribute('data-state') === 'active');
    if (!tThis || !panel) return { state: 'not-ready' };
    const tab = tThis.getAttribute('data-state') === 'active' ? 'this' : tList && tList.getAttribute('data-state') === 'active' ? 'list' : null;
    const out = { state: 'ok', page: 'result', id: resId, tab, listN: tList ? Number((/(\d+)\s*$/.exec(txt(tList)) || [])[1] || 0) : null, data: null, list: null };
    if (tab === 'this') {
      const rows = {}; let data = null, n = 0;
      const row = (...names) => { for (const k of names) if (k in rows) return rows[k]; return undefined; };
      const walk = (f, d) => {
        for (; f && n < 4000; f = f.sibling) {
          n++;
          const p = f.memoizedProps;
          if (p && typeof p === 'object') {
            if (typeof p.label === 'string' && typeof p.value === 'string' && !(p.label in rows)) rows[p.label] = p.value;
            if (!data && p.data && typeof p.data === 'object' && 'parameters' in p.data && 'utm_url' in p.data && 'campaign_num' in p.data) data = p.data;
          }
          if (d < 60 && f.child) walk(f.child, d + 1);
        }
      };
      const pf = fiber(panel);
      if (pf) walk(pf.child, 0);
      if (data) {
        const g = (k) => (typeof data[k] === 'string' ? data[k] : data[k] == null ? null : String(data[k]));
        out.data = { id: g('id'), campaign_num: g('campaign_num'), campaign_name: g('campaign_name'), creative_id: g('creative_id'), ad_name: g('ad_name'), parameters: g('parameters'),
          utm_url: g('utm_url'), product_link: g('product_link'), platform_code: g('platform_code'), client_name_en: g('client_name_en'), created_at: g('created_at'),
          // the page first draws these rows with short labels (Campaign / Ad / UTM) and ~0.2 s later with the long ones: same values
          rowsOk: row('Campaign Name', 'Campaign') === data.campaign_name && row('Ad Name', 'Ad') === data.ad_name && row('Parameters') === data.parameters && row('UTM URL', 'UTM') === data.utm_url,
          labels: Object.keys(rows).join('|').slice(0, 120) };
      }
    } else if (tab === 'list') {
      out.list = [...panel.querySelectorAll('li a[href^="/launch/result/"]')].map((x) => {
        const leaves = [...x.querySelectorAll('*')].filter((e) => !e.children.length).map(txt).filter(Boolean);
        return { id: x.getAttribute('href').slice(15), creative: leaves[0] || '', ad_name: leaves.find((t) => t.startsWith('ID:')) || '' };
      });
    }
    return out;
  }
  if (step === 'tab-list' || step === 'tab-this') {
    const t = tabOf(step === 'tab-list' ? 'bulk' : 'this');
    if (!resId || !t) return { state: 'no-tab' };
    press(t);
    return { state: 'ok' };
  }
  if (step === 'open') {                                    // another result of the History, opened in place when its link is on screen
    const x = [...document.querySelectorAll('a[href="/launch/result/' + a.id + '"]')][0];
    if (!resId || !x) return { state: 'ok', clicked: false };
    x.click();
    return { state: 'ok', clicked: true };
  }
  if (step === 'history') {                                 // the latest launches the History list holds (its own rows)
    if (!resId) return { state: 'ok', page: path === '/launch' ? 'launch' : 'other' };
    const as = [...document.querySelectorAll('a[href^="/launch/result/"]')].filter((x) => !x.closest('[role=tabpanel]'));
    if (!as.length) return { state: 'not-ready' };
    let f = fiber(as[0]), d = 0, list = null;
    while (f && d < 80 && !list) {
      if (typeof f.type === 'function') {
        let h = f.memoizedState, i = 0;
        while (h && typeof h === 'object' && 'next' in h && i < 80) {
          const s = h.memoizedState;
          if (Array.isArray(s) && s.length && s[0] && typeof s[0] === 'object' && 'id' in s[0] && 'campaign_num' in s[0] && 'creative_id' in s[0] && 'created_at' in s[0]) { list = s; break; }
          h = h.next; i++;
        }
      }
      f = up(f); d++;
    }
    if (!list) return { state: 'no-history' };
    return { state: 'ok', page: 'result', id: resId, shown: as.length,
      items: list.slice(0, 80).map((x) => ({ id: String(x.id), campaign_num: String(x.campaign_num), creative_id: String(x.creative_id), platform_code: String(x.platform_code || ''), ad_name: String(x.ad_name || ''), at: Date.parse(x.created_at) || 0 })) };
  }
  return { state: 'unknown-step' };
}

// ───────── service worker side ─────────
async function ltRpc(info) {
  const { apiKey, anonKey } = await keys();
  const s = await get(['ltOn', 'ltTest']);
  const r = await fetch(LT_RPC, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + anonKey, apikey: anonKey },
    body: JSON.stringify({ p_key: apiKey, p_info: { v: LT_V, cap: ['launch'], on: s.ltOn !== false, test: s.ltTest === true, max: LT_MAX_PARALLEL, ...info } }) });
  let j = {}; try { j = await r.json(); } catch { /* */ }
  if (!r.ok || !j || j.ok !== true) throw new Error('السيرفر رفض (tl_jobs ' + r.status + ')');
  return j;
}

// a fresh background tab for one launch. A new one per launch on purpose: a background tab's timers get slower the longer the
// tab lives (measured on the Khzama tab: 6 s → 30 s per link over 12 links), a new tab starts fast again.
async function ltOpenTab() {
  const { tabId } = await get('tabId');
  const t = await chrome.tabs.create({ url: 'about:blank', pinned: false, active: false });
  if (t.id === tabId) throw new LtHalt('tab', 'التبويب اتلخبط مع تبويب التبرعات');
  await chrome.tabs.update(t.id, { autoDiscardable: false });
  LT_TABS.add(t.id);
  await chrome.storage.session.set({ ltTabs: [...LT_TABS] });
  return t;
}
async function ltCloseTab(id) {
  if (id == null) return;
  LT_TABS.delete(id);
  try { const t = await chrome.tabs.get(id); if (!t.pinned) await chrome.tabs.remove(id); } catch { /* already closed */ }
  await chrome.storage.session.set({ ltTabs: [...LT_TABS] });
}
// tabs left open by a worker that was stopped in the middle (only ids this extension itself opened in this browser session)
async function ltSweepTabs() {
  const { ltTabs } = await chrome.storage.session.get('ltTabs'), { tabId } = await get('tabId');
  for (const id of ltTabs || []) {
    if (LT_TABS.has(id) || id === tabId) continue;
    try { const t = await chrome.tabs.get(id); if (!t.pinned && (!t.url || t.url === 'about:blank' || t.url.startsWith(LT_ORIGIN + '/') || t.url.startsWith('chrome-extension://'))) await chrome.tabs.remove(id); } catch { /* gone */ }
  }
  await chrome.storage.session.set({ ltTabs: [...LT_TABS] });
}
// a tab-suspender extension (or Chrome itself) may have parked the tab: its URL is then not the launch tool's any more
async function ltAwake(tabId) {
  const t = await chrome.tabs.get(tabId);
  return !t.discarded && typeof t.url === 'string' && t.url.startsWith(LT_ORIGIN + '/');
}
async function ltNav(tabId, url) {
  const wait = loaded(tabId), t = await chrome.tabs.get(tabId);
  if (t.url === url && !t.discarded) await chrome.tabs.reload(tabId); else await chrome.tabs.update(tabId, { url });
  await wait;
}
async function ltRun(tabId, step, a) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: ltStep, args: [step, a || {}] });
  if (!result) throw new LtHalt('no-result', 'صفحة أداة الإطلاق مردّتش');
  if (result.state === 'login') throw new LtHalt('login', 'أداة الإطلاق محتاجة تسجيل دخول');
  if (result.state === 'changed') throw new LtHalt('changed', 'فورم أداة الإطلاق اتغيّر: ' + (result.why || ''));
  return result;
}
// poll one step until `done(r)` is true. `url` (only BEFORE a submit) lets a parked tab be loaded again, twice at most.
async function ltPoll(tabId, step, a, done, o) {
  o = o || {};
  let last = 'not-ready', woke = 0;
  for (let i = 0; i < (o.tries || 60); i++) {
    if (i) await ltSleep(o.gap || 300);
    let r;
    try { r = await ltRun(tabId, step, a); } catch (e) {
      if (e instanceof LtHalt) throw e;
      last = String(e.message || e); r = null;
    }
    if (r && r.state !== 'wrong-host') {
      last = r.state === 'ok' ? (r.page || 'ok') : r.state;
      const v = await done(r);
      if (v) return r;
      continue;
    }
    if (o.url && woke < 2 && !(await ltAwake(tabId).catch(() => false))) { woke++; last = 'التاب اتعلّق (suspended) — بيتفتح تاني'; await ltNav(tabId, o.url); }
  }
  throw new LtHalt('timeout', (o.what || step) + ' محمّلش (' + last + ')', o.scope);
}

// one result page → its data (This ad). In place when its link is on screen, else a page load.
async function ltResult(tabId, id, nav) {
  if (nav) await ltNav(tabId, LT_ORIGIN + '/launch/result/' + id);
  else {
    const here = await ltRun(tabId, 'result').catch((e) => { if (e instanceof LtHalt) throw e; return null; });
    if (!(here && here.page === 'result' && here.id === id)) {
      const o = await ltRun(tabId, 'open', { id }).catch((e) => { if (e instanceof LtHalt) throw e; return null; });
      if (!(o && o.clicked)) await ltNav(tabId, LT_ORIGIN + '/launch/result/' + id);
    }
  }
  // taken only when the page is settled: its rows show the same values as its data, and two reads in a row are identical.
  // Rows that still disagree after ~6 s are passed on as they are — the validation then stops the launch with that reason.
  let prev = null, soft = 0;
  const r = await ltPoll(tabId, 'result', {}, async (x) => {
    if (x.state !== 'ok' || x.page !== 'result' || x.id !== id) { prev = null; return false; }
    if (x.tab === 'list') { await ltRun(tabId, 'tab-this'); prev = null; return false; }
    if (!(x.data && x.data.id === id)) { prev = null; return false; }
    if (!x.data.rowsOk && ++soft <= 40) { prev = null; return false; }
    const sig = JSON.stringify(x.data);
    if (sig !== prev) { prev = sig; return false; }
    return true;
  }, { tries: 140, gap: 150, what: 'نتيجة الإطلاق', scope: 'launch' });
  return r;
}
// «Campaign ads»: every ad of the campaign on screen → [{id, creative, ad_name}], then back to «This ad»
async function ltList(tabId, id, first) {
  if (first.listN == null || first.listN <= 1) return [{ id, creative: first.data.creative_id, ad_name: first.data.ad_name }];
  await ltRun(tabId, 'tab-list');
  const r = await ltPoll(tabId, 'result', {}, async (x) => {
    if (x.state !== 'ok' || x.page !== 'result' || x.id !== id) return false;
    if (x.tab !== 'list') { await ltRun(tabId, 'tab-list'); return false; }
    return !!(x.list && x.listN > 0 && x.list.length === x.listN);
  }, { tries: 80, gap: 150, what: 'قائمة إعلانات الحملة', scope: 'launch' });
  await ltRun(tabId, 'tab-this');
  return r.list;
}
// the results of one launch, starting from a result page of its campaign that is already known. → the result object.
// Throws LtHalt (scope launch, with what was read) when they do not match the inputs exactly.
async function ltCollect(tabId, job, startId, o, beat) {
  o = o || {};
  const first = await ltResult(tabId, startId, !!o.nav), need = job.kind === 'Smart' ? 1 : job.ids.length, notes = (o.notes || []).slice();
  if (o.onFirst) await o.onFirst(first.data).catch(() => {});                                 // the number is known: the number turn is given back now
  if (o.probe && first.data.campaign_num !== job.campaign) return null;                         // that page is another campaign's: nothing learned
  let mine;
  if (o.only) mine = o.only;                                // ids already chosen (from the History)
  else if (need === 1 && ltMine(job, first.data.creative_id, first.data.ad_name)) mine = [{ id: startId, creative: first.data.creative_id }];
  else { const list = await ltList(tabId, startId, first); if (o.onList) o.onList(first.data.campaign_num, list); mine = list.filter((x) => ltMine(job, x.creative, x.ad_name)); }
  const seen = new Map(), dup = [];
  for (const x of mine) { const k = job.kind === 'Smart' ? 'smart' : x.creative; if (seen.has(k)) dup.push(x.creative); else seen.set(k, x.id); }
  const ads = [], bad = [];
  let n = 0;
  for (const [, id] of seen) {
    const r = id === first.id ? first : await ltResult(tabId, id, false);
    const why = ltValid(job, r.data, id);
    if (why.length) bad.push(String(r.data && r.data.creative_id).slice(0, 20) + ': ' + why.join(', '));
    else ads.push(r.data);
    if (++n % 8 === 0 && beat) await beat();
  }
  const camp = ads[0] || first.data, code = String(camp.campaign_name || '').split(' | ')[0];
  if (ads.some((d) => d.campaign_num !== camp.campaign_num || d.campaign_name !== camp.campaign_name)) bad.push('النتايج من أكتر من حملة');
  const order = (d) => (job.kind === 'Smart' ? 0 : job.ids.indexOf(d.creative_id));
  ads.sort((x, y) => order(x) - order(y));
  const got = new Set(ads.map((d) => d.creative_id)), missing = job.kind === 'Smart' ? (ads.length ? [] : ['Smart']) : job.ids.filter((x) => !got.has(x));
  if (ads.some((d) => d.product_link !== job.link)) notes.push('Product Link في النتيجة غير اللي في البريف: ' + String(ads.find((d) => d.product_link !== job.link).product_link).slice(0, 80));
  const result = { campaign_no: LT_CODE_RE.test(code) ? code : null, campaign_num: camp.campaign_num || null, campaign_name: camp.campaign_name || null, custom: job.custom,
    existed: !!o.existed, ads: ads.map(ltAd), missing, notes };
  if (o.probe && !ads.length && !bad.length && !dup.length) return null;                        // nothing of this ad set is there yet
  if (dup.length) throw new LtHalt('duplicate', 'الـ Custom ده متطلق أكتر من مرة في الحملة (' + dup.slice(0, 3).join('، ') + ') — راجع History', 'launch', result);
  if (bad.length) throw new LtHalt('mismatch', 'نتيجة الإطلاق مش مطابقة للبريف: ' + bad.slice(0, 3).join(' · '), 'launch', result);
  if (missing.length) throw new LtHalt('missing', (o.existed ? 'جزء من الإطلاق موجود قبل كده وناقص: ' : 'اتطلق بس ناقص: ') + missing.join('، '), 'launch', result);
  if (ads.length !== need) throw new LtHalt('count', 'عدد النتايج ' + ads.length + ' بدل ' + need, 'launch', result);
  return result;
}
// a submit the tool never answered (or a job that died after its submit): the tool's History decides. Never submits.
async function ltResolve(tabId, job, sinceMs, beat, onFirst) {
  const msg = 'الفورم اتبعت لأداة الإطلاق ومفيش نتيجة ظاهرة في History — متطلقش تاني قبل ما تراجع History';
  await ltNav(tabId, LT_ORIGIN + '/launches');
  let h;
  try {
    h = await ltPoll(tabId, 'history', {}, (x) => x.state === 'ok' && x.page === 'result' && x.items && x.items.length > 0, { tries: 50, gap: 400, what: 'History', scope: 'launch' });
  } catch (e) { throw new LtHalt('unconfirmed', msg + ' (' + String(e.message || e).slice(0, 80) + ')', 'launch'); }
  // only launches made after this submit (3 s of clock difference allowed); for Campaign = New the whole campaign must be new
  const born = new Map();
  for (const x of h.items) born.set(x.campaign_num, Math.min(born.has(x.campaign_num) ? born.get(x.campaign_num) : Infinity, x.at));
  const c = h.items.filter((x) => x.at >= sinceMs - 3e3 && x.platform_code === job.platform && ltMine(job, x.creative_id, x.ad_name)
    && (job.mode === 'Select' ? x.campaign_num === job.campaign : born.get(x.campaign_num) >= sinceMs - 3e3));
  if (!c.length) throw new LtHalt('unconfirmed', msg, 'launch');
  if (new Set(c.map((x) => x.campaign_num)).size !== 1) throw new LtHalt('unconfirmed', 'أكتر من حملة في History بنفس الإعلانات — راجعها بإيدك', 'launch');
  return await ltCollect(tabId, job, c[0].id, { only: c.map((x) => ({ id: x.id, creative: x.creative_id })), notes: ['النتيجة اتقرت من History بعد ما الأداة مردّتش'], onFirst }, beat);
}

// one launch (= one ad set). → {state:'done', result} · {state:'release'} (form abandoned before the submit) ·
// {state:'gone'} (the job is not ours any more) · throws LtHalt
async function ltLaunch(tabId, job, stub, note, mem) {
  mem = mem || {};
  const K = job.kind, t0 = Date.now(), beat = () => ltRpc({ take: false, touch: job.id }).catch(() => {});
  const exp = { kind: K, ids: job.ids, custom: job.custom, link: job.link, mode: job.mode, campaign: job.campaign || null, code: job.code || null,
    platform: job.platform, platform_name: job.platform_name, objective: job.objective, objective_name: job.objective_name, country: job.country };
  // the campaign number of a New launch goes to the server the moment the result page shows it: that releases the number turn
  // for the next campaign, seconds after the submit — the ads are read and checked after that, without the lock
  const onFirst = job.mode !== 'New' ? null : async (d) => {
    const code = String((d && d.campaign_name) || '').split(' | ')[0];
    if (LT_CODE_RE.test(code) && code.endsWith('-' + d.campaign_num)) await ltRpc({ take: false, num: { id: job.id, campaign_no: code, campaign_name: d.campaign_name } });
  };
  // 0. already there? a job that was submitted before is only ever resolved · a Select launch reads the campaign's own list
  if (job.resolve) return { state: 'done', result: await ltResolve(tabId, job, Number(job.submit_ms) || t0, beat, onFirst) };
  // …unless this same loop read that list a moment ago (the launch before this one) and this ad set was not in it
  const fresh = mem.list && mem.list.num === job.campaign && Date.now() - mem.list.at < 90e3 && !mem.list.items.some((x) => ltMine(job, x.creative, x.ad_name));
  if (job.mode === 'Select' && job.anchor && !fresh) {
    await note('بتراجع إعلانات الحملة');
    const ex = await ltCollect(tabId, job, job.anchor, { nav: true, existed: true, probe: true, notes: ['كان متطلق قبل كده — متطلقش تاني'] }, beat);
    if (ex) return { state: 'done', result: ex };
  }
  // 1. the form, on a freshly loaded page: fill, then read back that the app registered every field
  const prepare = async () => {
    const tp = Date.now();
    await note('بتفتح الفورم');
    await ltNav(tabId, LT_FORM);
    const ready = (x) => x.form && x.mode && x.mode.n > 0 && x.platform && x.platform.n > 0 && x.objective && x.objective.n > 0 && x.country && !!x.country.code && x.submit && x.submit.n === 1;
    let r = await ltPoll(tabId, 'read', exp, async (x) => {
      if (x.state !== 'ok' || x.page !== 'launch') return false;
      if (!x.active) { await ltRun(tabId, 'tab', { kind: K }); return false; }
      return ready(x);
    }, { tries: 120, gap: 200, url: LT_FORM, what: 'فورم ' + K });
    const opt = (F, v) => (F.opts || []).find((o) => o[0] === v);
    if (!opt(r.mode, job.mode)) throw new LtHalt('changed', 'Campaign ID مفيهوش ' + job.mode);
    if (!opt(r.platform, job.platform) || opt(r.platform, job.platform)[1].toLowerCase() !== job.platform_name.toLowerCase()) throw new LtHalt('changed', 'المنصة ' + job.platform + ' مش في القائمة');
    if (!opt(r.objective, job.objective) || opt(r.objective, job.objective)[1] !== job.objective_name) throw new LtHalt('changed', 'الهدف ' + job.objective + ' مش في القائمة');
    r = await ltRun(tabId, 'fill', exp);
    if (r.state !== 'ok') throw new LtHalt('fill', 'الفورم متملاش: ' + (r.why || r.state));
    if (job.mode === 'Select') {
      r = await ltPoll(tabId, 'read', exp, (x) => x.state === 'ok' && x.page === 'launch' && x.form && x.mode.v === 'Select' && x.campaign && x.campaign.n > 0, { tries: 60, gap: 150, what: 'قائمة Existing campaign' });
      if (!r.campaign.has) throw new LtHalt('no-campaign', 'الحملة ' + job.campaign + ' مش في قائمة Existing campaign', 'launch');
      if (!(job.code ? r.campaign.hasText.startsWith(job.code + ' ') : new RegExp('^[A-Z]{2,4}-' + job.campaign + ' ').test(r.campaign.hasText))) throw new LtHalt('no-campaign', 'اسم الحملة ' + job.campaign + ' في القائمة مش متوقع', 'launch');
      r = await ltRun(tabId, 'campaign', exp);
      if (r.state !== 'ok') throw new LtHalt('no-campaign', 'الحملة ' + job.campaign + ' متختارتش (' + r.state + ')', 'launch');
      r = await ltPoll(tabId, 'read', exp, (x) => x.state === 'ok' && x.page === 'launch' && x.form && x.campaign && x.campaign.v === job.campaign && !!x.platform.v && !!x.objective.v && x.platform.dis, { tries: 60, gap: 150, what: 'اختيار الحملة ' + job.campaign });
      if (r.platform.v !== job.platform || r.objective.v !== job.objective || r.country.code !== job.country)
        throw new LtHalt('inherit', 'الحملة ' + job.campaign + ' منصتها/هدفها/دولتها غير البريف (' + [r.platform.v, r.objective.v, r.country.code].join(' ') + ')', 'launch');
    } else {
      r = await ltPoll(tabId, 'read', exp, (x) => x.state === 'ok' && x.page === 'launch' && x.form && x.mode.v === 'New' && x.platform.v === job.platform && x.objective.v === job.objective, { tries: 60, gap: 150, what: 'تسجيل المنصة والهدف' });
      if (r.country.code !== job.country) {
        await ltRun(tabId, 'country-open', exp);
        let p = { state: 'waiting' };
        for (let i = 0; i < 40 && p.state === 'waiting'; i++) { await ltSleep(250); p = await ltRun(tabId, 'country-pick', exp); }
        if (p.state !== 'ok') throw new LtHalt('country', 'الدولة ' + job.country + ' مش في القائمة');
        await ltPoll(tabId, 'read', exp, (x) => x.state === 'ok' && x.page === 'launch' && x.form && x.country.code === job.country, { tries: 40, gap: 250, what: 'تسجيل الدولة' });
      }
    }
    await ltSleep(200);
    r = await ltRun(tabId, 'check', exp);
    if (r.why.length) { await ltSleep(600); r = await ltRun(tabId, 'check', exp); }
    if (r.why.length) throw new LtHalt('check', 'الفورم مش مطابق للبريف: ' + r.why.join(' · '));
    if (Date.now() - tp > 150e3) throw new LtHalt('slow', 'الصفحة بطيئة — اتلغى قبل الإرسال');
  };
  await prepare();
  // 2. may I press Launch? (the FIRST launch waits here for the campaign-number turn)
  const leave = async () => { await chrome.tabs.update(tabId, { url: 'about:blank' }).catch(() => {}); };
  let waitedLong = false, r;
  for (let waited = 0; ; waited++) {
    const g = (await ltRpc({ take: false, go: job.id })).go || {};
    if (g.ok) { waitedLong = waited > 0; break; }
    if (g.wait && waited < 90) { await note('مستنية دور رقم الحملة (قدامها ' + (g.position == null ? '؟' : g.position) + ')'); await ltSleep(4000); continue; }
    await leave();
    return { state: g.error === 'not_running' || g.error === 'already_submitted' ? 'gone' : 'release', why: g.error || 'wait' };
  }
  if (waitedLong) {                                         // the form sat waiting for the turn: a parked or changed tab is filled again
    const c = await ltRun(tabId, 'check', exp).catch((e) => { if (e instanceof LtHalt) throw e; return null; });
    if (!c || c.state !== 'ok' || c.why.length) await prepare();
  }
  // 3. the one step that checks again and presses Launch
  await note('بتطلق');
  r = await ltRun(tabId, 'submit', { ...exp, stub: stub === true }).catch((e) => { if (e instanceof LtHalt) throw e; return { state: 'mismatch', why: String(e.message || e).slice(0, 120) }; });
  if (r.state !== 'ok') { await leave(); throw new LtHalt('check', 'الفورم مش مطابق قبل الإرسال (متبعتش): ' + (r.why || r.state)); }
  if (!r.clicked) { await leave(); return { state: 'done', result: { stub: true, custom: job.custom, note: 'تجربة: اتملى واتراجع من غير إرسال' } }; }
  // 4. from here the form was sent: nothing below may submit again
  const tSub = Date.now(), notes = [];
  try {
    let land = null, err = '';
    while (Date.now() - tSub < 150e3 * LT_GAP && !land && !err) {
      await ltSleep(400);
      let x;
      try { x = await ltRun(tabId, 'read', exp); } catch (e) { if (e instanceof LtHalt && e.code !== 'no-result') throw e; continue; }
      for (const t of x.toasts || []) if (!notes.includes(t)) notes.push(t);
      if (x.page === 'result') land = x.id;
      else if (x.page === 'launch' && x.form && x.alert && !x.busy) err = x.alert;
    }
    if (err) throw new LtHalt('tool', 'أداة الإطلاق رفضت: ' + err.slice(0, 200), 'launch');
    await note('بتقرا النتايج');
    if (!land) return { state: 'done', result: await ltResolve(tabId, job, tSub, beat, onFirst) };
    return { state: 'done', result: await ltCollect(tabId, job, land, { notes, onFirst, onList: (num, items) => { mem.list = { num, items, at: Date.now() }; } }, beat) };
  } catch (e) {
    if (e instanceof LtHalt && e.code !== 'timeout' && e.code !== 'no-result') throw e;
    // the result page itself did not read: the History is asked once, then it is the agent's
    try { return { state: 'done', result: await ltResolve(tabId, job, tSub, beat, onFirst) }; } catch (e2) {
      if (e2 instanceof LtHalt && e2.code !== 'timeout' && e2.code !== 'no-result') throw e2;
      throw new LtHalt('unconfirmed', 'الفورم اتبعت ومقدرتش أقرا النتيجة (' + String(e2.message || e2).slice(0, 80) + ') — اقرا History قبل أي إطلاق', 'launch', e2 instanceof LtHalt ? e2.partial : null);
    }
  }
}

const ltSeen = (r) => set({ ltSeen: Date.now(), ltPending: r.pending || 0, ...(r.batch ? { ltBatch: r.batch } : {}) });

// one campaign: its launches one after the other (New, then Select …), each in a fresh tab; the tab is closed at the end.
// A failure hands the rest of THIS campaign to its agent; only an unexpected page (halt 'all') stops the other campaigns too.
async function ltCampaign(first, ctl) {
  const lid = first.launch_id;
  let job = first, tabId = null;
  const mem = {};                                           // what this loop learned from the launch before (the campaign's list)
  try {
    while (job) {
      const s = await get(['ltOn', 'ltTest']), test = s.ltTest === true;
      const label = (job.code || job.title || '') + ' · ' + (job.custom || 'من غير Custom') + ' · ' + job.seq + '/' + job.of;
      const note = async (what) => { await chrome.storage.session.set({ ltRunning: Date.now() }); await set({ ltNow: { title: label, what, at: Date.now(), n: ctl.loops.size } }); };
      await note('بتبدأ');
      let report = null;
      const bad = ltGuard(job) || (!!job.test !== test ? 'وضع التجربة مش مطابق' : null);
      if (bad) { report = { id: job.id, state: 'failed', error: bad, halt: 'launch' }; await set({ ltError: { at: Date.now(), msg: label + ': ' + bad } }); }
      else {
        try {
          await ltCloseTab(tabId); tabId = null;
          tabId = (await ltOpenTab()).id;
          const out = await ltLaunch(tabId, job, test && LT_STUB_IN_TEST, note, mem);
          if (out.state === 'done') report = { id: job.id, state: 'done', result: out.result };
          else if (out.state === 'release') { report = { id: job.id, state: 'release' }; await ltSleep(5000); }
          // 'gone': the agent took it over — nothing to report
        } catch (e) {
          const halt = e instanceof LtHalt ? e.scope : 'all', msg = String(e.message || e).slice(0, 300);
          report = { id: job.id, state: 'failed', error: msg, halt, ...(e instanceof LtHalt && e.partial ? { result: e.partial } : {}) };
          await set({ ltError: { at: Date.now(), msg: label + ': ' + msg } });
        }
      }
      if (report && report.halt === 'all') ctl.stopAll = true;
      // the report and this campaign's next launch in one call
      const want = s.ltOn !== false && !ctl.stopAll && !(report && report.state === 'failed');
      let r = null;
      for (let i = 0; i < 3 && !r; i++) { try { r = await ltRpc({ take: want, for: lid, report }); } catch { await ltSleep(1500); } }
      if (!r) break;                                         // the server fails or resolves a silent job after 150 s
      await ltSeen(r);
      job = r.job;
    }
  } finally {
    await ltCloseTab(tabId).catch(() => {});
  }
}

// heartbeat + start one loop per campaign (up to LT_MAX_PARALLEL), until nothing is left
async function ltTick() {
  const now = Date.now(), { ltRunning } = await chrome.storage.session.get('ltRunning');
  if (ltRunning && now - ltRunning < 200e3) return;
  await chrome.storage.session.set({ ltRunning: now });
  const loops = new Map(), ctl = { stopAll: false, loops };
  let worked = false, lingered = false, errs = 0;
  try {
    await ltSweepTabs();
    for (;;) {
      await chrome.storage.session.set({ ltRunning: Date.now() });
      const s = await get('ltOn');
      let r;
      try { r = await ltRpc({ take: s.ltOn !== false && !ctl.stopAll && loops.size < LT_MAX_PARALLEL, skip: [...loops.keys()] }); errs = 0; } catch (e) {
        await set({ ltError: { at: Date.now(), msg: String(e.message || e).slice(0, 200) } });
        if (!loops.size || ++errs > 20) break;               // running campaigns go on; they report by themselves
        await Promise.race([...loops.values(), ltSleep(3000)]);
        continue;
      }
      await ltSeen(r);
      if (r.job && r.job.launch_id && !loops.has(r.job.launch_id)) {
        const id = r.job.launch_id;
        worked = true; lingered = false;
        loops.set(id, ltCampaign(r.job, ctl).catch(async (e) => { await set({ ltError: { at: Date.now(), msg: String(e.message || e).slice(0, 200) } }); }).finally(() => { loops.delete(id); }));
        continue;                                            // maybe another campaign is waiting too
      }
      if (loops.size) { await Promise.race([...loops.values(), ltSleep(3000)]); continue; }
      if (ctl.stopAll) break;
      if (worked && !lingered) { lingered = true; await ltSleep(3000); continue; }        // the next campaign may arrive right after
      break;
    }
  } finally {
    await Promise.allSettled([...loops.values()]);
    for (const id of [...LT_TABS]) await ltCloseTab(id).catch(() => {});
    await set({ ltNow: null });
    await chrome.storage.session.set({ ltRunning: 0 });
  }
}

// two alarms half a period apart: Chrome allows no alarm faster than 30 s, so a new campaign waits 15 s at most, not 30
async function ensureLtAlarm() {
  if (!(await chrome.alarms.get(LT_ALARM))) chrome.alarms.create(LT_ALARM, { periodInMinutes: 0.5, delayInMinutes: 0.15 });
  if (!(await chrome.alarms.get(LT_ALARM + '-b'))) chrome.alarms.create(LT_ALARM + '-b', { periodInMinutes: 0.5, delayInMinutes: 0.4 });
}
chrome.runtime.onInstalled.addListener(ensureLtAlarm);
chrome.runtime.onStartup.addListener(ensureLtAlarm);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === LT_ALARM || a.name === LT_ALARM + '-b') ltTick(); });
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m?.cmd === 'launch') { ltTick().then(() => reply({ ok: true })); return true; }
});
ensureLtAlarm();
