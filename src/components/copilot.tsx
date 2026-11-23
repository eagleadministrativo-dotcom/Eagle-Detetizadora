"use client";
import Link from "next/link";
import { useState, useTransition, type CSSProperties } from "react";
import { Icon, type IconName } from "./icons";
import type { Insight } from "@/server/services/insights";
import { dismissInsightAction } from "@/app/actions/copilot";

/**
 * Copiloto: sugestões opcionais, cada uma com o motivo ("Por que estou vendo isto?").
 * Dispensar esconde até amanhã em todos os aparelhos desta pessoa.
 */
export function Copilot({ items }: { items: Insight[] }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [, start] = useTransition();
  const hide = (id: string) => { setHidden((h) => [...h, id]); start(() => dismissInsightAction(id)); };
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
              <div className="cp-txt">
                <b>{i.title}</b><span>{i.body}</span>
                <details className="cp-why"><summary>Por que estou vendo isto?</summary><p>{i.why}</p></details>
              </div>
              <div className="cp-act">
                <Link className="btn small accent" href={i.href}>{i.cta}</Link>
                <button type="button" className="cp-x" aria-label={`Dispensar até amanhã: ${i.title}`} title="Dispensar até amanhã" onClick={() => hide(i.id)}><Icon name="close" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
