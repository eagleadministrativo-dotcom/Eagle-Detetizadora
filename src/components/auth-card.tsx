import Link from "next/link";
import type { ReactNode } from "react";
import { Flash } from "@/components/ui";

/** Moldura das telas de acesso (boas-vindas, cadastro, código, senha). */
export function AuthCard({ title, sub, ok, erro, back, children }: { title: string; sub?: ReactNode; ok?: string; erro?: string; back?: { href: string; label: string }; children: ReactNode }) {
  return (
    <div className="login">
      <div className="card stack">
        <div>
          <div className="brand"><span className="mark" aria-hidden="true">E</span><span className="name">EAGLE<small>Detetizadora</small></span></div>
          <h1 style={{ fontSize: "1.35rem" }}>{title}</h1>
          {sub ? <p className="muted" style={{ marginTop: 4 }}>{sub}</p> : null}
        </div>
        <Flash ok={ok} erro={erro} />
        {children}
        {back ? <Link className="authback" href={back.href}>← {back.label}</Link> : null}
      </div>
    </div>
  );
}
