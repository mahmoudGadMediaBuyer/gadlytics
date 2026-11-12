// shared by popup.html + options.html: renders the status box from chrome.storage.local
const fmtN = (n) => Number(n || 0).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 });
function ago(t) {
  if (!t) return '—';
  const m = Math.round((Date.now() - t) / 60e3);
  const hhmm = new Date(t).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' });
  return hhmm + ' · ' + (m < 1 ? 'دلوقتي' : m < 60 ? `من ${m} دقيقة` : `من ${Math.round(m / 60)} ساعة`);
}
async function renderStatus(el) {
  const s = await chrome.storage.local.get(null);
  const busy = s.busy && Date.now() - s.busy < 4 * 60e3;
  const [txt, cls] = s.enabled === false ? ['متوقف (الزرار مقفول)', 'mute'] : busy ? ['جاري السحب…', 'warn']
    : s.paused === 'login' ? ['خزامى محتاج تسجيل دخول — سجّل دخول في admin.molabi.sa', 'bad']
    : !s.apiKey ? ['مفيش مفتاح — حطه في الإعدادات', 'bad'] : s.fails ? [`فيه مشكلة (${s.fails} محاولة)`, 'warn'] : s.last ? ['شغال ✓', 'ok'] : ['مستني أول سحبة', 'mute'];
  const st = s.last?.stored || {};
  el.innerHTML = `
    <div class="row"><span>الحالة</span><b class="${cls}">${txt}</b></div>
    <div class="row"><span>آخر نجاح</span><b>${ago(s.last?.at)}</b></div>
    <div class="row"><span>النهارده (${s.last?.date || '—'})</span><b><span class="num">${fmtN(st.donations)}</span> تبرع · <span class="num">${fmtN(st.amount)}</span> ر.س</b></div>
    <div class="row"><span>روابط فيها تبرعات</span><b class="num">${fmtN(st.links)}</b></div>
    ${s.lastError ? `<div class="row"><span>آخر خطأ</span><b class="bad">${ago(s.lastError.at)}</b></div><div class="mute">${escapeHtml(s.lastError.msg)}</div>` : ''}`;
}
// «روابط الحملات»: the link-adding job (links.js) — last batch, what it is doing now, last error
async function renderLinks(el) {
  const s = await chrome.storage.local.get(null);
  const fresh = s.linksSeen && Date.now() - s.linksSeen < 2 * 60e3, b = s.linksBatch, now = s.linksNow && Date.now() - s.linksNow.at < 3 * 60e3 ? s.linksNow : null;
  const [txt, cls] = s.linksOn === false ? ['متوقفة (الزرار مقفول)', 'mute'] : !s.apiKey ? ['مفيش مفتاح', 'bad'] : now ? ['بتسجّل رابط…', 'warn']
    : !s.linksSeen ? ['مستنية أول اتصال', 'mute'] : !fresh ? ['مش متصلة بالسيرفر', 'warn'] : s.linksTest === true ? ['وضع تجربة (من غير حفظ)', 'warn'] : ['جاهزة ✓', 'ok'];
  el.innerHTML = `
    <div class="row"><span>روابط الحملات</span><b class="${cls}">${txt}</b></div>
    <div class="row"><span>آخر دفعة</span><b>${b ? `<span class="num">${escapeHtml(b.code)}</span> · <span class="num">${fmtN(b.done)}/${fmtN(b.total)}</span>${b.failed ? ` · <span class="bad">${fmtN(b.failed)} فشل</span>` : ''}` : '—'}</b></div>
    ${b ? `<div class="row"><span>وقتها</span><b>${ago(b.at)}</b></div>` : ''}
    ${s.linksPending ? `<div class="row"><span>في الدور</span><b class="num">${fmtN(s.linksPending)}</b></div>` : ''}
    ${now ? `<div class="mute num">${escapeHtml(now.title)}</div>` : ''}
    ${s.linksError ? `<div class="row"><span>آخر خطأ</span><b class="bad">${ago(s.linksError.at)}</b></div><div class="mute">${escapeHtml(s.linksError.msg)}</div>` : ''}`;
}
const escapeHtml = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
