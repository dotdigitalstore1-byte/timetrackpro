// Network-first for pages (so new deployments are never hidden behind a stale cache),
// cache-first only for immutable static assets. API calls and authenticated HTML are never cached.
const CACHE = "timetrack-v3";
const STATIC = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Allow the page to activate a newly deployed service worker immediately.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never cache API / photos / salary data

  const immutable = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
  if (immutable) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // Pages: always try the network; fall back to a tiny offline notice.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response(
            "<!doctype html><meta name=viewport content='width=device-width'><body style='font-family:sans-serif;padding:2rem;text-align:center'><h2>You are offline</h2><p>TimeTrack needs a connection to punch in and show salary data. Please reconnect and try again.</p>",
            { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 }
          )
      )
    );
  }
});
