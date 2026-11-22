import Link from "next/link";
import type { ReactNode } from "react";
import { fmtBRL, fmtPct } from "@/lib/money";
import type { Kpi } from "@/server/services/reports";

type Tone = "ok" | "warn" | "bad" | "info" | "solid" | "";

export function Flash({ ok, erro }: { ok?: string; erro?: string }) {
  return (
    <>
      {erro ? <div className="alert bad" role="alert">{erro}</div> : null}
      {ok ? <div className="alert ok" role="status">{ok}</div> : null}
    </>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="pagehead">
      <div>
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {children ? <div className="row">{children}</div> : null}
    </div>
  );
}

export const Badge = ({ tone = "", children }: { tone?: Tone; children: ReactNode }) => <span className={`badge ${tone}`}>{children}</span>;

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

export const money = (c: number | null | undefined) => <span className="mono">{fmtBRL(c)}</span>;

const PAY: Record<string, [Tone, string]> = {
  pendente: ["warn", "Pendente"], parcialmente_recebido: ["info", "Parcialmente recebido"], recebido: ["ok", "Recebido"], cancelado: ["", "Cancelado"],
  parcialmente_pago: ["info", "Parcialmente pago"], pago: ["ok", "Pago"],
};
export const PayBadge = ({ s }: { s: string | null }) => (s ? <Badge tone={PAY[s]?.[0]}>{PAY[s]?.[1] ?? s}</Badge> : <Badge>Sem cobrança</Badge>);
const CONC: Record<string, [Tone, string]> = { nao_conciliado: ["warn", "Não conciliado"], parcialmente_conciliado: ["info", "Parcialmente conciliado"], conciliado: ["ok", "Conciliado"] };
export const ConcBadge = ({ s }: { s: string }) => <Badge tone={CONC[s]?.[0]}>{CONC[s]?.[1] ?? s}</Badge>;
const PSTAT: Record<string, [Tone, string]> = { registrado: ["warn", "Registrado (a conferir)"], confirmado: ["info", "Confirmado"], liquidado: ["ok", "Liquidado"] };
export const PaymentStatusBadge = ({ s }: { s: string }) => <Badge tone={PSTAT[s]?.[0]}>{PSTAT[s]?.[1] ?? s}</Badge>;
const APPT: Record<string, [Tone, string]> = {
  agendado: ["info", "Agendado"], em_atendimento: ["ok", "Em atendimento"], concluido: ["solid", "Concluído"], cancelado: ["", "Cancelado"], nao_compareceu: ["bad", "Não compareceu"], iniciado: ["ok", "Em andamento"],
};
export const ApptBadge = ({ s }: { s: string }) => <Badge tone={APPT[s]?.[0]}>{APPT[s]?.[1] ?? s}</Badge>;

export function Seg({ items }: { items: { href: string; label: string; active: boolean }[] }) {
  return (
    <div className="seg">
      {items.map((i) => (
        <Link key={i.href + i.label} href={i.href} aria-current={i.active ? "true" : undefined}>{i.label}</Link>
      ))}
    </div>
  );
}

export function Pager({ base, page, total, size }: { base: string; page: number; total: number; size: number }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const link = (p: number) => `${base}${base.includes("?") ? "&" : "?"}p=${p}`;
  return (
    <div className="pager">
      <span>{total} registro(s) · página {page} de {pages}</span>
      {page > 1 ? <Link className="btn small ghost" href={link(page - 1)}>Anterior</Link> : null}
      {page < pages ? <Link className="btn small ghost" href={link(page + 1)}>Próxima</Link> : null}
    </div>
  );
}

/** Confirmação contextualizada sem JavaScript: o formulário só aparece ao abrir o <details>. */
export function ConfirmAction({ label, action, children, submit, tone = "danger", warn }: {
  label: string; action: (fd: FormData) => Promise<void>; children?: ReactNode; submit?: string; tone?: "danger" | "neutral"; warn?: string;
}) {
  return (
    <details className={`confirm ${tone === "neutral" ? "neutral" : ""}`}>
      <summary>{label}</summary>
      {warn ? <p className="warn">{warn}</p> : null}
      <form action={action} className="form">
        {children}
        <div>
          <button className={`btn small ${tone === "danger" ? "danger" : ""}`} type="submit">{submit ?? "Confirmar"}</button>
        </div>
      </form>
    </details>
  );
}

const unitFmt = (k: Kpi, v: number | null) => (v == null ? "—" : k.unit === "brl" ? fmtBRL(v) : k.unit === "pct" ? fmtPct(v) : v.toLocaleString("pt-BR"));

export function KpiCard({ k, href }: { k: Kpi; href: string }) {
  let delta: ReactNode = null;
  if (k.previous != null && k.value != null && k.previous !== 0) {
    const d = ((k.value - k.previous) / Math.abs(k.previous)) * 100;
    delta = <div className={`delta ${d >= 0 ? "up" : "down"}`}>{d >= 0 ? "▲" : "▼"} {fmtPct(Math.abs(d), 0)} vs período anterior</div>;
  } else if (k.previous != null) delta = <div className="delta">Anterior: {unitFmt(k, k.previous)}</div>;
  return (
    <Link className="kpi" href={href} title={k.definition}>
      <div className="label">
        <span>{k.label}</span>
        <span aria-hidden>↗</span>
      </div>
      <div className="value">{unitFmt(k, k.value)}</div>
      {delta}
      {k.notReconciledCents ? <div className="note">{fmtBRL(k.notReconciledCents)} ainda não conferido</div> : null}
      {k.warning ? <div className="note">{k.warning}</div> : null}
    </Link>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}

/** Chave de idempotência gerada ao renderizar: reenviar o mesmo formulário não duplica o lançamento. */
export const newKey = () => `ui-${crypto.randomUUID()}`;
