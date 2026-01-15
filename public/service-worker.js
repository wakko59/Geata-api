const CACHE_NAME = "geata-app-cache-v3";

// Files to cache for offline shell
const APP_SHELL = [
  "/app.html",
  "/admin.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// Install: pre-cache core assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    }),
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
    }),
  );
  self.clients.claim();
});

// Fetch: cache-first for app shell, network-first for others
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET requests
  if (req.method !== "GET") {
    return;
  }

  // Same-origin only
  if (url.origin !== self.location.origin) {
    return;
  }

  const isShell =
    url.pathname === "/" ||
    url.pathname === "/app.html" ||
    url.pathname === "/admin.html" ||
    url.pathname === "/manifest.json" ||
    url.pathname.startsWith("/icons/");

  if (isShell) {
    // cache-first for shell assets
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        });
      }),
    );
    return;
  }

  // For everything else (including API calls), just go to network.
  // The app JS already shows "Network error" when fetch fails.
  // You COULD add cache fallback here if you want.
});
