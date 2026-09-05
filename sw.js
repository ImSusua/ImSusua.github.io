/* Service Worker锛氶潤鎬佽祫婧愮紦瀛?+ 鏇存柊 */
"use strict";

const CACHE = "sc-cache-v1";
const STATIC = [
  "/",
  "/index.html",
  "/style.css",
  "/manifest.json",
  "/icons/icon.svg",
  "/js/nbt.js",
  "/js/converter.js",
  "/js/update.js",
  "/js/app.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // 鏇存柊娓呭崟/API 姘歌繙璧扮綉缁?  if (url.pathname.startsWith("/api/")) return;
  if (e.request.method !== "GET") return;

  // 闈欐€佽祫婧愶細stale-while-revalidate锛堝揩閫熷搷搴?+ 鍚庡彴鏇存柊锛?  if (url.pathname.startsWith("/") || url.pathname === "/") {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        const network = fetch(e.request).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 鍏跺畠璇锋眰璧扮綉缁?  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});