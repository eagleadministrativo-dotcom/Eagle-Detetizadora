import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { isDomainError } from "@/server/errors";
import { getSale } from "@/server/services/products";
import { fmtDateTime } from "@/lib/dates";
import { ConfirmAction, Field, Flash, PageHead, money, newKey } from "@/components/ui";
import { returnProductAction } from "@/app/actions/products";

export const metadata = { title: "Venda" };

export default async function SalePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("products.sell", "products.manage", "finance.view");
  let s;
  try { s = await getSale(await getDb(), ctx, id); } catch (e) { if (isDomainError(e)) { if (e.code === "forbidden") redirect("/sem-permissao"); notFound(); } throw e; }
  return (
    <>
      <PageHead title="Venda de produtos" sub={<>{s.finished_at ? fmtDateTime(s.finished_at) : "Em aberto"} · {s.seller_name}{s.customer_name ? ` · ${s.customer_name}` : ""}</>}>
        {s.attendance_id ? <Link className="btn ghost" href={`/atendimentos/${s.attendance_id}`}>Atendimento</Link> : null}
        {s.receivable_id && (can(ctx, "finance.view") || can(ctx, "finance.receivables_view")) ? <Link className="btn ghost" href={`/financeiro/receber/${s.receivable_id}`}>Cobrança</Link> : null}
        <Link className="btn ghost" href="/produtos">Voltar</Link>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="tablewrap"><table className="rtable">
        <thead><tr><th>Produto</th><th className="n">Qtd.</th><th className="n">Preço</th><th className="n">Desconto</th><th className="n">Total</th><th className="n">Devolvido</th></tr></thead>
        <tbody>{s.items.map((i) => <tr key={i.id}><td className="full">{i.name_snapshot}</td><td className="n" data-l="Qtd.">{i.quantity}</td><td className="n" data-l="Preço">{money(i.unit_price_cents)}</td><td className="n" data-l="Desconto">{money(i.discount_cents)}</td><td className="n" data-l="Total">{money(i.total_cents)}</td><td className="n" data-l="Devolvido">{i.returned_qty ? <>{i.returned_qty} · {money(i.returned_cents)}</> : "—"}</td></tr>)}
          <tr className="total"><td>Total{s.discount_reason ? <small> · desconto: {s.discount_reason}</small> : null}</td><td className="n" colSpan={5}>{money(s.total_cents)}</td></tr></tbody>
      </table></div>
      {can(ctx, "products.return") && s.status === "concluida" ? s.items.filter((i) => i.returned_qty < i.quantity).map((i) => (
        <ConfirmAction key={i.id} label={`Devolver ${i.name_snapshot}`} action={returnProductAction} submit="Registrar devolução" warn="A cobrança diminui, a comissão é ajustada e, se o cliente já pagou, a diferença é estornada.">
          <input type="hidden" name="saleId" value={s.id} /><input type="hidden" name="itemId" value={i.id} /><input type="hidden" name="key" value={newKey()} />
          <div className="fields"><Field label="Quantidade"><input name="qty" type="number" min={1} max={i.quantity - i.returned_qty} defaultValue={1} required /></Field><Field label="Motivo"><input name="reason" required minLength={3} /></Field></div>
          <label className="check"><input type="checkbox" name="restock" defaultChecked />Voltar para o estoque</label>
        </ConfirmAction>
      )) : null}
    </>
  );
}
