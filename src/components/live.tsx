"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Agenda ao vivo: enquanto a tela está visível, consulta a "versão" da agenda a cada 20 s.
 * Se outro aparelho mudou algo, recarrega os dados da página (sem perder a rolagem) e mostra um aviso curto.
 * Não atualiza enquanto a pessoa está digitando ou arrastando um horário.
 */
export function LiveAgenda({ every = 20000 }: { every?: number }) {
  const router = useRouter();
  const last = useRef<string | null>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const busy = () => {
      const a = document.activeElement;
      return !!document.querySelector(".dragging, [data-dragging='true']") || (a instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    };
    const tick = async () => {
      if (stop) return;
      if (document.visibilityState === "visible" && navigator.onLine) {
        try {
          const r = await fetch("/api/agenda/versao", { cache: "no-store" });
          if (r.ok) {
            const { v } = (await r.json()) as { v: string };
            if (last.current !== null && v !== last.current && !busy()) {
              router.refresh();
              setFlash(true);
              setTimeout(() => setFlash(false), 3500);
            }
            if (!busy()) last.current = v;
          }
        } catch { /* sem rede: tenta de novo depois */ }
      }
      timer = setTimeout(tick, every);
    };
    const onVis = () => { if (document.visibilityState === "visible") { clearTimeout(timer); tick(); } };
    tick();
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [every, router]);
  return flash ? <div className="livetoast" role="status">Agenda atualizada</div> : null;
}

/** Aviso de modo offline: mostra quando o aparelho perde a conexão. */
export function OfflineBanner() {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOff(!navigator.onLine), 0);
    // service worker: agenda disponível sem internet (e push). Falha aqui nunca atrapalha o uso.
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const on = () => setOff(false), offf = () => setOff(true);
    window.addEventListener("online", on); window.addEventListener("offline", offf);
    return () => { clearTimeout(t); window.removeEventListener("online", on); window.removeEventListener("offline", offf); };
  }, []);
  return off ? <div className="offbar" role="status">Sem conexão. Você está vendo a última agenda carregada; alterações ficam disponíveis quando a conexão voltar.</div> : null;
}

/** Na tela de login: apaga a agenda guardada para uso offline (saída da conta ou sessão expirada). */
export function ClearOfflineCache() {
  useEffect(() => {
    try { navigator.serviceWorker?.controller?.postMessage("logout"); } catch { /* sem service worker */ }
    if ("caches" in window) caches.delete("marfim-agenda-v1").catch(() => {});
  }, []);
  return null;
}
