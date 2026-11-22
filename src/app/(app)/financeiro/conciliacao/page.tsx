import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listPaymentsForReconciliation } from "@/server/services/payments";
import { fmtDateTime } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { Badge, ConfirmAction, Empty, Field, Flash, PageHead, PaymentStatusBadge, Seg } from "@/components/ui";
import { confirmPaymentAction, divergenceAction, settlePaymentAction } from "@/app/actions/attendance";

export const metadata = { title: "Conciliação" };

export default async function Reconciliation({ searchParams }: { searchParams: Promise<{ s?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("finance.view");
  const st = sp.s === "confirmado" ? "confirmado" : sp.s === "divergentes" ? "divergentes" : "registrado";
  const rows = await listPaymentsForReconciliation(await getDb(), ctx, st);
  const canAct = can(ctx, "payments.confirm");
  const back = `/financeiro/conciliacao?s=${st}`;
  return (
    <>
      <PageHead title="Conciliação de pagamentos" sub="Conferência manual de Pix e cartão. A confirmação do operador não equivale a verificação bancária automática.">
        <Seg items={[{ href: "/financeiro/conciliacao?s=registrado", label: "A conferir", active: st === "registrado" }, { href: "/financeiro/conciliacao?s=confirmado", label: "Confirmados (a liquidar)", active: st === "confirmado" }, { href: "/financeiro/conciliacao?s=divergentes", label: "Divergentes", active: st === "divergentes" }]} />
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="alert">Cada conferência registra <b>quem</b> conferiu, <b>quando</b> e com qual <b>evidência</b>. Dinheiro é conferido na contagem de fechamento do caixa e não aparece aqui.</div>
      {rows.length === 0 ? <Empty title="Nada pendente neste filtro">Tudo o que foi registrado já está conferido.</Empty> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Data</th><th>Cliente</th><th>Forma</th><th>Situação</th><th className="n">Valor</th><th>Ações</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}>
              <td className="nowrap"><Link href={`/financeiro/receber/${p.receivable_id}`}>{fmtDateTime(p.paid_at)}</Link></td>
              <td>{p.customer_name ?? "—"}{p.reference ? <small><br />ref. {p.reference}</small> : null}</td><td>{p.method_name}</td>
              <td><PaymentStatusBadge s={p.status} />{p.divergence_note ? <><br /><Badge tone="warn">divergência</Badge></> : null}</td>
              <td className="n">{fmtBRL(p.amount_cents)}</td>
              <td>{canAct ? (
                <div className="row">
                  {p.status === "registrado" ? (
                    <ConfirmAction label="Conferir" tone="neutral" action={confirmPaymentAction} submit="Registrar conferência">
                      <input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={back} />
                      <Field label="Evidência ou referência"><input name="evidence" minLength={3} required /></Field>
                    </ConfirmAction>) : null}
                  {p.status === "confirmado" ? <form action={settlePaymentAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={back} /><button className="btn small ghost" type="submit">Liquidar</button></form> : null}
                  <ConfirmAction label="Divergência" tone="neutral" action={divergenceAction} submit="Registrar divergência">
                    <input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={back} /><Field label="O que está diferente?"><input name="note" minLength={5} required /></Field>
                  </ConfirmAction>
                </div>) : <small>Somente leitura</small>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}
