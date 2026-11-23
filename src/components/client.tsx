"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { saveThemeAction } from "@/app/actions/account";

type Theme = "auto" | "claro" | "escuro";

function applyTheme(v: Theme) {
  if (v === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", v === "claro" ? "light" : "dark");
}

export function ThemePicker({ initial }: { initial: Theme }) {
  const [t, setT] = useState<Theme>(initial);
  const pick = (v: Theme) => {
    setT(v);
    applyTheme(v);
    void saveThemeAction(v);
  };
  return (
    <div className="themepick" role="group" aria-label="Tema">
      {([["claro", "sun", "Claro"], ["auto", "auto", "Automático"], ["escuro", "moon", "Escuro"]] as const).map(([v, ic, label]) => (
        <button key={v} type="button" aria-pressed={t === v} aria-label={label} title={label} onClick={() => pick(v)}><Icon name={ic} /></button>
      ))}
    </div>
  );
}

/** Luz localizada que segue o ponteiro nos cards (um ouvinte só, sem renderizar). */
export function Spotlight() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover)").matches) return;
    const on = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>("[data-spot], .kpi");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    document.addEventListener("pointermove", on, { passive: true });
    return () => document.removeEventListener("pointermove", on);
  }, []);
  return null;
}

interface Hit { type: string; title: string; sub: string; href: string }
export function CommandPalette({ actions }: { actions: Hit[] }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const router = useRouter();
  const open = () => { setQ(""); setHits([]); setSel(0); dlg.current?.showModal(); };
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open(); } };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ac.signal }).then((r) => (r.ok ? r.json() : { hits: [] })).then((d) => { setHits(d.hits); setSel(0); }).catch(() => {});
    }, 180);
    return () => { clearTimeout(t); ac.abort(); };
  }, [q]);
  const term = q.trim().toLowerCase();
  const list = [...actions.filter((a) => !term || a.title.toLowerCase().includes(term)), ...(term.length >= 2 ? hits : [])];
  const go = (h: Hit) => { dlg.current?.close(); router.push(h.href); };
  return (
    <>
      <button type="button" className="searchbtn" onClick={open} aria-label="Pesquisar e ações rápidas"><Icon name="search" /><span>Pesquisar ou criar</span><kbd>Ctrl K</kbd></button>
      <dialog ref={dlg} className="palette" aria-label="Pesquisar e ações rápidas" onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar cliente, tarefa, produto…" aria-label="Pesquisar" role="combobox" aria-expanded="true" aria-controls="palette-list"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, list.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === "Enter" && list[sel]) { e.preventDefault(); go(list[sel]); }
          }} />
        <ul id="palette-list" role="listbox">
          {list.length === 0 ? <li className="grp">Nada encontrado.</li> : null}
          {list.map((h, i) => (
            <li key={h.href + h.title} role="presentation">
              {i === 0 || list[i - 1].type !== h.type ? <div className="grp">{h.type}</div> : null}
              <Link role="option" aria-selected={i === sel} href={h.href} prefetch={false} onMouseEnter={() => setSel(i)} onClick={() => dlg.current?.close()}>{h.title}<small>{h.sub}</small></Link>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}

/** Abre o WhatsApp com a mensagem editável. Não registra nada: o registro é um passo à parte, feito por quem contatou. */
export function WhatsAppMessage({ phone, text }: { phone: string; text: string }) {
  const [v, setV] = useState(text);
  return (
    <div className="stack">
      <label>Mensagem (edite antes de enviar)<textarea value={v} onChange={(e) => setV(e.target.value)} maxLength={1000} /></label>
      <a className="btn accent" href={`https://wa.me/${phone}?text=${encodeURIComponent(v)}`} target="_blank" rel="noopener noreferrer">Abrir no WhatsApp</a>
    </div>
  );
}

const DOW = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
export function FrequencyFields({ label = "Frequência", none, daily = false, initial = "" }: { label?: string; none?: string; daily?: boolean; initial?: string }) {
  const [f, setF] = useState(initial);
  return (
    <div className="fields">
      <label>{label}
        <select name="freq" value={f} onChange={(e) => setF(e.target.value)}>
          {none ? <option value="">{none}</option> : null}
          {daily ? <option value="diario">Diária</option> : null}
          <option value="semanal">Semanal</option><option value="quinzenal">Quinzenal</option><option value="mensal">Mensal</option>
          <option value="dias">A cada X dias</option><option value="semanas">A cada X semanas</option><option value="dia_semana">Dia da semana</option><option value="ordinal">Dia da semana no mês</option>
        </select>
      </label>
      {f === "dias" || f === "semanas" ? <label>{f === "dias" ? "Quantos dias" : "Quantas semanas"}<input name="freqN" type="number" min={1} max={365} defaultValue={f === "dias" ? 25 : 2} required /></label> : null}
      {f === "ordinal" ? <label>Qual<select name="freqOrd" defaultValue="1"><option value="1">Primeiro(a)</option><option value="2">Segundo(a)</option><option value="3">Terceiro(a)</option><option value="4">Quarto(a)</option><option value="-1">Último(a)</option></select></label> : null}
      {f === "dia_semana" || f === "ordinal" ? <label>Dia<select name="freqDow" defaultValue="3">{DOW.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label> : null}
    </div>
  );
}

/** Retorno programado no agendamento: separa preferência de retorno de horários confirmados. */
export function ReturnPlan() {
  const [mode, setMode] = useState("");
  return (
    <fieldset>
      <legend>Retorno programado</legend>
      <div className="form">
        <div className="chips">
          {[["", "Não programar"], ["pref", "Só lembrar (preferência)"], ["serie", "Reservar horários confirmados"]].map(([v, l]) => (
            <label className="chip" key={v}><input type="radio" name="plan" value={v} checked={mode === v} onChange={() => setMode(v)} />{l}</label>
          ))}
        </div>
        {mode ? <FrequencyFields initial="semanal" /> : null}
        {mode === "pref" ? <small>Nenhum horário é reservado. O cliente aparece em Retornos quando chegar a data.</small> : null}
        {mode === "serie" ? (
          <>
            <div className="fields">
              <label>Termina em (opcional)<input type="date" name="endDate" /></label>
              <label>Quantidade de horários (opcional)<input type="number" name="maxOcc" min={1} max={104} /></label>
            </div>
            <small>Sem data final, o sistema reserva até 90 dias à frente e continua a partir daí. O horário, o profissional e os serviços são os deste agendamento.</small>
            <label className="check"><input type="checkbox" name="confirmed" required />O cliente confirmou estes horários</label>
            <label>Como confirmou<input name="confirmedNote" placeholder="Ex.: presencialmente, por WhatsApp" minLength={3} required /></label>
          </>
        ) : null}
      </div>
    </fieldset>
  );
}

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const cents = (s: string) => { const n = Number(s.replace(/[R$\s.]/g, "").replace(",", ".")); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
export interface PickProduct { id: string; name: string; price: number; stock: number | null }
/** Seleção de produtos com subtotal. Os totais mostrados são conferência: o servidor recalcula tudo com o preço cadastrado. */
export function ProductPicker({ products, initial, discount = 0, reason = "", serviceCents, syncField }: { products: PickProduct[]; initial: { id: string; qty: number }[]; discount?: number; reason?: string; serviceCents?: number; syncField?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const auto = useRef<string | null>(null);
  const [items, setItems] = useState(initial);
  const [term, setTerm] = useState("");
  const [disc, setDisc] = useState(discount ? (discount / 100).toFixed(2).replace(".", ",") : "");
  const byId = new Map(products.map((p) => [p.id, p]));
  const found = term.trim() ? products.filter((p) => p.name.toLowerCase().includes(term.trim().toLowerCase()) && !items.some((i) => i.id === p.id)).slice(0, 6) : [];
  const gross = items.reduce((a, i) => a + (byId.get(i.id)?.price ?? 0) * i.qty, 0);
  const total = Math.max(0, gross - cents(disc || "0"));
  // o valor a receber acompanha o total enquanto o operador não o altera à mão
  useEffect(() => {
    const field = syncField ? root.current?.closest("form")?.querySelector<HTMLInputElement>(`[name="${syncField}"]`) : null;
    if (!field) return;
    const next = ((total + (serviceCents ?? 0)) / 100).toFixed(2).replace(".", ",");
    if (auto.current === null || field.value === auto.current) field.value = next;
    auto.current = next;
  }, [total, serviceCents, syncField]);
  return (
    <div className="form" ref={root}>
      <label>Buscar produto<input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Nome do produto" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (found[0]) { setItems([...items, { id: found[0].id, qty: 1 }]); setTerm(""); } } }} /></label>
      {found.length ? <div className="chips">{found.map((p) => <button key={p.id} type="button" className="chip" disabled={p.stock === 0} onClick={() => { setItems([...items, { id: p.id, qty: 1 }]); setTerm(""); }}>{p.name} · {brl(p.price)}{p.stock != null ? ` · ${p.stock} un.` : ""}</button>)}</div> : null}
      {items.map((i) => {
        const p = byId.get(i.id);
        if (!p) return null;
        return (
          <div className="prodline" key={i.id}>
            <input type="hidden" name="productId" value={i.id} />
            <span><b>{p.name}</b><br /><small>{brl(p.price)} cada</small></span>
            <input name="productQty" type="number" min={1} max={p.stock ?? 999} value={i.qty} aria-label={`Quantidade de ${p.name}`} onChange={(e) => setItems(items.map((x) => (x.id === i.id ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))} />
            <span className="mono right pr">{brl(p.price * i.qty)}</span>
            <button type="button" className="btn icon ghost" aria-label={`Remover ${p.name}`} onClick={() => setItems(items.filter((x) => x.id !== i.id))}>×</button>
          </div>
        );
      })}
      {items.length ? (
        <>
          <div className="fields">
            <label>Desconto nos produtos (R$)<input name="productDiscount" inputMode="decimal" value={disc} onChange={(e) => setDisc(e.target.value)} placeholder="0,00" /></label>
            {cents(disc || "0") > 0 ? <label>Motivo do desconto<input name="productReason" defaultValue={reason} minLength={3} required /></label> : null}
          </div>
          <div>
            <div className="sumrow"><span>Produtos</span><span className="mono">{brl(total)}</span></div>
            {serviceCents != null ? <><div className="sumrow"><span>Serviços</span><span className="mono">{brl(serviceCents)}</span></div><div className="sumrow big"><span>Total</span><span className="mono">{brl(total + serviceCents)}</span></div></> : null}
          </div>
        </>
      ) : <small>Nenhum produto selecionado.</small>}
    </div>
  );
}
