const CACHE = "pg-role-grantor-v9";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./icon.svg",
  "./src/catalog.js",
  "./src/generator.js",
  "./src/app.js",
  "./src/plan-review.js",
  "./src/verification.js",
  "./src/sql-input.js",
  "./src/fdw.js",
  "./src/form-fields.js",
  "./src/fdw-form.js",
  "./src/password.js",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("pg-role-grantor-") && key !== CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    !event.request.url.startsWith(self.registration.scope)
  )
    return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((hit) => hit || Response.error()),
    ),
  );
});
