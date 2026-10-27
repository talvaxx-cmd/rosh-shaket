/* ראש שקט — service worker: offline app shell + notification actions. */
const CACHE = "rosh-shaket-v2";
const SHELL = ["/", "/add", "/calendar", "/tasks", "/settings", "/icon.svg", "/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Pages: network first, cached shell when offline. Static assets: cache first.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/"))),
    );
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || /\.(?:svg|png|webmanifest|css|js|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});

// Reminders pushed by the server — arrive even when the app is closed.
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {}
  const options = {
    body: d.body || "",
    tag: d.tag,
    lang: "he",
    dir: "rtl",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: d.url || "/", reminderId: d.reminderId },
  };
  if (d.reminderId) {
    options.actions = [
      { action: "done", title: "בוצע" },
      { action: "snooze", title: "דחה ב־10 דק׳" },
    ];
  }
  event.waitUntil(self.registration.showNotification(d.title || "ראש שקט", options));
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  const action = event.action || "open";
  event.notification.close();
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (action !== "open" && data.reminderId) {
        // An open app handles the action directly; otherwise open the app to do it.
        if (all.length) {
          for (const c of all) c.postMessage({ type: "notification-action", action, reminderId: data.reminderId });
          return;
        }
        await self.clients.openWindow(`/?na=${encodeURIComponent(action)}&nr=${encodeURIComponent(data.reminderId)}`);
        return;
      }
      for (const c of all) c.postMessage({ type: "notification-action", action: "open", reminderId: data.reminderId });
      const target = data.url || "/";
      const existing = all[0];
      if (existing) {
        await existing.focus();
        if ("navigate" in existing) await existing.navigate(target).catch(() => undefined);
      } else {
        await self.clients.openWindow(target);
      }
    })(),
  );
});
