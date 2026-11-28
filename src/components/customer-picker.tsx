"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface PickerCustomer { id: string; name: string; phone: string | null; trade_name?: string | null; contact_name?: string | null; address?: string | null }

const key = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Campo de cliente com busca: digite parte do nome, fantasia, contato, endereço ou telefone (com ou sem hífen e acentos).
 * Envia o id no campo `name`. Mostra até 30 resultados de cada vez, então funciona bem com milhares de clientes.
 */
export function CustomerPicker({ customers, name = "customerId", defaultValue, required, onChange, newHref, autoFocus, label = "Cliente" }: {
  customers: PickerCustomer[]; name?: string; defaultValue?: string | null; required?: boolean; onChange?: (id: string) => void; newHref?: string; autoFocus?: boolean; label?: string;
}) {
  const list = useId();
  const [id, setId] = useState(defaultValue ?? "");
  const current = customers.find((c) => c.id === id);
  const [text, setText] = useState(current?.name ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  // obrigatório: texto digitado sem escolher da lista não vale
  useEffect(() => { input.current?.setCustomValidity(required && !id ? "Escolha um cliente da lista." : ""); }, [required, id]);

  const index = useMemo(() => customers.map((c) => ({ c, k: key([c.name, c.trade_name, c.contact_name, c.address].filter(Boolean).join(" ")), d: digits(c.phone ?? "") })), [customers]);
  const results = useMemo(() => {
    const t = key(text.trim());
    if (!t || (current && text === current.name)) return index.slice(0, 30).map((x) => x.c);
    const words = t.split(/\s+/);
    const num = digits(t);
    return index.filter((x) => words.every((w) => x.k.includes(w)) || (num.length >= 3 && x.d.includes(num))).slice(0, 30).map((x) => x.c);
  }, [index, text, current]);

  const choose = (c: PickerCustomer) => {
    setId(c.id); setText(c.name); setOpen(false);
    onChange?.(c.id);
  };
  // formulário devolvido depois de um erro: volta o cliente que estava escolhido
  const chooseRef = useRef(choose);
  useEffect(() => { chooseRef.current = choose; });
  useEffect(() => {
    const el = hidden.current;
    if (!el) return;
    const on = (e: Event) => { const c = customers.find((x) => x.id === (e as CustomEvent<string>).detail); if (c) chooseRef.current(c); };
    el.addEventListener("fg:restore", on);
    return () => el.removeEventListener("fg:restore", on);
  }, [customers]);

  return (
    <div className="cpick lbl" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <span>{label}</span>
      <input ref={hidden} type="hidden" name={name} value={id} />
      <input
        ref={input} type="search" role="combobox" aria-expanded={open} aria-controls={list} aria-autocomplete="list" aria-label={label} autoComplete="off" autoFocus={autoFocus}
        placeholder="Digite o nome, a fantasia ou o telefone" value={text}
        onFocus={(e) => { setOpen(true); e.currentTarget.select(); }}
        onChange={(e) => {
          setText(e.target.value); setOpen(true); setActive(0);
          if (id) { setId(""); onChange?.(""); }
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && open && results[active]) { e.preventDefault(); choose(results[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open ? (
        <ul className="cpick-list" id={list} role="listbox">
          {results.length === 0 ? <li className="cpick-none">Nenhum cliente encontrado.{newHref ? <> <a href={newHref}>Cadastrar novo</a></> : null}</li> : results.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === active || c.id === id} tabIndex={-1}
              className={i === active ? "on" : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(c)} onMouseEnter={() => setActive(i)}>
              <b>{c.name}</b>
              <small>{[c.trade_name && c.trade_name !== c.name ? c.trade_name : null, c.phone, c.contact_name].filter(Boolean).join(" · ") || "sem telefone"}</small>
            </li>
          ))}
        </ul>
      ) : null}
      {current ? <small className="cpick-sel">{[current.phone, current.address].filter(Boolean).join(" · ")}</small> : null}
    </div>
  );
}
