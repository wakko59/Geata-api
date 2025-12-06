// Simple service worker for Gate PWA

const CACHE_NAME = 'gate-app-cache-v1';

// Add any static files your app needs to run
const ASSETS_TO_CACHE = [
  '/',
  '/app.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
  // add '/app.js', '/app.css', etc. if you have them
];

// Install: cache the app "shell"
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
});

// Fetch: cache-first for static, network for API
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // If it's an API call (adjust this if needed)
  if (url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/devices') ||
      url.pathname.startsWith('/me/') ||
      url.pathname.startsWith('/device/poll') ||
      url.pathname.startsWith('/commands') ||
      url.pathname.startsWith('/users')) {
    // Network-first for dynamic/API
    event.respondWith(
      fetch(event.request).catch(() => {
        // Optional: fallback if offline
        return new Response(
          JSON.stringify({ error: 'Offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // For everything else (app shell), cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request);
    })
  );
});
