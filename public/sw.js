// Guarda la pantalla de caja y sus archivos para que abra aunque no haya internet.
const VERSION = "magnolia-caja-v1";
// Miniaturas de productos: se guardan en la compu la primera vez que se ven, así la caja las muestra sin internet
const FOTOS = "magnolia-fotos-v1";
const MAX_FOTOS = 6000;

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then((c) => c.add("/caja").catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== FOTOS) await caches.delete(k);
    await self.clients.claim();
  })());
});

const conTiempo = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("tiempo")), ms))]);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Miniaturas: las del sistema y las que vienen de la CDN de Tiendanube (para verlas sin internet)
  if (req.method === "GET" && (url.pathname.includes("/storage/v1/object/public/productos-miniaturas/") || /(^|\.)mitiendanube\.com$/.test(url.hostname))) {
    e.respondWith((async () => {
      const cache = await caches.open(FOTOS);
      const guardada = await cache.match(req);
      if (guardada) return guardada;
      try {
        const r = await conTiempo(fetch(req), 8000);
        // (respuestas "opacas" de otra dirección también se pueden guardar)
        if (r.ok || r.type === "opaque") {
          await cache.put(req, r.clone());
          const claves = await cache.keys();
          if (claves.length > MAX_FOTOS) for (const k of claves.slice(0, claves.length - MAX_FOTOS)) await cache.delete(k);
        }
        return r;
      } catch {
        return new Response("", { status: 504 }); // la caja muestra el ícono gris
      }
    })());
    return;
  }
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
