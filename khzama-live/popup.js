const box = document.getElementById('status'), run = document.getElementById('run'), on = document.getElementById('on');
const linksBox = document.getElementById('links'), linksOn = document.getElementById('linksOn');
const launchBox = document.getElementById('launch'), ltOn = document.getElementById('ltOn');
const liveBox = document.getElementById('live'), liveOn = document.getElementById('liveOn'), liveEvery = document.getElementById('liveEvery'), liveRun = document.getElementById('liveRun');
const refresh = () => { if (liveBox) renderLive(liveBox); renderStatus(box); if (linksBox && typeof renderLinks === 'function') renderLinks(linksBox); if (launchBox && typeof renderLaunch === 'function') renderLaunch(launchBox); };
if (ltOn) {
  chrome.storage.local.get('ltOn').then((s) => { ltOn.checked = s.ltOn !== false; });
  ltOn.onchange = async () => { await chrome.storage.local.set({ ltOn: ltOn.checked }); chrome.runtime.sendMessage({ cmd: 'launch' }).catch(() => {}); };
}
chrome.storage.local.get('linksOn').then((s) => { linksOn.checked = s.linksOn !== false; });
linksOn.onchange = async () => { await chrome.storage.local.set({ linksOn: linksOn.checked }); chrome.runtime.sendMessage({ cmd: 'links' }).catch(() => {}); };
chrome.storage.local.get('enabled').then((s) => { on.checked = s.enabled !== false; });
on.onchange = async () => { await chrome.storage.local.set({ enabled: on.checked }); chrome.runtime.sendMessage({ cmd: 'badge' }); };
run.onclick = async () => { run.disabled = true; run.textContent = 'جاري السحب…'; await chrome.runtime.sendMessage({ cmd: 'run' }); run.disabled = false; run.textContent = 'سحب دلوقتي'; };
chrome.storage.onChanged.addListener(refresh);
refresh(); setInterval(refresh, 30e3);
chrome.storage.local.get(['liveOn', 'liveInterval']).then((s) => { liveOn.checked = s.liveOn !== false; liveEvery.value = String(s.liveInterval || 5); });
liveOn.onchange = async () => { await chrome.storage.local.set({ liveOn: liveOn.checked }); chrome.runtime.sendMessage({ cmd: 'badge' }).catch(() => {}); };
liveEvery.onchange = async () => { await chrome.storage.local.set({ liveInterval: Number(liveEvery.value) || 5 }); refresh(); };
liveRun.onclick = async () => { liveRun.disabled = true; liveRun.textContent = 'بيحدّث…'; await chrome.runtime.sendMessage({ cmd: 'live-run' }).catch(() => {}); liveRun.disabled = false; liveRun.textContent = 'حدّث دلوقتي'; };
