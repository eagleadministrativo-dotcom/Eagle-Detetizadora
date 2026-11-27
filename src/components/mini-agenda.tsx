"use client";
import { useMemo, useState } from "react";
import type { AgendaItem } from "@/lib/doc-options";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WD = ["D", "S", "T", "Q", "Q", "S", "S"];
const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const fmt = (s: string) => { const [y, m, d] = s.split("-").map(Number); return `${pad(d)}/${pad(m)}/${y} (${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`; };

/**
 * Mini agenda real: mostra quantos serviços já estão marcados em cada dia (da agenda do sistema)
 * e deixa escolher a data e o horário. Envia `scheduledDate` e `scheduledTime` no formulário.
 */
export function MiniAgenda({ items, today, initialDate, initialTime, names = { date: "scheduledDate", time: "scheduledTime" } }: {
  items: AgendaItem[]; today: string; initialDate?: string | null; initialTime?: string | null; names?: { date: string; time: string };
}) {
  const [date, setDate] = useState(initialDate ?? "");
  const [time, setTime] = useState(initialTime ?? "");
  const start = (date || today).split("-").map(Number);
  const [view, setView] = useState({ y: start[0], m: start[1] - 1 });
  const byDay = useMemo(() => {
    const m = new Map<string, AgendaItem[]>();
    for (const it of items) m.set(it.d, [...(m.get(it.d) ?? []), it]);
    return m;
  }, [items]);

  const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const move = (k: number) => setView((v) => { const m = v.m + k; return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }; });
  const dayItems = date ? byDay.get(date) ?? [] : [];

  return (
    <div className="minical">
      <input type="hidden" name={names.date} value={date} />
      <input type="hidden" name={names.time} value={date ? time : ""} />
      <div className="minical-head">
        <button type="button" className="btn small ghost" onClick={() => move(-1)} aria-label="Mês anterior">‹</button>
        <b>{MONTHS[view.m]} de {view.y}</b>
        <button type="button" className="btn small ghost" onClick={() => move(1)} aria-label="Próximo mês">›</button>
      </div>
      <div className="minical-grid" role="grid">
        {WD.map((w, i) => <span key={`w${i}`} className="minical-wd">{w}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const key = ymd(view.y, view.m, d);
          const n = byDay.get(key)?.length ?? 0;
          const past = key < today;
          return (
            <button type="button" key={key} disabled={past} onClick={() => setDate(key)} aria-pressed={key === date}
              className={`minical-day${key === date ? " on" : ""}${key === today ? " today" : ""}`} title={n ? `${n} serviço(s) marcado(s)` : "Dia livre"}>
              {d}{n ? <i>{n}</i> : null}
            </button>
          );
        })}
      </div>
      {date ? (
        <div className="minical-sel">
          <div className="row" style={{ gap: 10, alignItems: "end" }}>
            <span><b>{fmt(date)}</b></span>
            <label style={{ flex: "0 0 130px" }}>Horário<input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} /></label>
            <button type="button" className="btn small ghost" onClick={() => { setDate(""); setTime(""); }}>Tirar data</button>
          </div>
          {dayItems.length ? (
            <ul className="minical-list">{dayItems.map((it, i) => <li key={i}><b>{it.t}</b> · {it.who} <small>({it.staff})</small></li>)}</ul>
          ) : <small className="muted">Nenhum serviço marcado neste dia.</small>}
        </div>
      ) : <small className="muted">Toque num dia para marcar a data. O número mostra quantos serviços já estão marcados.</small>}
    </div>
  );
}
