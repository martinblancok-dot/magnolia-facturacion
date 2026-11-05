// Guarda la pantalla de caja y sus archivos para que abra aunque no haya internet.
const VERSION = "magnolia-caja-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then((c) => c.add("/caja").catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

const conTiempo = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("tiempo")), ms))]);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  // Archivos de la app (no cambian): primero lo guardado
  if (url.pathname.startsWith("/_next/static/") || /\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const guardado = await cache.match(req);
      if (guardado) return guardado;
      const r = await fetch(req);
      if (r.ok) cache.put(req, r.clone());
      return r;
    })());
    return;
  }

  // La pantalla de caja: primero internet, y si no hay, la última guardada
  if (req.mode === "navigate" && url.pathname === "/caja") {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const r = await conTiempo(fetch(req), 5000);
        if (r.ok && !r.redirected) cache.put("/caja", r.clone());
        return r;
      } catch {
        return (await cache.match("/caja")) || new Response("Sin conexión y la caja todavía no se abrió nunca en esta compu.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
  }
});
