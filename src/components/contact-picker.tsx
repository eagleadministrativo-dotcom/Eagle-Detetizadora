"use client";
import { useRef, useState } from "react";
import { contactsApi, useHasContactsApi } from "./customer-import";
import { normalizePhone } from "@/lib/contact-import";

/** Preenche nome e telefone do formulário com um contato escolhido na agenda do celular (Chrome no Android). */
export function ContactPicker() {
  const box = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState("");
  const supported = useHasContactsApi();
  async function pick() {
    setNote("");
    const api = contactsApi();
    if (!api) return;
    try {
      const [c] = await api.select(["name", "tel"], { multiple: false });
      if (!c) return;
      const form = box.current?.closest("form");
      const set = (n: string, v: string) => { const el = form?.querySelector<HTMLInputElement>(`input[name="${n}"]`); if (el) el.value = v; };
      set("name", (c.name?.[0] ?? "").trim());
      const phone = (c.tel ?? []).map(normalizePhone).find(Boolean);
      set("phone", phone ?? "");
      if (!phone) setNote("Esse contato não tem telefone com DDD; preencha à mão.");
    } catch { /* cancelado */ }
  }
  return (
    <div className="contact-picker" ref={box}>
      <button type="button" className="btn ghost" onClick={() => void pick()} disabled={!supported}>Buscar nos contatos do celular</button>
      <small>{note || (supported ? "Escolha um contato da agenda para preencher nome e telefone." : "A busca na agenda funciona no Chrome do Android. Em outros aparelhos, use Importar de arquivo.")}</small>
    </div>
  );
}
