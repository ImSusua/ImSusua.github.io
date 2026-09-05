/* Service Worker：静态资源缓存 + 更新 */
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
  // 更新清单/API 永远走网络
  if (url.pathname.startsWith("/api/")) return;
  if (e.request.method !== "GET") return;

  // 静态资源：stale-while-revalidate（快速响应 + 后台更新）
  if (url.pathname.startsWith("/") || url.pathname === "/") {
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

  // 其它请求走网络
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});