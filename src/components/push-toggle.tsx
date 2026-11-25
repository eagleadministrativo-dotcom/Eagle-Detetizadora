"use client";
import { useEffect, useState } from "react";

type State = "loading" | "unsupported" | "ios-install" | "server-off" | "blocked" | "off" | "on" | "busy";

function urlBase64ToUint8Array(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Liga/desliga as notificações push neste aparelho. Só funciona em HTTPS e com o app instalado no iPhone. */
export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const ua = navigator.userAgent;
      const isIos = /iphone|ipad|ipod/i.test(ua);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(isIos && !standalone ? "ios-install" : "unsupported");
        return;
      }
      try {
        const info = await (await fetch("/api/push", { cache: "no-store" })).json();
        if (!info.enabled) return setState("server-off");
        if (Notification.permission === "denied") return setState("blocked");
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        setState(sub && Notification.permission === "granted" ? "on" : "off");
      } catch {
        setState("unsupported");
      }
    })();
  }, []);

  async function enable() {
    setState("busy");
    setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "blocked" : "off");
      const info = await (await fetch("/api/push", { cache: "no-store" })).json();
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(info.publicKey) }));
      const res = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Falha ao registrar este aparelho.");
      setState("on");
    } catch (e) {
      setMsg((e as Error).message || "Não foi possível ativar as notificações.");
      setState("off");
    }
  }

  async function disable() {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setMsg("Não foi possível desativar agora.");
      setState("on");
    }
  }

  if (state === "loading") return <small>Verificando este aparelho…</small>;
  return (
    <div className="stack">
      {state === "on" ? <p><span className="badge ok">Ativas neste aparelho</span></p> : <p><span className="badge warn">Desativadas neste aparelho</span></p>}
      {state === "off" || state === "busy" ? <div><button className="btn accent" type="button" onClick={enable} disabled={state === "busy"}>Ativar notificações</button></div> : null}
      {state === "on" ? <div><button className="btn ghost" type="button" onClick={disable}>Desativar neste aparelho</button></div> : null}
      {state === "blocked" ? <small>As notificações estão bloqueadas neste navegador. Libere em Configurações do site (cadeado ao lado do endereço) e recarregue a página.</small> : null}
      {state === "ios-install" ? <small>No iPhone, instale o app primeiro: toque em Compartilhar e em &quot;Adicionar à Tela de Início&quot;, abra o ícone Eagle e volte a esta página.</small> : null}
      {state === "unsupported" ? <small>Este navegador não oferece notificações. Use o Chrome (Android ou computador) ou instale o app no iPhone (iOS 16.4 ou mais novo).</small> : null}
      {state === "server-off" ? <small>As notificações ainda não foram configuradas no servidor.</small> : null}
      {msg ? <small role="alert">{msg}</small> : null}
    </div>
  );
}
