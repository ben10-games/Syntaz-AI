// Syntaz desktop app (the website installed as an app): keeps the chat and its icons on this computer, so the app
// opens even when the internet is slow or off. Pages always come fresh when online; the AI calls never go through here.
"use strict";
const CACHE = "syntaz-app-2.1.1";
const SHELL = ["chat.html", "icon.svg", "icon-192.png", "icon-512.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) =>
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())),
);
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // AI requests go straight to the AI
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || (e.request.mode === "navigate" ? caches.match("chat.html") : Response.error()))),
  );
});
