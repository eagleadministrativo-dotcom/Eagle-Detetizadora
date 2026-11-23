import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { isDomainError } from "@/server/errors";
import { getReceivable } from "@/server/services/payments";
import { listCatalog } from "@/server/services/catalog";
import { fmtDateTime, fmtYmd } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { Badge, ConcBadge, ConfirmAction, Empty, Field, Flash, PageHead, PayBadge, PaymentStatusBadge, money, newKey } from "@/components/ui";
import { cancelReceivableAction, confirmPaymentAction, divergenceAction, registerPaymentAction, reversePaymentAction, settlePaymentAction } from "@/app/actions/attendance";

export const metadata = { title: "Cobrança" };
const brl = (c: number) => (c / 100).toFixed(2).replace(".", ",");

export default async function ReceivablePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("finance.view", "finance.receivables_view");
  const db = await getDb();
  let d;
  try {
    d = await getReceivable(db, ctx, id);
  } catch (e) {
    if (isDomainError(e) && e.code === "not_found") notFound();
    throw e;
  }
  const { receivable: r, payments } = d;
  const cat = await listCatalog(db, ctx.unitId);
  const methods = cat.methods.filter((m) => m.is_active);
  const balance = r.amount_due_cents - r.registered_cents;
  const back = `/financeiro/receber/${r.id}`;
  return (
    <>
      <PageHead title={r.customer_name ?? "Cobrança avulsa"} sub={`${r.description} · criada em ${fmtDateTime(r.created_at)} · vencimento ${fmtYmd(r.due_date)}`}>
        <PayBadge s={r.pay_status} /><ConcBadge s={r.conc_status} />
        {r.attendance_id ? <Link className="btn ghost" href={`/atendimentos/${r.attendance_id}`}>Ver atendimento</Link> : null}
        <Link className="btn ghost" href="/financeiro/receber">Voltar</Link>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid cols-2">
        <section className="card stack">
          <h2>Valores</h2>
          <div className="tablewrap"><table><tbody>
            <tr><td>Valor devido</td><td className="n">{money(r.amount_due_cents)}</td></tr>
            <tr><td>Registrado (lançado pelos operadores)</td><td className="n">{money(r.registered_cents)}</td></tr>
            <tr><td>Conferido (confirmado/liquidado)</td><td className="n">{money(r.confirmed_cents)}</td></tr>
            <tr><td>Liquidado</td><td className="n">{money(r.settled_cents)}</td></tr>
            <tr className="total"><td>Saldo a receber</td><td className="n">{money(balance)}</td></tr>
          </tbody></table></div>
          {can(ctx, "payments.register") && r.status === "ativo" && balance > 0 ? (
            <form action={registerPaymentAction} className="form">
              <h3>Registrar pagamento</h3>
              <input type="hidden" name="receivableId" value={r.id} /><input type="hidden" name="key" value={newKey()} /><input type="hidden" name="back" value={back} />
              <div className="fields">
                <Field label="Forma"><select name="methodId" defaultValue={methods[0]?.id}>{methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
                <Field label="Valor (R$)"><input name="amount" inputMode="decimal" defaultValue={brl(balance)} required /></Field>
                <Field label="Referência"><input name="reference" /></Field>
              </div>
              <div><button className="btn accent" type="submit">Registrar pagamento</button></div>
            </form>
          ) : null}
          {can(ctx, "finance.manage") && r.status === "ativo" && r.registered_cents === 0 ? (
            <ConfirmAction label="Cancelar cobrança" action={cancelReceivableAction} submit="Cancelar cobrança" warn="A cobrança deixa de contar no saldo a receber, mas permanece no histórico.">
              <input type="hidden" name="id" value={r.id} /><Field label="Motivo"><input name="reason" minLength={3} required /></Field>
            </ConfirmAction>
          ) : null}
        </section>
        <section className="card stack">
          <h2>Pagamentos e conciliação</h2>
          {payments.length === 0 ? <Empty title="Nenhum pagamento registrado" /> : (
            <div className="stack">
              {payments.map((p) => (
                <div key={p.id} className="card flat stack" style={p.kind === "estorno" ? { opacity: 0.7 } : undefined}>
                  <div className="row">
                    <b>{p.kind === "estorno" ? "Estorno · " : ""}{p.method_name}</b><span className="mono">{p.kind === "estorno" ? "−" : ""}{fmtBRL(p.amount_cents)}</span><PaymentStatusBadge s={p.status} />
                    {p.reversed ? <Badge tone="bad">estornado</Badge> : null}{p.divergence_note ? <Badge tone="warn">divergência</Badge> : null}
                  </div>
                  <small>{fmtDateTime(p.paid_at)} · registrado por {p.registered_by_name}{p.reference ? ` · ref. ${p.reference}` : ""}{p.fee_cents ? ` · taxa ${fmtBRL(p.fee_cents)}` : ""}</small>
                  {p.confirmed_at ? <small>Conferido por {p.confirmed_by_name} em {fmtDateTime(p.confirmed_at)}: {p.confirmation_evidence}</small> : null}
                  {p.liquidated_at ? <small>Liquidado em {fmtDateTime(p.liquidated_at)}</small> : null}
                  {p.divergence_note ? <div className="alert warn">Divergência: {p.divergence_note}</div> : null}
                  {p.kind === "recebimento" && !p.reversed ? (
                    <div className="row">
                      {p.status === "registrado" && can(ctx, "payments.confirm") ? (
                        <ConfirmAction label="Conferir" tone="neutral" action={confirmPaymentAction} submit="Registrar conferência" warn="Você declara que verificou este pagamento. Isso não é uma verificação bancária automática.">
                          <input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={back} />
                          <Field label="Evidência ou referência da conferência"><input name="evidence" minLength={3} required placeholder="Ex.: extrato 22/11 linha 14, comprovante E2E…" /></Field>
                        </ConfirmAction>) : null}
                      {p.status === "confirmado" && can(ctx, "payments.confirm") && p.method_kind !== "dinheiro" ? (
                        <form action={settlePaymentAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={back} /><button className="btn small ghost" type="submit">Registrar liquidação</button></form>) : null}
                      {can(ctx, "payments.confirm") ? (
                        <ConfirmAction label="Apontar divergência" tone="neutral" action={divergenceAction} submit="Registrar divergência">
                          <input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={back} /><Field label="O que está diferente?"><input name="note" minLength={5} required /></Field>
                        </ConfirmAction>) : null}
                      {can(ctx, "payments.reverse") ? (
                        <ConfirmAction label="Estornar" action={reversePaymentAction} submit="Estornar pagamento" warn="Cria um lançamento de estorno; o original permanece no histórico. Só pode ser feito uma vez.">
                          <input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={back} /><Field label="Motivo do estorno"><input name="reason" minLength={3} required /></Field>
                        </ConfirmAction>) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
