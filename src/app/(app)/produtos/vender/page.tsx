import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listProducts } from "@/server/services/products";
import { listCatalog } from "@/server/services/catalog";
import { listCustomers } from "@/server/services/customers";
import { Empty, Field, Flash, PageHead, newKey } from "@/components/ui";
import { ProductPicker } from "@/components/client";
import { sellAction } from "@/app/actions/products";

export const metadata = { title: "Registrar venda" };

export default async function Sell({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("products.sell");
  const db = await getDb();
  const cat = await listCatalog(db, ctx.unitId);
  const products = (await listProducts(db, ctx, { activeOnly: true })).map((p) => ({ id: p.id, name: p.name, price: p.price_cents, stock: p.track_stock ? p.stock_qty : null }));
  const staff = cat.staff.filter((s) => s.is_active && (can(ctx, "attendance.run") || s.id === ctx.staffId));
  const customers = can(ctx, "customers.view") ? (await listCustomers(db, ctx, { limit: 500 })).rows : [];
  return (
    <>
      <PageHead title="Registrar venda" sub="Venda de produtos sem atendimento. No atendimento, use a própria tela de conclusão."><Link className="btn ghost" href="/produtos">Voltar</Link></PageHead>
      <Flash erro={sp.erro} />
      {products.length === 0 ? <Empty title="Nenhum produto ativo" /> : staff.length === 0 ? <Empty title="Seu usuário não está vinculado a um profissional" /> : (
        <form action={sellAction} className="card form">
          <input type="hidden" name="key" value={newKey()} />
          <ProductPicker products={products} initial={[]} serviceCents={0} />
          <div className="fields">
            <Field label="Quem vendeu"><select name="staffId" defaultValue={ctx.staffId ?? staff[0].id}>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Cliente (opcional)"><select name="customerId" defaultValue=""><option value="">Não informado</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          </div>
          {can(ctx, "payments.register") ? <div className="fields"><Field label="Recebido em"><select name="methodId">{cat.methods.filter((m) => m.is_active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field><Field label="Valor recebido (vazio = cobrar depois)"><input name="amount" inputMode="decimal" placeholder="0,00" /></Field></div> : null}
          <div className="sticky-actions"><button className="btn accent" type="submit">Registrar venda</button></div>
        </form>
      )}
    </>
  );
}
