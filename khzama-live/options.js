const key = document.getElementById('key'), keyState = document.getElementById('keyState'), box = document.getElementById('status');
async function showKey() { const { apiKey } = await chrome.storage.local.get('apiKey'); keyState.textContent = apiKey ? 'فيه مفتاح متخزن ✓ (اكتب واحد جديد لو عايز تغيّره)' : 'مفيش مفتاح لسه'; }
document.getElementById('save').onclick = async () => {
  const v = key.value.trim();
  if (!/^gad_[A-Za-z0-9_-]{20,}$/.test(v)) { keyState.textContent = 'المفتاح لازم يبدأ بـ gad_'; return; }
  await chrome.storage.local.set({ apiKey: v, fails: 0, nextTryAt: 0, lastError: null });
  key.value = ''; await showKey();
  chrome.runtime.sendMessage({ cmd: 'run' });
};
chrome.storage.onChanged.addListener(() => renderStatus(box));
showKey(); renderStatus(box);
