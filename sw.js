const CACHE_NAME = "jumpxman-v2.1.0";
const APP_SHELL = "./index.html?v=2.1.0";

const LOCAL_FILES = [
  "./",
  APP_SHELL,
  "./style.css?v=2.1.0",
  "./app.js?v=2.1.0",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(LOCAL_FILES))
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      const oldCaches = keys.filter(
        (key) =>
          key.startsWith("jumpxman-") &&
          key !== CACHE_NAME
      );

      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();

      if (oldCaches.length > 0) {
        const windows =
          await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true
          });

        await Promise.all(
          windows.map(async (client) => {
            try {
              await client.navigate(client.url);
            } catch (error) {
              console.warn(
                "Halaman tidak dapat dimuat semula:",
                error
              );
            }
          })
        );
      }
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(
    event.request.url
  );

  if (
    event.request.method !== "GET" ||
    requestUrl.origin !== self.location.origin
  ) {
    return;
  }

  if (
    requestUrl.pathname.endsWith("/version.json")
  ) {
    event.respondWith(
      fetch(event.request, {
        cache: "no-store"
      })
    );

    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();

          caches
            .open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, copy);
            });

          return response;
        })
        .catch(async () => {
          const cachedPage =
            await caches.match(event.request);

          return (
            cachedPage ||
            caches.match(APP_SHELL)
          );
        })
    );

    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      async (cachedFile) => {
        if (cachedFile) {
          return cachedFile;
        }

        const response =
          await fetch(event.request);

        const copy = response.clone();

        caches
          .open(CACHE_NAME)
          .then((cache) => {
            cache.put(event.request, copy);
          });

        return response;
      }
    )
  );
});