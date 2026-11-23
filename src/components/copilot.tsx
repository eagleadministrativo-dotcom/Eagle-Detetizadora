"use client";
import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "./icons";
import type { Insight } from "@/server/services/insights";

const KEY = "marfim.copilot.hidden";
const today = () => new Date().toISOString().slice(0, 10);
function readHidden(): string[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "{}"); return v.d === today() ? v.ids ?? [] : []; } catch { return []; }
}

/** Copiloto: sugestões opcionais. "Dispensar" esconde só até amanhã e só neste aparelho. */
export function Copilot({ items }: { items: Insight[] }) {
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => { const t = setTimeout(() => setHidden(readHidden()), 0); return () => clearTimeout(t); }, []);
  const hide = (id: string) => setHidden((h) => { const n = [...h, id]; try { localStorage.setItem(KEY, JSON.stringify({ d: today(), ids: n })); } catch { /* sem armazenamento */ } return n; });
  const list = items.filter((i) => !hidden.includes(i.id));
  return (
    <section className="copilot" aria-label="Sugestões do copiloto">
      <header>
        <span className="cp-mark" aria-hidden="true"><Icon name="spark" /></span>
        <div><b>Copiloto</b><small>Sugestões para agora · você decide</small></div>
      </header>
      {list.length === 0 ? (
        <p className="cp-empty">Tudo em ordem por aqui. Novas sugestões aparecem quando algo pedir atenção.</p>
      ) : (
        <ul>
          {list.map((i, n) => (
            <li key={i.id} className={`cp ${i.tone}`} style={{ "--i": n } as CSSProperties}>
              <span className="cp-ic" aria-hidden="true"><Icon name={i.icon as IconName} /></span>
              <div className="cp-txt"><b>{i.title}</b><span>{i.body}</span></div>
              <div className="cp-act">
                <Link className="btn small accent" href={i.href}>{i.cta}</Link>
                <button type="button" className="cp-x" aria-label={`Dispensar: ${i.title}`} onClick={() => hide(i.id)}><Icon name="close" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
