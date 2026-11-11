// Runs INSIDE the Khzama page (chrome.scripting.executeScript, world MAIN), exactly like runbook daily_pull §2:
// it reads only what the table already rendered (the React props of the table component) + the two date inputs.
// No network request, no cookies, no storage, no headers.
function readKhzama() {
  if (document.querySelector('input[type=password]') || /login|signin|auth/i.test(location.pathname)) return { state: 'login' };
  const q = new URLSearchParams(location.search);
  const tr = document.querySelector('table tbody tr');
  if (!tr) return { state: 'not-ready' };
  const k = Object.keys(tr).find((x) => x.startsWith('__reactFiber'));
  let f = k && tr[k];
  while (f && !(f.memoizedProps && Array.isArray(f.memoizedProps.data) && f.memoizedProps.columns)) f = f.return;
  if (!f) return { state: 'not-ready' };
  const p = f.memoizedProps;
  if (p.isLoading) return { state: 'loading' };
  // the date inputs show «11/11/2026, 03:00» (DD/MM/YYYY, Riyadh) → YYYY-MM-DD
  const dates = [...document.querySelectorAll('input')].map((i) => /^(\d{2})\/(\d{2})\/(\d{4})/.exec(i.value)).filter(Boolean).map((m) => m[3] + '-' + m[2] + '-' + m[1]);
  const rows = p.data.filter((r) => 'title' in r);               // the last item is the «المجموع» row (id customRow)
  const pg = p.pagination || {};
  return {
    state: 'ok', from: q.get('fromDate'), to: q.get('toDate'), urlPage: Number(q.get('page')), dates,
    page: pg.page, size: pg.size, total: pg.rows, count: rows.length, idSum: rows.reduce((a, r) => a + Number(r.id), 0),
    rows: rows.filter((r) => r.numberOfDonations > 0 || r.totalDonationAmount > 0).map((r) => [r.id, r.title, r.numberOfDonations, r.totalDonationAmount]),
  };
}
