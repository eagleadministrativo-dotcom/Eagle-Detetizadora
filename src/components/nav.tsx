"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon, iconFor } from "./icons";

export interface NavItem { href: string; label: string; short?: string; count?: number }
export interface NavGroup { title?: string; icon?: string; items: NavItem[] }

const matches = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
/** Só o item com o href mais específico fica ativo (ex.: /financeiro/dre não ativa também /financeiro). */
const bestMatch = (path: string, hrefs: string[]) => hrefs.filter((h) => matches(path, h)).sort((a, b) => b.length - a.length)[0];
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* armazenamento indisponível */ } };

/** Menu lateral por tópicos. Cada tópico recolhe; o do item atual fica sempre aberto. */
export function SideNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const best = bestMatch(path, groups.flatMap((g) => g.items.map((i) => i.href)));
  const [closed, setClosed] = useState<string[]>([]);
  useEffect(() => { const t = setTimeout(() => setClosed(JSON.parse(read("marfim.topics") ?? "[]")), 0); return () => clearTimeout(t); }, []);
  const toggle = (t: string) => setClosed((c) => { const n = c.includes(t) ? c.filter((x) => x !== t) : [...c, t]; write("marfim.topics", JSON.stringify(n)); return n; });
  return (
    <nav aria-label="Principal">
      {groups.map((g, i) => {
        const active = g.items.some((it) => it.href === best);
        const open = !g.title || active || !closed.includes(g.title);
        const pending = g.items.reduce((a, it) => a + (it.count ?? 0), 0);
        return (
          <div key={g.title ?? i} className={`topic ${open ? "open" : ""}`}>
            {g.title ? (
              <button type="button" className="sec" aria-label={`${g.title}: ${open ? "recolher" : "mostrar"}`} aria-expanded={open} onClick={() => toggle(g.title!)} disabled={active}>
                <span>{g.title}</span>{!open && pending ? <i className="dot" aria-label={`${pending} pendente(s)`} /> : null}<Icon name="chevron" className="ic chev" />
              </button>
            ) : null}
            <div className="items">
              {g.items.map((it) => (
                <Link key={it.href} href={it.href} title={it.label} aria-current={best === it.href ? "page" : undefined} tabIndex={open ? undefined : -1}>
                  <Icon name={iconFor(it.href)} />
                  <span className="lbl">{it.label}</span>
                  {it.count ? <span className="count" aria-label={`${it.count} pendente(s)`}>{it.count > 99 ? "99+" : it.count}</span> : null}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/** Recolhe o menu lateral; a preferência fica só neste navegador (opcional, nunca bloqueia a tela). */
export function SideToggle() {
  const shell = () => document.querySelector<HTMLElement>(".shell");
  useEffect(() => {
    if (read("marfim.side") === "1" && shell()) shell()!.dataset.collapsed = "true";
  }, []);
  const toggle = () => {
    const el = shell();
    if (!el) return;
    const next = el.dataset.collapsed !== "true";
    el.dataset.collapsed = String(next);
    write("marfim.side", next ? "1" : "0");
  };
  return (
    <button type="button" className="sidetoggle" aria-label="Recolher ou expandir o menu" onClick={toggle}>
      <Icon name="collapse" className="ic t-open" />
      <span className="t-open">Recolher</span>
      <Icon name="expand" className="ic t-closed" />
    </button>
  );
}

/**
 * Barra do celular. "Mais" abre uma folha com todos os tópicos: fecha ao tocar fora, no X, com Esc ou ao navegar,
 * e trava a rolagem da página de trás enquanto está aberta.
 */
export function BottomNav({ primary, groups, account }: { primary: NavItem[]; groups: NavGroup[]; account: { name: string; role: string } }) {
  const path = usePathname();
  const best = bestMatch(path, primary.map((i) => i.href));
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(path);
  const sheet = useRef<HTMLDivElement>(null);
  if (seen !== path) { setSeen(path); setOpen(false); } // mudou de página: fecha
  const inMore = !best && path !== "/";
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement, y = window.scrollY;
    const prev = { overflow: html.style.overflow, position: document.body.style.position, top: document.body.style.top, width: document.body.style.width };
    // trava a página de trás (inclusive no Safari do iPhone)
    html.style.overflow = "hidden";
    Object.assign(document.body.style, { position: "fixed", top: `-${y}px`, width: "100%" });
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    sheet.current?.querySelector<HTMLElement>("a,button")?.focus();
    return () => {
      html.style.overflow = prev.overflow;
      Object.assign(document.body.style, { position: prev.position, top: prev.top, width: prev.width });
      window.scrollTo(0, y);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const more = groups.map((g) => ({ ...g, items: g.items.filter((i) => !primary.some((p) => p.href === i.href)) })).filter((g) => g.items.length);
  const allBest = bestMatch(path, more.flatMap((g) => g.items.map((i) => i.href)));
  return (
    <>
      <nav className="bottomnav" aria-label="Navegação">
        {primary.map((it) => (
          <Link key={it.href} href={it.href} aria-current={best === it.href && !open ? "page" : undefined}>
            <Icon name={iconFor(it.href)} />
            {it.short ?? it.label}
            {it.count ? <i className="badge-dot" aria-label={`${it.count} pendente(s)`} /> : null}
          </Link>
        ))}
        <button type="button" className={open || inMore ? "on" : ""} aria-expanded={open} aria-controls="mais" onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? "close" : "grid"} />Mais
        </button>
      </nav>
      {open ? (
        <div className="sheet-wrap" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="sheet" id="mais" role="dialog" aria-modal="true" aria-label="Todas as áreas" ref={sheet}>
            <div className="sheet-head">
              <Link href="/conta" className="sheet-who"><span className="avatar" aria-hidden="true">{account.name.trim().slice(0, 1).toUpperCase()}</span><span><b>{account.name}</b><small>{account.role} · Minha conta</small></span></Link>
              <button type="button" className="btn icon ghost" aria-label="Fechar" onClick={() => setOpen(false)}><Icon name="close" /></button>
            </div>
            <div className="sheet-body">
              {more.map((g) => (
                <section key={g.title ?? "inicio"}>
                  {g.title ? <h3>{g.title}</h3> : null}
                  <div className="tiles">
                    {g.items.map((it) => (
                      <Link key={it.href} href={it.href} className="tile" aria-current={allBest === it.href ? "page" : undefined}>
                        <Icon name={iconFor(it.href)} /><span>{it.label}</span>
                        {it.count ? <span className="count">{it.count > 99 ? "99+" : it.count}</span> : null}
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
