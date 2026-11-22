"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem { href: string; label: string; short?: string }
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
          {g.title ? <div className="sec">{g.title}</div> : null}
          {g.items.map((it) => (
            <Link key={it.href} href={it.href} aria-current={best === it.href ? "page" : undefined}>{it.label}</Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function BottomNav({ primary, more }: { primary: NavItem[]; more: NavItem[] }) {
  const path = usePathname();
  const best = bestMatch(path, primary.map((i) => i.href));
  return (
    <nav className="bottomnav" aria-label="Navegação">
      {primary.map((it) => (
        <Link key={it.href} href={it.href} aria-current={best === it.href ? "page" : undefined}>{it.short ?? it.label}</Link>
      ))}
      <details>
        <summary>Mais</summary>
        <div>
          {more.map((it) => <Link key={it.href} href={it.href}>{it.label}</Link>)}
          <Link href="/conta">Minha conta</Link>
        </div>
      </details>
    </nav>
  );
}
