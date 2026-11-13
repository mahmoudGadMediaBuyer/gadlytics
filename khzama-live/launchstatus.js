// «أداة الإطلاق» box of popup.html + options.html (launchtool.js): state, last batch, what it is doing now, last error.
// Uses fmtN / ago / escapeHtml from status.js.
async function renderLaunch(el) {
  const s = await chrome.storage.local.get(null);
  const fresh = s.ltSeen && Date.now() - s.ltSeen < 2 * 60e3, b = s.ltBatch, now = s.ltNow && Date.now() - s.ltNow.at < 4 * 60e3 ? s.ltNow : null;
  const [txt, cls] = s.ltOn === false ? ['متوقفة (الزرار مقفول)', 'mute'] : !s.apiKey ? ['مفيش مفتاح', 'bad'] : now ? [now.n > 1 ? `بتطلق ${fmtN(now.n)} حملات مع بعض…` : 'بتطلق…', 'warn']
    : !s.ltSeen ? ['مستنية أول اتصال', 'mute'] : !fresh ? ['مش متصلة بالسيرفر', 'warn'] : s.ltTest === true ? ['وضع تجربة (من غير Launch)', 'warn'] : ['جاهزة ✓', 'ok'];
  el.innerHTML = `
    <div class="row"><span>أداة الإطلاق</span><b class="${cls}">${txt}</b></div>
    <div class="row"><span>آخر دفعة</span><b>${b ? `<span class="num">${escapeHtml(b.code)}</span> · <span class="num">${fmtN(b.done)}/${fmtN(b.total)}</span>${b.failed ? ` · <span class="bad">${fmtN(b.failed)} فشل</span>` : ''}` : '—'}</b></div>
    ${b ? `<div class="row"><span>وقتها</span><b>${ago(b.at)}</b></div>` : ''}
    ${s.ltPending ? `<div class="row"><span>في الدور</span><b class="num">${fmtN(s.ltPending)}</b></div>` : ''}
    ${now ? `<div class="mute"><span class="num">${escapeHtml(now.title)}</span> — ${escapeHtml(now.what || '')}</div>` : ''}
    ${s.ltError ? `<div class="row"><span>آخر خطأ</span><b class="bad">${ago(s.ltError.at)}</b></div><div class="mute">${escapeHtml(s.ltError.msg)}</div>` : ''}`;
}
