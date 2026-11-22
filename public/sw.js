/* MARFIM Studio OS — service worker: recebe notificações push e abre o app ao tocar. Sem cache de páginas (dados financeiros). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
