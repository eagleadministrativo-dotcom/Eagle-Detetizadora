import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listProducts, stockHistory } from "@/server/services/products";
import { fmtDateTime } from "@/lib/dates";
import { Empty, Field, Flash, PageHead, Stat, money } from "@/components/ui";
import { saveProductAction, stockAction } from "@/app/actions/products";

export const metadata = { title: "Produto" };
const KIND: Record<string, string> = { entrada: "Entrada", venda: "Venda", devolucao: "Devolução", ajuste: "Ajuste", perda: "Perda" };

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("products.view", "products.sell", "products.manage");
  const db = await getDb();
  const p = (await listProducts(db, ctx)).find((x) => x.id === id);
  if (!p) notFound();
  const canStock = can(ctx, "products.stock"), seeStock = canStock || can(ctx, "products.stock_view");
  const manage = can(ctx, "products.manage"), prices = can(ctx, "products.prices");
  const hist = seeStock ? await stockHistory(db, ctx, id) : [];
  return (
    <>
      <PageHead title={p.name} sub={p.description ?? p.sku ?? undefined}><Link className="btn ghost" href="/produtos">Voltar</Link></PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="stats"><Stat label="Preço" value={money(p.price_cents)} tone="ol" />{seeStock && p.track_stock ? <Stat label="Em estoque" value={p.stock_qty} hint={`Aviso em ${p.min_stock}`} /> : null}<Stat label="Comissão" value={p.commission_enabled ? "Sim" : "Não"} /></div>
      <div className="grid cols-2">
        {manage || prices ? (
          <form action={saveProductAction} className="card form">
            <h2>Cadastro</h2>
            <input type="hidden" name="id" value={p.id} />
            <div className="fields"><Field label="Nome"><input name="name" defaultValue={p.name} required readOnly={!manage} /></Field><Field label="Código"><input name="sku" defaultValue={p.sku ?? ""} readOnly={!manage} /></Field></div>
            <div className="fields"><Field label="Preço (R$)"><input name="price" defaultValue={(p.price_cents / 100).toFixed(2).replace(".", ",")} required readOnly={!prices} /></Field><Field label="Avisar com estoque em"><input name="minStock" type="number" min={0} defaultValue={p.min_stock} readOnly={!manage} /></Field></div>
            <Field label="Descrição"><textarea name="description" defaultValue={p.description ?? ""} readOnly={!manage} /></Field>
            <label className="switch">Controlar estoque<input type="checkbox" role="switch" name="trackStock" defaultChecked={p.track_stock} /></label>
            <label className="switch">Gera comissão<input type="checkbox" role="switch" name="commission" defaultChecked={p.commission_enabled} /></label>
            <label className="switch">Ativo<input type="checkbox" role="switch" name="isActive" defaultChecked={p.is_active} /></label>
            <div><button className="btn accent" type="submit">Salvar</button></div>
          </form>
        ) : null}
        {seeStock && p.track_stock ? (
          <section className="card stack">
            <h2>Estoque</h2>
            {canStock ? (
              <form action={stockAction} className="form">
                <input type="hidden" name="id" value={p.id} />
                <div className="fields"><Field label="Movimento"><select name="kind"><option value="entrada">Entrada</option><option value="ajuste">Ajuste (+ ou −)</option><option value="perda">Perda</option></select></Field><Field label="Quantidade"><input name="qty" type="number" required /></Field><Field label="Motivo"><input name="note" required minLength={3} /></Field></div>
                <div><button className="btn" type="submit">Registrar</button></div>
              </form>
            ) : null}
            {hist.length === 0 ? <Empty title="Sem movimentos" /> : <div className="tablewrap"><table className="rtable"><thead><tr><th>Quando</th><th>Movimento</th><th className="n">Qtd.</th><th className="n">Saldo</th></tr></thead><tbody>{hist.map((m) => <tr key={m.id}><td>{fmtDateTime(m.created_at)}<br /><small>{m.user_name}</small></td><td>{KIND[m.kind]}{m.note ? <><br /><small>{m.note}</small></> : null}</td><td className="n" data-l="Qtd.">{m.quantity > 0 ? "+" : ""}{m.quantity}</td><td className="n" data-l="Saldo">{m.balance_after}</td></tr>)}</tbody></table></div>}
          </section>
        ) : null}
      </div>
    </>
  );
}
