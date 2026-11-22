import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { isDomainError } from "@/server/errors";
import { getCashSession } from "@/server/services/cash";
import { fmtDateTime } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { Badge, ConfirmAction, Field, Flash, PageHead, money } from "@/components/ui";
import { cashCorrectionAction, closeCashAction } from "@/app/actions/finance";

export const metadata = { title: "Sessão de caixa" };
const brl = (c: number) => (c / 100).toFixed(2).replace(".", ",");
type Row = { method_id: string; name: string; kind: string; declared_cents?: number; expected_cents?: number };

export default async function CashSessionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("cash.manage", "finance.view");
  let d;
  try {
    d = await getCashSession(await getDb(), ctx, id);
  } catch (e) {
    if (isDomainError(e) && e.code === "not_found") notFound();
    throw e;
  }
  const { session: s, movements, totals } = d;
  const isOpen = s.status === "aberto";
  const exp = (s.closing_expected ?? []) as Row[];
  const dec = (s.closing_declared ?? []) as Row[];
  const corrections = (s.corrections ?? []) as { at: string; note: string }[];
  return (
    <>
      <PageHead title={`Caixa · ${s.account_name}`} sub={`Aberto em ${fmtDateTime(s.opened_at)} · saldo inicial declarado ${fmtBRL(s.opening_declared_cents)}`}>
        {isOpen ? <Badge tone="ok">Aberto</Badge> : <Badge>Fechado em {fmtDateTime(s.closed_at)}</Badge>}
        <Link className="btn ghost" href="/financeiro/caixa">Voltar</Link>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />

      {isOpen && can(ctx, "cash.manage") ? (
        <section className="card stack">
          <h2>Fechar caixa</h2>
          <p className="muted">Conte o dinheiro e confira os comprovantes de Pix e cartão. Informe o valor contado de cada modalidade.</p>
          <form action={closeCashAction} className="form">
            <input type="hidden" name="id" value={s.id} />
            <div className="tablewrap"><table>
              <thead><tr><th>Modalidade</th><th className="n">Esperado</th><th>Valor contado (R$)</th></tr></thead>
              <tbody>{totals.map((t) => (
                <tr key={t.method_id}><td>{t.name}</td><td className="n">{money(t.expected_cents)}</td>
                  <td><input name={`m_${t.method_id}`} inputMode="decimal" defaultValue={brl(t.expected_cents)} required style={{ maxWidth: 160 }} /></td></tr>))}</tbody>
            </table></div>
            <Field label="Justificativa (obrigatória se houver diferença)"><textarea name="justification" /></Field>
            <div className="alert warn">Ao fechar, o resultado fica registrado com seu nome e horário. Correções posteriores ficam no histórico.</div>
            <div className="sticky-actions"><button className="btn accent" type="submit">Fechar caixa</button></div>
          </form>
        </section>
      ) : null}

      {!isOpen ? (
        <section className="card stack">
          <h2>Resultado do fechamento</h2>
          <div className="tablewrap"><table>
            <thead><tr><th>Modalidade</th><th className="n">Esperado</th><th className="n">Contado</th><th className="n">Diferença</th></tr></thead>
            <tbody>{exp.map((e) => {
              const c = dec.find((x) => x.method_id === e.method_id)?.declared_cents ?? 0;
              const diff = c - (e.expected_cents ?? 0);
              return <tr key={e.method_id}><td>{e.name}</td><td className="n">{money(e.expected_cents)}</td><td className="n">{money(c)}</td><td className="n" style={{ color: diff ? "var(--bad)" : undefined }}>{diff ? fmtBRL(diff) : "—"}</td></tr>;
            })}
              <tr className="total"><td>Total</td><td /><td /><td className="n">{fmtBRL(s.difference_cents ?? 0)}</td></tr></tbody>
          </table></div>
          {s.justification ? <div className="alert warn">Justificativa: {s.justification}</div> : null}
          {corrections.length ? <div className="stack"><h3>Histórico de correções</h3>{corrections.map((c, i) => <div className="alert" key={i}>{c.note} <small>· {fmtDateTime(c.at)}</small></div>)}</div> : null}
          {can(ctx, "cash.manage") ? (
            <ConfirmAction label="Registrar correção" tone="neutral" action={cashCorrectionAction} submit="Registrar correção" warn="O fechamento não é alterado: a correção fica anotada no histórico.">
              <input type="hidden" name="id" value={s.id} />
              <Field label="Descrição da correção"><textarea name="note" minLength={5} required /></Field>
            </ConfirmAction>
          ) : null}
        </section>
      ) : null}

      <section className="card stack">
        <h2>Movimentações</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Quando</th><th>Tipo</th><th>Forma</th><th>Descrição</th><th>Por</th><th className="n">Valor</th></tr></thead>
          <tbody>{movements.map((m) => (
            <tr key={m.id}><td className="nowrap">{fmtDateTime(m.created_at)}</td><td>{m.kind}</td><td>{m.method_name ?? "—"}</td><td>{m.description ?? ""}</td><td>{m.by_name}</td>
              <td className="n">{m.direction < 0 ? "−" : "+"} {fmtBRL(m.amount_cents)}</td></tr>))}
            {movements.length === 0 ? <tr><td colSpan={6}><small>Sem movimentações.</small></td></tr> : null}</tbody>
        </table></div>
      </section>
    </>
  );
}
