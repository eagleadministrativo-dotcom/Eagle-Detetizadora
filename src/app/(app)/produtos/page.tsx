import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listProducts, listSales } from "@/server/services/products";
import { fmtDateTime } from "@/lib/dates";
import { Badge, Empty, Field, Flash, PageHead, money } from "@/components/ui";
import { saveProductAction } from "@/app/actions/products";

export const metadata = { title: "Produtos" };

export default async function Products({ searchParams }: { searchParams: Promise<{ q?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("products.view", "products.sell", "products.manage");
  const db = await getDb();
  const rows = await listProducts(db, ctx, { search: sp.q });
  const stock = can(ctx, "products.stock_view") || can(ctx, "products.stock");
  const canSales = can(ctx, "products.sell") || can(ctx, "products.manage") || can(ctx, "finance.view");
  const sales = canSales ? (await listSales(db, ctx, { limit: 12 })).rows : [];
  return (
    <>
      <PageHead title="Produtos" sub="Catálogo, estoque e vendas.">{can(ctx, "products.sell") ? <Link className="btn accent" href="/produtos/vender">Registrar venda</Link> : null}</PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="filters" method="get"><label>Pesquisar<input name="q" defaultValue={sp.q ?? ""} placeholder="Nome ou código" /></label><button className="btn ghost" type="submit">Pesquisar</button></form>
      {rows.length === 0 ? <Empty title={sp.q ? "Nada encontrado" : "Nenhum produto cadastrado"} /> : (
        <div className="tablewrap"><table className="rtable">
          <thead><tr><th>Produto</th><th className="n">Preço</th>{stock ? <th className="n">Estoque</th> : null}<th>Comissão</th><th /></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id} className={p.is_active ? "" : "dim"}>
              <td><Link href={`/produtos/${p.id}`}>{p.name}</Link>{p.sku ? <small> · {p.sku}</small> : null}</td>
              <td className="n">{money(p.price_cents)}</td>
              {stock ? <td className="n" data-l="Estoque">{p.track_stock ? <span className={p.stock_qty <= p.min_stock ? "late" : ""}>{p.stock_qty}</span> : "—"}</td> : null}
              <td data-l="Comissão">{p.commission_enabled ? "Sim" : "Não"}</td>
              <td>{!p.is_active ? <Badge>inativo</Badge> : p.track_stock && p.stock_qty <= p.min_stock ? <Badge tone="warn">repor</Badge> : null}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      <div className="grid cols-2">
        {can(ctx, "products.manage") ? (
          <form action={saveProductAction} className="card form">
            <h2>Novo produto</h2>
            <div className="fields"><Field label="Nome"><input name="name" required minLength={2} /></Field><Field label="Código (opcional)"><input name="sku" /></Field></div>
            <div className="fields"><Field label="Preço de venda (R$)"><input name="price" inputMode="decimal" required placeholder="0,00" /></Field><Field label="Avisar com estoque em"><input name="minStock" type="number" min={0} defaultValue={0} /></Field></div>
            <label className="switch">Controlar estoque<input type="checkbox" role="switch" name="trackStock" defaultChecked /></label>
            <label className="switch">Gera comissão<input type="checkbox" role="switch" name="commission" /></label>
            <small>O percentual e a base ficam em Comissões → Regras.</small>
            <div><button className="btn accent" type="submit">Cadastrar</button></div>
          </form>
        ) : null}
        {canSales ? (
          <section className="card stack">
            <h2>Últimas vendas</h2>
            {sales.length === 0 ? <Empty title="Nenhuma venda ainda" /> : sales.map((s) => <Link key={s.id} className="row" href={`/produtos/vendas/${s.id}`}><span className="grow">{s.items}<br /><small>{fmtDateTime(s.finished_at)} · {s.seller_name}{s.customer_name ? ` · ${s.customer_name}` : ""}{s.returned_cents ? " · com devolução" : ""}</small></span>{money(s.total_cents - s.returned_cents)}</Link>)}
          </section>
        ) : null}
      </div>
    </>
  );
}
