"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { addOrderPhotosAction, signOrderAction } from "@/app/actions/eagle";

/** Reduz a foto do celular (que costuma ter 4 a 12 MB) para no máximo 1600 px em JPEG: sobe rápido e cabe na ficha. */
async function shrink(file: File, max = 1600): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Escolha uma imagem.");
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b ?? file), "image/jpeg", 0.8));
}

/** Fotos de antes e depois do serviço: tirar na hora (câmera do celular) ou escolher da galeria. */
export function PhotoUpload({ orderId }: { orderId: string }) {
  const [stage, setStage] = useState("Antes");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, start] = useTransition();
  const send = (files: FileList | null) => {
    if (!files?.length) return;
    setMsg(files.length === 1 ? "Preparando a foto…" : `Preparando ${files.length} fotos…`);
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("id", orderId); fd.set("stage", stage); fd.set("note", note);
        for (const f of [...files].slice(0, 10)) fd.append("photos", new File([await shrink(f)], f.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
        setMsg("Enviando…");
        await addOrderPhotosAction(fd);
      } catch (e) {
        if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
        setMsg("Não foi possível enviar. Tente de novo.");
      }
    });
  };
  return (
    <div className="stack">
      <div className="fields">
        <label>Momento<select value={stage} onChange={(e) => setStage(e.target.value)}><option>Antes</option><option>Depois</option><option value="Foto">Outra</option></select></label>
        <label>Local (opcional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: cozinha, ralo do banheiro" maxLength={80} /></label>
      </div>
      <div className="row">
        <label className="btn" aria-disabled={busy}>Tirar foto<input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={(e) => { send(e.target.files); e.target.value = ""; }} /></label>
        <label className="btn ghost" aria-disabled={busy}>Escolher da galeria<input type="file" accept="image/*" multiple hidden disabled={busy} onChange={(e) => { send(e.target.files); e.target.value = ""; }} /></label>
        {msg && busy ? <small aria-live="polite">{msg}</small> : msg && !busy ? <small className="muted" aria-live="polite">{msg}</small> : null}
      </div>
    </div>
  );
}

/** Assinatura do cliente com o dedo, na tela do celular. */
export function SignaturePad({ orderId, signer }: { orderId: string; signer?: string | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const data = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const empty = useRef(true); // ref: a conferência no envio vê o traço mesmo antes de a tela redesenhar
  const setEmpty = (v: boolean) => { empty.current = v; };

  useEffect(() => {
    const c = canvas.current!;
    const fit = () => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      const g = c.getContext("2d")!;
      g.scale(dpr, dpr);
      g.lineWidth = 2.2; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#111";
      setEmpty(true);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  const clear = () => { const c = canvas.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setEmpty(true); };

  return (
    <form action={signOrderAction} className="sigpad" onSubmit={(e) => {
      if (empty.current) { e.preventDefault(); alert("Peça para o cliente assinar no quadro."); return; }
      data.current!.value = canvas.current!.toDataURL("image/png");
    }}>
      <input type="hidden" name="id" value={orderId} />
      <input ref={data} type="hidden" name="signature" />
      <canvas ref={canvas} aria-label="Quadro para a assinatura do cliente"
        onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ponteiro já solto */ } drawing.current = true; const g = e.currentTarget.getContext("2d")!; const [x, y] = pos(e); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.1, y + 0.1); g.stroke(); setEmpty(false); }}
        onPointerMove={(e) => { if (!drawing.current) return; const g = e.currentTarget.getContext("2d")!; const [x, y] = pos(e); g.lineTo(x, y); g.stroke(); }}
        onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} />
      <div className="fields">
        <label>Nome de quem assinou<input name="signer" defaultValue={signer ?? ""} required minLength={2} placeholder="Nome do cliente ou responsável" /></label>
      </div>
      <div className="row">
        <button className="btn accent" type="submit">Salvar assinatura</button>
        <button className="btn ghost" type="button" onClick={clear}>Limpar</button>
      </div>
    </form>
  );
}
