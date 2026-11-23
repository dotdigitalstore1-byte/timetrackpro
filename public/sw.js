// Dotinout service worker.
// - Static, immutable assets (JS/CSS chunks, icons): cache-first.
// - Pages: network-first. The last good copy is kept in a separate page cache so the app shell opens offline.
//   That cache is cleared on sign-out (see clearOfflineCache), because pages contain per-user data.
// - API responses are never cached here. Offline data is cached explicitly by the app (src/lib/offline) and
//   offline writes are queued with idempotency keys.
const CACHE = "dotinout-v6";
// v2 of the page cache: any page cached by an older build is discarded on activate.
const PAGES = "dotinout-pages-v2";
// Gate and entry pages are never cached. A cached copy of one of them could show the wrong screen on reopen.
const NEVER_CACHE = ["/", "/open", "/login", "/get-app", "/app-restricted", "/unavailable", "/billing", "/register", "/forgot-password"];
const isNeverCached = (pathname) =>
  NEVER_CACHE.some((p) => pathname === p || pathname.startsWith(`${p}/`));
const KEEP = [CACHE, PAGES];
const STATIC = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Allow the page to activate a newly deployed service worker immediately.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

const OFFLINE_PAGE =
  "<!doctype html><meta name=viewport content='width=device-width,viewport-fit=cover'><body style='font-family:sans-serif;padding:2rem;text-align:center'><h2>You are offline</h2><p>Open a page you have visited before, or reconnect to see the latest data.</p>";

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

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only keep a plain successful page (not a redirect), so an offline visit never lands on a login loop.
          if (res.ok && !res.redirected && !isNeverCached(url.pathname)) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const saved = await caches.match(req, { cacheName: PAGES });
          if (saved) return saved;
          return new Response(OFFLINE_PAGE, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
            status: 503,
          });
        })
    );
  }
});
