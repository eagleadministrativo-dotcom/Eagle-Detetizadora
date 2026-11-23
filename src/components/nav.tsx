"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Icon, iconFor } from "./icons";

export interface NavItem { href: string; label: string; short?: string; count?: number }
export interface NavGroup { title?: string; items: NavItem[] }

const matches = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
/** Só o item com o href mais específico fica ativo (ex.: /financeiro/dre não ativa também /financeiro). */
const bestMatch = (path: string, hrefs: string[]) => hrefs.filter((h) => matches(path, h)).sort((a, b) => b.length - a.length)[0];

export function SideNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const best = bestMatch(path, groups.flatMap((g) => g.items.map((i) => i.href)));
  return (
    <nav aria-label="Principal">
      {groups.map((g, i) => (
        <div key={i}>
          {g.title ? <div className="sec"><span>{g.title}</span></div> : null}
          {g.items.map((it) => (
            <Link key={it.href} href={it.href} title={it.label} aria-current={best === it.href ? "page" : undefined}>
              <Icon name={iconFor(it.href)} />
              <span className="lbl">{it.label}</span>
              {it.count ? <span className="count" aria-label={`${it.count} pendente(s)`}>{it.count > 99 ? "99+" : it.count}</span> : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Recolhe o menu lateral; a preferência fica só neste navegador (opcional, nunca bloqueia a tela). */
export function SideToggle() {
  const shell = () => document.querySelector<HTMLElement>(".shell");
  useEffect(() => {
    try {
      if (localStorage.getItem("marfim.side") === "1" && shell()) shell()!.dataset.collapsed = "true";
    } catch { /* armazenamento indisponível */ }
  }, []);
  const toggle = () => {
    const el = shell();
    if (!el) return;
    const next = el.dataset.collapsed !== "true";
    el.dataset.collapsed = String(next);
    try { localStorage.setItem("marfim.side", next ? "1" : "0"); } catch { /* ignore */ }
  };
  return (
    <button type="button" className="sidetoggle" aria-label="Recolher ou expandir o menu" onClick={toggle}>
      <Icon name="collapse" className="ic t-open" />
      <span className="t-open">Recolher</span>
      <Icon name="expand" className="ic t-closed" />
    </button>
  );
}

export function BottomNav({ primary, more }: { primary: NavItem[]; more: NavItem[] }) {
  const path = usePathname();
  const best = bestMatch(path, primary.map((i) => i.href));
  return (
    <nav className="bottomnav" aria-label="Navegação">
      {primary.map((it) => (
        <Link key={it.href} href={it.href} aria-current={best === it.href ? "page" : undefined}>
          <Icon name={iconFor(it.href)} />
          {it.short ?? it.label}
        </Link>
      ))}
      <details>
        <summary><Icon name="more" />Mais</summary>
        <div>
          {more.map((it) => <Link key={it.href} href={it.href} onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}><Icon name={iconFor(it.href)} />{it.label}</Link>)}
          <Link href="/conta"><Icon name="users" />Minha conta</Link>
        </div>
      </details>
    </nav>
  );
}
