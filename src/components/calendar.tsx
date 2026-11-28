"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { moveAppointmentAction } from "@/app/actions/agenda";

export interface CalCol { key: string; date: string; staffId?: string; chairId?: string; label: string; num?: string; href?: string; color?: string; today?: boolean; off: [number, number][] }
export interface CalEvent { id: string; col: string; s: number; e: number; title: string; sub: string; status: string; color: string; movable: boolean; rec: boolean; href?: string }
export interface CalBlock { id: string; col: string; s: number; e: number; reason: string }

const PX = 1.5; // pixels por minuto
const SNAP = 15;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Eventos sobrepostos dividem a largura da coluna. */
function lanes(list: CalEvent[]): Map<string, { i: number; n: number }> {
  const out = new Map<string, { i: number; n: number }>();
  const sorted = [...list].sort((a, b) => a.s - b.s || b.e - a.e);
  let group: CalEvent[] = [], end = -1;
  const flush = () => {
    const ends: number[] = [];
    const at = group.map((g) => { let k = ends.findIndex((x) => x <= g.s); if (k < 0) k = ends.length; ends[k] = g.e; return k; });
    group.forEach((g, i) => out.set(g.id, { i: at[i], n: ends.length }));
    group = [];
  };
  for (const e of sorted) { if (group.length && e.s >= end) { flush(); end = -1; } group.push(e); end = Math.max(end, e.e); }
  flush();
  return out;
}

type Drag = { id: string; mode: "move" | "resize"; x: number; y: number; s: number; e: number; col: string; active: boolean };
type Sel = { col: string; a: number; b: number; done: boolean };

export function Calendar({ cols, events, blocks, start, end, canBook, canBlock }: { cols: CalCol[]; events: CalEvent[]; blocks: CalBlock[]; start: number; end: number; canBook: boolean; canBlock: boolean }) {
  const router = useRouter();
  const [list, setList] = useState(events);
  const [src, setSrc] = useState(events);
  if (src !== events) { setSrc(events); setList(events); } // dados novos do servidor substituem o estado local
  const [drag, setDrag] = useState<Drag | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const tick = () => { const p = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()); setNow(Number(p.find((x) => x.type === "hour")!.value) * 60 + Number(p.find((x) => x.type === "minute")!.value)); };
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 60000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);
  // no toque, depois de segurar, o dedo move o cartão em vez de rolar a tela
  const dragging = Boolean(drag?.active);
  useEffect(() => {
    if (!dragging) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    window.addEventListener("touchmove", stop, { passive: false });
    return () => window.removeEventListener("touchmove", stop);
  }, [dragging]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4200); return () => clearTimeout(t); }, [toast]);

  const byCol = useMemo(() => new Map(cols.map((c) => [c.key, lanes(list.filter((e) => e.col === c.key))])), [cols, list]);
  const template = `58px repeat(${Math.max(cols.length, 1)}, minmax(${cols.length > 1 ? 136 : 220}px, 1fr))`;
  const height = (end - start) * PX;
  const snap = (m: number) => Math.round(m / SNAP) * SNAP;
  const minAt = (y: number) => start + (y - grid.current!.getBoundingClientRect().top) / PX;
  const colAt = (x: number) => {
    const els = grid.current!.querySelectorAll<HTMLElement>("[data-col]");
    for (const el of els) { const r = el.getBoundingClientRect(); if (x >= r.left && x < r.right) return el.dataset.col!; }
    return null;
  };

  function beginDrag(ev: React.PointerEvent, e: CalEvent, mode: "move" | "resize") {
    if (!e.movable || saving || ev.button !== 0) return;
    moved.current = false;
    const el = (ev.currentTarget as HTMLElement).closest<HTMLElement>(".calev")!;
    const id = ev.pointerId;
    const go = (active: boolean) => { try { el.setPointerCapture(id); } catch { /* ponteiro já solto */ } setDrag({ id: e.id, mode, x: ev.clientX, y: ev.clientY, s: e.s, e: e.e, col: e.col, active }); };
    if (mode === "resize") ev.stopPropagation();
    // no toque, segurar 350 ms inicia o arraste; um gesto rápido continua rolando a tela
    if (ev.pointerType === "mouse" || mode === "resize") go(false);
    else hold.current = setTimeout(() => { moved.current = true; go(true); navigator.vibrate?.(12); }, 350);
  }
  function moveDrag(ev: React.PointerEvent): CalEvent | null {
    if (!drag) return null;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    const orig = list.find((e) => e.id === drag.id)!;
    if (!drag.active && Math.hypot(dx, dy) < 5) return null;
    moved.current = true;
    let next: Partial<CalEvent>;
    if (drag.mode === "resize") next = { e: Math.min(end, Math.max(drag.s + SNAP, snap(drag.e + dy / PX))) };
    else {
      const len = drag.e - drag.s;
      const s = Math.min(end - len, Math.max(start, snap(drag.s + dy / PX)));
      next = { s, e: s + len, col: colAt(ev.clientX) ?? orig.col };
    }
    if (!drag.active) setDrag({ ...drag, active: true });
    setList((l) => l.map((e) => (e.id === orig.id ? { ...e, ...next } : e)));
    return { ...orig, ...next };
  }
  async function endDrag(ev: React.PointerEvent) {
    if (hold.current) clearTimeout(hold.current);
    if (!drag) return;
    // posição final pelo próprio evento de soltar: o estado ainda pode estar um quadro atrás
    const d = drag, e = moveDrag(ev);
    setDrag(null);
    if (!e || (e.s === d.s && e.e === d.e && e.col === d.col)) return;
    const c = cols.find((x) => x.key === e.col)!;
    const revert = () => setList((l) => l.map((x) => (x.id === d.id ? { ...x, s: d.s, e: d.e, col: d.col } : x)));
    setSaving(e.id);
    try {
      const r = await moveAppointmentAction({ id: e.id, date: c.date, time: hhmm(e.s), minutes: d.mode === "resize" ? e.e - e.s : null, staffId: c.staffId ?? null, chairId: c.chairId ?? null });
      if (!r.ok) { revert(); setToast({ text: r.error, bad: true }); }
      else { setToast({ text: d.mode === "resize" ? `Duração alterada: até ${hhmm(e.e)}` : `Reagendado para ${hhmm(e.s)}` }); router.refresh(); }
    } catch {
      revert();
      setToast({ text: "Sem conexão. A alteração foi desfeita.", bad: true });
    } finally { setSaving(null); }
  }
  function cancelDrag() {
    if (hold.current) clearTimeout(hold.current);
    if (!drag) return;
    const d = drag;
    setDrag(null);
    setList((l) => l.map((x) => (x.id === d.id ? { ...x, s: d.s, e: d.e, col: d.col } : x)));
  }

  function beginSel(ev: React.PointerEvent, col: string) {
    if (!canBook || ev.button !== 0 || (ev.target as HTMLElement).closest("a,button")) return;
    const m = Math.floor(minAt(ev.clientY) / SNAP) * SNAP;
    if (ev.pointerType === "mouse") (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    setSel({ col, a: m, b: m + 30, done: false });
  }
  function moveSel(ev: React.PointerEvent) {
    if (!sel || sel.done || ev.pointerType !== "mouse") return;
    const m = snap(minAt(ev.clientY));
    if (Math.abs(m - sel.a) >= SNAP) setSel({ ...sel, b: Math.max(sel.a + SNAP, Math.min(end, m)) });
  }
  const link = (block: boolean) => {
    const c = cols.find((x) => x.key === sel!.col)!;
    const p = new URLSearchParams({ d: c.date, t: hhmm(sel!.a), te: hhmm(sel!.b), ...(c.staffId ? { s: c.staffId } : {}), ...(c.chairId ? { c: c.chairId } : {}), ...(block ? { bloqueio: "1" } : {}) });
    return `/agenda/novo?${p.toString()}`;
  };
  const open = (s: number) => (s - start) * PX;

  return (
    <div className="calendar" data-dragging={drag ? "true" : undefined}>
      <div className="calscroll" tabIndex={0} aria-label="Calendário">
        <div className="calhead" style={{ gridTemplateColumns: template }}>
          <div />
          {cols.map((c) => (
            <div key={c.key} className={c.today ? "today" : ""}>
              {c.color ? <span className="dot" style={{ background: c.color }} /> : null}
              {c.href ? <Link href={c.href}>{c.num ? <span className="num">{c.num}</span> : null}{c.label}</Link> : <>{c.num ? <span className="num">{c.num}</span> : null}{c.label}</>}
            </div>
          ))}
        </div>
        <div className="calgrid" ref={grid} style={{ gridTemplateColumns: template, height }}>
          <div className="calcol times" aria-hidden="true" style={{ gridColumn: 1 }}>
            {Array.from({ length: Math.floor((end - start) / 60) }, (_, i) => start + (i + 1) * 60).filter((m) => m < end).map((m) => <span key={m} style={{ top: open(m) }}>{hhmm(m)}</span>)}
          </div>
          {cols.map((c, ci) => (
            <div key={c.key} data-col={c.key} style={{ gridColumn: ci + 2 }} className={`calcol ${c.today ? "today" : ""}`} onPointerDown={(ev) => beginSel(ev, c.key)} onPointerMove={moveSel} onPointerUp={() => sel && !sel.done && setSel({ ...sel, done: true })} onPointerCancel={() => setSel(null)}>
              {c.off.map(([a, b]) => <div key={a} className="off" style={{ top: open(Math.max(a, start)), height: (Math.min(b, end) - Math.max(a, start)) * PX }} />)}
              {Array.from({ length: Math.floor((end - start) / 30) }, (_, i) => start + i * 30).map((m) => <div key={m} className={`ln ${m % 60 ? "half" : ""}`} style={{ top: open(m) }} />)}
              {blocks.filter((b) => b.col === c.key && b.e > start && b.s < end).map((b) => <div key={b.id + b.col} className="calblk" style={{ top: open(Math.max(b.s, start)), height: (Math.min(b.e, end) - Math.max(b.s, start)) * PX - 2 }}>{b.reason}</div>)}
              {sel && sel.col === c.key ? (
                <div className="calsel" style={{ top: open(sel.a), height: (sel.b - sel.a) * PX, pointerEvents: sel.done ? "auto" : "none", overflow: "visible" }}>
                  {hhmm(sel.a)}–{hhmm(sel.b)}
                  {sel.done ? (
                    <div className="row" style={{ position: "absolute", top: "100%", left: 0, marginTop: 6, zIndex: 8, flexWrap: "nowrap" }}>
                      <Link className="btn small accent" href={link(false)}>Agendar</Link>
                      {canBlock ? <Link className="btn small" href={link(true)}>Bloquear</Link> : null}
                      <button type="button" className="btn small ghost" style={{ background: "var(--surface)" }} aria-label="Fechar" onClick={() => setSel(null)}>×</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {c.today && now != null && now >= start && now <= end ? <div className="calnow" style={{ top: open(now) }} /> : null}
            </div>
          ))}
          {/* uma camada só: o cartão não troca de elemento ao mudar de coluna, então o arraste não perde o ponteiro */}
          <div className="callayer" style={{ gridColumn: "2 / -1" }}>
            {list.map((e) => {
              const ci = cols.findIndex((c) => c.key === e.col);
              if (ci < 0) return null;
              const l = byCol.get(e.col)?.get(e.id) ?? { i: 0, n: 1 };
              const cw = 100 / cols.length, w = cw / l.n, isDrag = drag?.active && drag.id === e.id;
              const h = Math.max(20, (Math.min(e.e, end) - Math.max(e.s, start)) * PX - 2);
              return (
                <Link key={e.id} href={e.href ?? `/agenda/${e.id}`} prefetch={false} draggable={false} className={`calev ${e.status} ${isDrag ? "drag" : ""} ${saving === e.id ? "saving" : ""}`}
                  aria-label={`${hhmm(e.s)} a ${hhmm(e.e)}, ${e.title}, ${e.sub}`}
                  style={{ "--c": e.color, top: open(Math.max(e.s, start)), height: h, left: `calc(${ci * cw + l.i * w}% + 4px)`, width: `calc(${w}% - 8px)`, right: "auto" } as React.CSSProperties}
                  onPointerDown={(ev) => { setSel(null); beginDrag(ev, e, "move"); }} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag}
                  onContextMenu={(ev) => { if (moved.current) ev.preventDefault(); }}
                  onClick={(ev) => { if (moved.current) { ev.preventDefault(); moved.current = false; } }}>
                  {e.rec ? <span className="rec" title="Faz parte de uma série">↻</span> : null}
                  <b>{hhmm(e.s)}</b> {e.title}
                  {h > 40 ? <><br /><small>{e.sub}</small></> : null}
                  {e.movable ? <span className="rs" onPointerDown={(ev) => beginDrag(ev, e, "resize")} /> : null}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
      {toast ? <div className={`toast ${toast.bad ? "bad" : ""}`} role={toast.bad ? "alert" : "status"}>{toast.text}</div> : null}
    </div>
  );
}
