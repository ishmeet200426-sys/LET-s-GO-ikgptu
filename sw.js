// Service worker: lets the app load faster on repeat visits by
// caching the core files. This is what makes it feel "app-like"
// instead of reloading everything from the internet every time.

const CACHE_NAME = "campus-nav-v1";

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
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(FILES_TO_CACHE);
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
