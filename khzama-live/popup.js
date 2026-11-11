const box = document.getElementById('status'), run = document.getElementById('run'), on = document.getElementById('on');
const refresh = () => renderStatus(box);
chrome.storage.local.get('enabled').then((s) => { on.checked = s.enabled !== false; });
on.onchange = async () => { await chrome.storage.local.set({ enabled: on.checked }); chrome.runtime.sendMessage({ cmd: 'badge' }); };
run.onclick = async () => { run.disabled = true; run.textContent = 'جاري السحب…'; await chrome.runtime.sendMessage({ cmd: 'run' }); run.disabled = false; run.textContent = 'سحب دلوقتي'; };
chrome.storage.onChanged.addListener(refresh);
refresh(); setInterval(refresh, 30e3);
