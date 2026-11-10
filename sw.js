/* GADLYTICS service worker — التنبيهات بس (push + الضغط على التنبيه).
   مفيش fetch handler ولا كاش خالص: التطبيق دايماً بيحمّل آخر نسخة من الموقع. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "GADLYTICS", {
    body: d.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png", lang: "ar", dir: "rtl",
    tag: d.tag || undefined, renotify: !!d.tag, silent: !!d.silent, data: { url: d.url || "./?p=campperf" }
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./?p=campperf", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    for (const w of ws) { if ("focus" in w) { try { w.navigate(url); } catch (_) {} return w.focus(); } }
    return self.clients.openWindow(url);
  }));
});
