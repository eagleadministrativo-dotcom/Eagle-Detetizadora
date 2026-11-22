import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { isDomainError } from "@/server/errors";
import { getPayable } from "@/server/services/finance";
import { findOpenSession } from "@/server/services/cash";
import { listCatalog } from "@/server/services/catalog";
import { fmtDateTime, fmtYmd } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { Badge, ConfirmAction, Empty, Field, Flash, PageHead, money, newKey } from "@/components/ui";
import { cancelPayableAction, payPayableAction, reversePayablePaymentAction } from "@/app/actions/finance";

export const metadata = { title: "Conta a pagar" };
const brl = (c: number) => (c / 100).toFixed(2).replace(".", ",");

export default async function PayablePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("finance.view");
  const db = await getDb();
  let d;
  try {
    d = await getPayable(db, ctx, id);
  } catch (e) {
    if (isDomainError(e) && e.code === "not_found") notFound();
    throw e;
  }
  const { payable: p, payments } = d;
  const cat = await listCatalog(db, ctx.unitId);
  const open = await findOpenSession(db.query, ctx.unitId);
  const accounts = cat.accounts.filter((a) => a.is_active);
  const balance = p.amount_cents - p.paid_cents;
  const manage = can(ctx, "finance.manage");
  return (
    <>
      <PageHead title={p.description} sub={`${p.category_name} · vence em ${fmtYmd(p.due_date)}${p.supplier ? ` · ${p.supplier}` : ""}`}>
        <Badge tone={p.pay_status === "pago" ? "ok" : p.pay_status === "cancelado" ? "" : "warn"}>{p.pay_status}</Badge>
        <Link className="btn ghost" href="/financeiro/pagar">Voltar</Link>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid cols-2">
        <section className="card stack">
          <h2>Valores</h2>
          <div className="tablewrap"><table><tbody>
            <tr><td>Valor</td><td className="n">{money(p.amount_cents)}</td></tr>
            <tr><td>Pago</td><td className="n">{money(p.paid_cents)}</td></tr>
            <tr className="total"><td>Saldo</td><td className="n">{money(balance)}</td></tr>
          </tbody></table></div>
          {manage && p.status === "ativo" && balance > 0 ? (
            <form action={payPayableAction} className="form">
              <h3>Registrar pagamento</h3>
              <input type="hidden" name="payableId" value={p.id} /><input type="hidden" name="key" value={newKey()} />
              <div className="fields">
                <Field label="Valor (R$)"><input name="amount" inputMode="decimal" defaultValue={brl(balance)} required /></Field>
                <Field label="Pago com">
                  <select name="accountId" required defaultValue={accounts.find((a) => a.kind !== "caixa")?.id}>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.kind === "caixa" && !open ? " (caixa fechado)" : ""}</option>)}
                  </select>
                </Field>
                <Field label="Comprovante / referência"><input name="evidence" placeholder="Ex.: nº do boleto, comprovante" /></Field>
              </div>
              <div><button className="btn accent" type="submit">Registrar pagamento</button></div>
            </form>
          ) : null}
          {manage && p.status === "ativo" && p.paid_cents === 0 ? (
            <ConfirmAction label="Cancelar conta" action={cancelPayableAction} submit="Cancelar conta" warn="A conta deixa de contar nas despesas, mas continua no histórico.">
              <input type="hidden" name="id" value={p.id} />
              <Field label="Motivo"><input name="reason" minLength={3} required /></Field>
            </ConfirmAction>
          ) : null}
        </section>
        <section className="card stack">
          <h2>Pagamentos</h2>
          {payments.length === 0 ? <Empty title="Nenhum pagamento" /> : (
            <div className="tablewrap"><table>
              <thead><tr><th>Quando</th><th>Conta</th><th>Por</th><th className="n">Valor</th><th /></tr></thead>
              <tbody>{payments.map((x) => (
                <tr key={x.id} className={x.kind === "estorno" ? "dim" : ""}>
                  <td className="nowrap">{fmtDateTime(x.paid_at)}</td><td>{x.account_name ?? "—"}{x.evidence ? <small><br />{x.evidence}</small> : null}</td><td>{x.by_name}</td>
                  <td className="n">{x.kind === "estorno" ? "−" : ""}{fmtBRL(x.amount_cents)}</td>
                  <td>{x.kind === "pagamento" && !x.reversed && can(ctx, "payments.reverse") ? (
                    <ConfirmAction label="Estornar" action={reversePayablePaymentAction} submit="Estornar pagamento" warn="Cria um lançamento de estorno; o pagamento original permanece visível.">
                      <input type="hidden" name="id" value={x.id} /><input type="hidden" name="payableId" value={p.id} />
                      <Field label="Motivo"><input name="reason" minLength={3} required /></Field>
                    </ConfirmAction>) : x.reversed ? <Badge>estornado</Badge> : null}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
      </div>
    </>
  );
}
