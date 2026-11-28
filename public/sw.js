/* MARFIM Studio OS — service worker.
   1) Push: recebe notificações e abre o app ao tocar.
   2) Agenda offline: guarda SÓ a última versão das páginas da agenda (nunca financeiro, clientes ou relatórios)
      e os arquivos estáticos do app, para a agenda do dia abrir sem internet. Ao sair da conta, o cache é apagado. */
const PAGES = "marfim-agenda-v1";
const ASSETS = "marfim-assets-v2"; // v2: ícones com o logo da Eagle

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (![PAGES, ASSETS].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isAgenda = (url) => url.pathname === "/agenda";
const isAsset = (url) => url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // saiu da conta (ou sessão expirou): nada de agenda guardada neste aparelho
  if (req.mode === "navigate" && url.pathname.startsWith("/login")) {
    event.waitUntil(caches.delete(PAGES));
    return;
  }

  if (isAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSETS);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }

  if (req.mode === "navigate" && isAgenda(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(PAGES);
      try {
        const res = await fetch(req);
        // só guarda a página da agenda de verdade (não um redirecionamento para o login)
        if (res.ok && !res.redirected) {
          await cache.put(req, res.clone());
          if (url.search) await cache.put(new Request(url.origin + "/agenda"), res.clone());
        }
        return res;
      } catch {
        return (await cache.match(req)) || (await cache.match(url.origin + "/agenda")) || Response.error();
      }
    })());
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "logout") event.waitUntil(caches.delete(PAGES));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  const title = data.title || "MARFIM";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "Você tem um novo aviso.",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: data.tag || "marfim",
      data: { url: data.url || "/notificacoes" },
      requireInteraction: data.severity === "critico",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/notificacoes", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); }
      return self.clients.openWindow(url);
    }),
  );
});
