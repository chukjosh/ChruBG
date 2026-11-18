// Service worker: lets ChruBG be installed and work offline.
// The page files are fetched fresh when online and cached copies are used offline.
// Models and CDN libraries are cached after their first download. The API is never cached.

const CACHE_NAME = "chrubg-v2";
const APP_SHELL = [
  "/", "/index.html", "/video.html", "/styles.css", "/theme.js", "/pwa.js", "/app.js", "/edges.js", "/export.js",
  "/browser-engine.js", "/device-hints.js", "/compare-models.js", "/crop-math.js", "/crop-editor.js", "/editor.js", "/tour.js", "/video.js",
  "/favicon.svg", "/favicon.ico", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest",
];
const CACHE_FIRST_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

async function saveCopy(request, response) {
  if (response.ok || response.type === "opaque") {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  return cached || saveCopy(request, await fetch(request));
}

async function networkFirst(request) {
  try {
    return await saveCopy(request, await fetch(request));
  } catch (offlineError) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === "navigate") return caches.match("/");
    throw offlineError;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;

  const url = new URL(request.url);
  const isSameSite = url.origin === self.location.origin;
  if (isSameSite && url.pathname.startsWith("/api/")) return; // the API is never cached

  if (isSameSite && url.pathname.startsWith("/models/")) event.respondWith(cacheFirst(request));
  else if (CACHE_FIRST_HOSTS.includes(url.hostname)) event.respondWith(cacheFirst(request));
  else if (isSameSite) event.respondWith(networkFirst(request));
});
