// Service worker: lets the app load faster on repeat visits by
// caching the core files. This is what makes it feel "app-like"
// instead of reloading everything from the internet every time.

// IMPORTANT: bump this version number any time you change index.html,
// script.js, style.css, or other cached files. Otherwise returning
// visitors will keep seeing an old frozen copy forever.
const CACHE_NAME = "campus-nav-v7";

const FILES_TO_CACHE = [
    "./",
    "./index.html",
    "./style.css",
    "./script.js",
    "./manifest.json",
    "./icon-192.png",
    "./icon-512.png"
];

self.addEventListener("install", function(event) {
    self.skipWaiting(); // activate the new service worker immediately
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(FILES_TO_CACHE);
        })
    );
});

self.addEventListener("activate", function(event) {
    // Delete any old, outdated caches so users stop getting stale pages
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames
                    .filter(function(name) { return name !== CACHE_NAME; })
                    .map(function(name) { return caches.delete(name); })
            );
        }).then(function() {
            return self.clients.claim(); // take control of open tabs right away
        })
    );
});

self.addEventListener("fetch", function(event) {
    event.respondWith(
        caches.match(event.request).then(function(response) {
            // Serve from cache if available, otherwise fetch from network
            return response || fetch(event.request);
        })
    );
});