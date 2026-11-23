import type { Db, Q } from "../db";
import { assertPeriodOpen, audit, can, need, requireNonNegative, requirePositive, requireText, requireUuid } from "../core";
import { DomainError, ForbiddenError } from "../errors";
import type { Ctx } from "../permissions";
import { todayYmd } from "@/lib/dates";
import { assertDiscountAllowed, assertRun } from "./attendance";
import { registerPaymentTx, type RegisterPaymentInput } from "./payments";
import { findOpenSession } from "./cash";
import { adjustForReturnTx, allocate, generateCommissionsTx } from "./commissions";
import { emit } from "./events";

// ---------- catálogo e estoque ----------
export interface ProductRow { id: string; name: string; sku: string | null; description: string | null; price_cents: number; track_stock: boolean; stock_qty: number; min_stock: number; commission_enabled: boolean; is_active: boolean }

export async function listProducts(db: Db, ctx: Ctx, o: { search?: string | null; activeOnly?: boolean } = {}) {
  need(ctx, "products.view", "products.sell", "products.manage");
  return db.query<ProductRow>("select id,name,sku,description,price_cents,track_stock,stock_qty,min_stock,commission_enabled,is_active from products where unit_id=$1 and ($2::text is null or lower(name || ' ' || coalesce(sku,'')) like $2) and (not $3::boolean or is_active) order by is_active desc, name limit 500",
    [ctx.unitId, o.search ? `%${o.search.toLowerCase()}%` : null, o.activeOnly ?? false]);
}

export async function saveProduct(db: Db, ctx: Ctx, i: { id?: string | null; name: string; sku?: string | null; description?: string | null; priceCents: number; trackStock: boolean; minStock: number; commissionEnabled: boolean; isActive?: boolean }) {
  const name = requireText(i.name, "Nome do produto", 2);
  requireNonNegative(i.priceCents, "Preço"); requireNonNegative(i.minStock, "Estoque mínimo");
  return db.tx(async (q) => {
    try {
      if (!i.id) {
        need(ctx, "products.manage");
        const [p] = await q<{ id: string }>("insert into products(unit_id,name,sku,description,price_cents,track_stock,min_stock,commission_enabled) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id", [ctx.unitId, name, i.sku || null, i.description || null, i.priceCents, i.trackStock, i.minStock, i.commissionEnabled]);
        await audit(q, ctx, "PRODUTO_CRIADO", "product", p.id, null, { ...i, name });
        return p.id;
      }
      const [cur] = await q<ProductRow>("select * from products where id=$1 and unit_id=$2 for update", [requireUuid(i.id, "Produto"), ctx.unitId]);
      if (!cur) throw new DomainError("not_found", "Produto não encontrado.");
      need(ctx, "products.manage", "products.prices");
      if (cur.price_cents !== i.priceCents) need(ctx, "products.prices");
      const full = can(ctx, "products.manage"); // quem só altera preço não muda o cadastro
      if (cur.commission_enabled !== i.commissionEnabled && full) need(ctx, "commissions.rules");
      await q("update products set name=$2, sku=$3, description=$4, price_cents=$5, track_stock=$6, min_stock=$7, commission_enabled=$8, is_active=$9, updated_at=now() where id=$1",
        full ? [i.id, name, i.sku || null, i.description || null, i.priceCents, i.trackStock, i.minStock, i.commissionEnabled, i.isActive ?? cur.is_active] : [i.id, cur.name, cur.sku, cur.description, i.priceCents, cur.track_stock, cur.min_stock, cur.commission_enabled, cur.is_active]);
      await audit(q, ctx, "PRODUTO_ALTERADO", "product", i.id, { name: cur.name, price: cur.price_cents, active: cur.is_active, commission: cur.commission_enabled }, i);
      return i.id;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new DomainError("duplicate", "Já existe um produto com este código.");
      throw e;
    }
  });
}

async function moveStock(q: Q, ctx: Ctx, productId: string, qty: number, kind: "entrada" | "venda" | "devolucao" | "ajuste" | "perda", ref?: [string, string], note?: string | null) {
  const [p] = await q<{ stock_qty: number; min_stock: number; name: string }>("update products set stock_qty = stock_qty + $2, updated_at=now() where id=$1 and unit_id=$3 and stock_qty + $2 >= 0 returning stock_qty, min_stock, name", [productId, qty, ctx.unitId]);
  if (!p) {
    const [x] = await q<{ name: string; stock_qty: number }>("select name, stock_qty from products where id=$1 and unit_id=$2", [productId, ctx.unitId]);
    throw new DomainError("stock", x ? `Estoque insuficiente de "${x.name}" (disponível: ${x.stock_qty}).` : "Produto não encontrado.");
  }
  await q("insert into stock_movements(unit_id,product_id,kind,quantity,balance_after,ref_entity,ref_id,note,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [ctx.unitId, productId, kind, qty, p.stock_qty, ref?.[0] ?? null, ref?.[1] ?? null, note ?? null, ctx.userId]);
  if (qty < 0 && p.min_stock > 0 && p.stock_qty <= p.min_stock) {
    await q("insert into notifications(unit_id,kind,severity,message,url,ref_entity,ref_id,dedupe_key) values ($1,'estoque_baixo','atencao',$2,'/produtos','product',$3,$4) on conflict (dedupe_key) do nothing", [ctx.unitId, `Estoque baixo: ${p.name} (${p.stock_qty} un.).`, productId, `stock:${productId}:${todayYmd()}`]);
  }
}

export async function adjustStock(db: Db, ctx: Ctx, i: { productId: string; kind: "entrada" | "ajuste" | "perda"; quantity: number; note: string }) {
  need(ctx, "products.stock");
  const note = requireText(i.note, "Motivo", 3);
  if (!Number.isInteger(i.quantity) || i.quantity === 0 || (i.kind === "entrada" && i.quantity < 0)) throw new DomainError("invalid", "Quantidade inválida.");
  const qty = i.kind === "perda" ? -Math.abs(i.quantity) : i.quantity;
  await db.tx(async (q) => {
    const [p] = await q<{ track_stock: boolean }>("select track_stock from products where id=$1 and unit_id=$2", [requireUuid(i.productId, "Produto"), ctx.unitId]);
    if (!p) throw new DomainError("not_found", "Produto não encontrado.");
    if (!p.track_stock) throw new DomainError("no_stock", "Este produto não controla estoque.");
    await moveStock(q, ctx, i.productId, qty, i.kind, undefined, note);
    await audit(q, ctx, "ESTOQUE_ALTERADO", "product", i.productId, null, { kind: i.kind, qty }, note);
  });
}
export async function stockHistory(db: Db, ctx: Ctx, productId: string) {
  need(ctx, "products.stock_view", "products.stock");
  return db.query<{ id: string; kind: string; quantity: number; balance_after: number; note: string | null; created_at: Date; user_name: string }>("select m.id, m.kind, m.quantity, m.balance_after, m.note, m.created_at, u.full_name as user_name from stock_movements m join users u on u.id=m.created_by where m.product_id=$1 and m.unit_id=$2 order by m.created_at desc limit 50", [requireUuid(productId, "Produto"), ctx.unitId]);
}

// ---------- venda ----------
export interface SaleItem { id: string; product_id: string; name_snapshot: string; quantity: number; unit_price_cents: number; gross_cents: number; discount_cents: number; total_cents: number; returned_qty: number; returned_cents: number }
export interface Sale { id: string; status: string; gross_cents: number; discount_cents: number; discount_reason: string | null; total_cents: number; seller_staff_id: string; seller_name: string; receivable_id: string | null; items: SaleItem[] }

async function saleItems(q: Q, saleId: string) {
  return q<SaleItem>("select id, product_id, name_snapshot, quantity, unit_price_cents, gross_cents, discount_cents, total_cents, returned_qty, returned_cents from product_sale_items where sale_id=$1 order by name_snapshot", [saleId]);
}
export async function saleOfAttendance(db: Db, attendanceId: string): Promise<Sale | null> {
  const [s] = await db.query<Omit<Sale, "items">>("select s.id, s.status, s.gross_cents, s.discount_cents, s.discount_reason, s.total_cents, s.seller_staff_id, f.name as seller_name, s.receivable_id from product_sales s join staff f on f.id=s.seller_staff_id where s.attendance_id=$1", [attendanceId]);
  return s ? { ...s, items: await saleItems(db.query, s.id) } : null;
}

async function writeItems(q: Q, ctx: Ctx, saleId: string, items: { productId: string; quantity: number }[], discountCents: number) {
  const wanted = new Map<string, number>();
  for (const i of items) { requireUuid(i.productId, "Produto"); requirePositive(i.quantity, "Quantidade"); if (i.quantity > 999) throw new DomainError("invalid", "Quantidade inválida."); wanted.set(i.productId, (wanted.get(i.productId) ?? 0) + i.quantity); }
  const rows: { p: ProductRow; qty: number }[] = [];
  for (const [id, qty] of wanted) {
    const [p] = await q<ProductRow>("select * from products where id=$1 and unit_id=$2 and is_active", [id, ctx.unitId]);
    if (!p) throw new DomainError("not_found", "Produto inexistente ou inativo.");
    if (p.track_stock && p.stock_qty < qty) throw new DomainError("stock", `Estoque insuficiente de "${p.name}" (disponível: ${p.stock_qty}).`);
    rows.push({ p, qty });
  }
  const gross = rows.reduce((a, r) => a + r.p.price_cents * r.qty, 0);
  if (!Number.isInteger(discountCents) || discountCents < 0 || discountCents > gross) throw new DomainError("invalid", "O desconto não pode ser maior que o total dos produtos.");
  const disc = allocate(discountCents, rows.map((r) => r.p.price_cents * r.qty));
  await q("delete from product_sale_items where sale_id=$1", [saleId]);
  for (const [k, r] of rows.entries()) {
    const g = r.p.price_cents * r.qty;
    await q("insert into product_sale_items(sale_id,product_id,name_snapshot,quantity,unit_price_cents,gross_cents,discount_cents,total_cents) values ($1,$2,$3,$4,$5,$6,$7,$8)", [saleId, r.p.id, r.p.name, r.qty, r.p.price_cents, g, disc[k], g - disc[k]]);
  }
  await q("update product_sales set gross_cents=$2, discount_cents=$3, total_cents=$4 where id=$1", [saleId, gross, discountCents, gross - discountCents]);
  return { gross, total: gross - discountCents };
}

/** Define os produtos do atendimento em andamento (nada é baixado do estoque até concluir). */
export async function setAttendanceProducts(db: Db, ctx: Ctx, attendanceId: string, i: { items: { productId: string; quantity: number }[]; discountCents?: number; discountReason?: string | null }) {
  need(ctx, "products.sell");
  await db.tx(async (q) => {
    const [a] = await q<{ staff_id: string; status: string; customer_id: string }>("select staff_id,status,customer_id from attendances where id=$1 and unit_id=$2 for update", [requireUuid(attendanceId, "Atendimento"), ctx.unitId]);
    if (!a) throw new DomainError("not_found", "Atendimento não encontrado.");
    assertRun(ctx, a.staff_id);
    if (a.status !== "iniciado") throw new DomainError("bad_status", "Só é possível alterar produtos de atendimentos em andamento.");
    let [s] = await q<{ id: string }>("select id from product_sales where attendance_id=$1 and status='aberta' for update", [attendanceId]);
    if (!s) [s] = await q<{ id: string }>("insert into product_sales(unit_id,attendance_id,customer_id,seller_staff_id,created_by) values ($1,$2,$3,$4,$5) returning id", [ctx.unitId, attendanceId, a.customer_id, a.staff_id, ctx.userId]);
    const d = i.discountCents ?? 0;
    const r = await writeItems(q, ctx, s.id, i.items, d);
    if (d > 0) { requireText(i.discountReason, "Motivo do desconto", 3); await assertDiscountAllowed(q, ctx, r.gross, d); }
    await q("update product_sales set discount_reason=$2, discount_authorized_by=$3 where id=$1", [s.id, d > 0 ? i.discountReason : null, d > 0 ? ctx.userId : null]);
    await audit(q, ctx, "VENDA_PRODUTOS_ALTERADA", "product_sale", s.id, null, { ...i, total: r.total });
  });
}

/** Baixa o estoque e encerra a venda, na transação que cria a cobrança. */
export async function finishSaleTx(q: Q, ctx: Ctx, saleId: string, receivableId: string) {
  const [s] = await q<{ status: string; seller_staff_id: string }>("select status, seller_staff_id from product_sales where id=$1 for update", [saleId]);
  if (s.status !== "aberta") throw new DomainError("bad_status", "Esta venda já foi encerrada.");
  for (const it of await saleItems(q, saleId)) {
    const [p] = await q<{ track_stock: boolean }>("select track_stock from products where id=$1", [it.product_id]);
    if (p.track_stock) await moveStock(q, ctx, it.product_id, -it.quantity, "venda", ["product_sale", saleId]);
  }
  await q("update product_sales set status='concluida', finished_at=now(), receivable_id=$2 where id=$1", [saleId, receivableId]);
  await emit(q, ctx, "product.sold", "product_sale", saleId, { staffId: s.seller_staff_id }, `product.sold:${saleId}`);
}

/** Venda avulsa (sem atendimento). */
export async function sellProducts(db: Db, ctx: Ctx, i: { staffId: string; customerId?: string | null; items: { productId: string; quantity: number }[]; discountCents?: number; discountReason?: string | null; payments?: Omit<RegisterPaymentInput, "receivableId">[]; idempotencyKey: string }) {
  need(ctx, "products.sell");
  const key = requireText(i.idempotencyKey, "Chave de idempotência", 8);
  if (!can(ctx, "attendance.run") && i.staffId !== ctx.staffId) throw new ForbiddenError("Você só pode registrar vendas em seu nome.");
  if (!i.items.length) throw new DomainError("invalid", "Escolha pelo menos um produto.");
  return db.tx(async (q) => {
    const [dup] = await q<{ id: string; receivable_id: string }>("select id, receivable_id from product_sales where idempotency_key=$1", [key]);
    if (dup) return { saleId: dup.id, receivableId: dup.receivable_id, duplicate: true };
    const [st] = await q("select 1 from staff where id=$1 and unit_id=$2 and is_active", [requireUuid(i.staffId, "Profissional"), ctx.unitId]);
    if (!st) throw new DomainError("not_found", "Profissional inexistente ou inativo.");
    if (i.customerId) { const [c] = await q("select 1 from customers where id=$1 and unit_id=$2", [requireUuid(i.customerId, "Cliente"), ctx.unitId]); if (!c) throw new DomainError("not_found", "Cliente não encontrado."); }
    const [s] = await q<{ id: string }>("insert into product_sales(unit_id,customer_id,seller_staff_id,idempotency_key,created_by) values ($1,$2,$3,$4,$5) returning id", [ctx.unitId, i.customerId ?? null, i.staffId, key, ctx.userId]);
    const d = i.discountCents ?? 0;
    const t = await writeItems(q, ctx, s.id, i.items, d);
    if (d > 0) { requireText(i.discountReason, "Motivo do desconto", 3); await assertDiscountAllowed(q, ctx, t.gross, d); await q("update product_sales set discount_reason=$2, discount_authorized_by=$3 where id=$1", [s.id, i.discountReason, ctx.userId]); }
    const [r] = await q<{ id: string }>("insert into receivables(unit_id,customer_id,description,amount_due_cents,created_by) values ($1,$2,'Venda de produtos',$3,$4) returning id", [ctx.unitId, i.customerId ?? null, t.total, ctx.userId]);
    await finishSaleTx(q, ctx, s.id, r.id);
    await generateCommissionsTx(q, ctx, { saleId: s.id, receivableId: r.id });
    for (const p of i.payments ?? []) await registerPaymentTx(q, ctx, { ...p, receivableId: r.id });
    await audit(q, ctx, "VENDA_PRODUTOS", "product_sale", s.id, null, { total: t.total });
    return { saleId: s.id, receivableId: r.id, duplicate: false };
  });
}

/**
 * Devolução: reduz a cobrança, repõe o estoque, ajusta a comissão e, se o cliente já pagou a mais, estorna a diferença.
 * A venda original não é apagada: ficam a devolução, o ajuste e a auditoria.
 */
export async function returnProduct(db: Db, ctx: Ctx, i: { saleItemId: string; quantity: number; restock: boolean; reason: string; idempotencyKey: string }) {
  need(ctx, "products.return");
  const why = requireText(i.reason, "Motivo da devolução", 3);
  const key = requireText(i.idempotencyKey, "Chave de idempotência", 8);
  requirePositive(i.quantity, "Quantidade");
  return db.tx(async (q) => {
    const [dup] = await q<{ id: string }>("select id from product_returns where idempotency_key=$1", [key]);
    if (dup) return { id: dup.id, duplicate: true };
    await assertPeriodOpen(q, ctx.unitId, todayYmd());
    const [it] = await q<SaleItem & { receivable_id: string; seller: string; status: string; track_stock: boolean }>(
      "select i.*, s.receivable_id, s.seller_staff_id as seller, s.status, p.track_stock from product_sale_items i join product_sales s on s.id=i.sale_id join products p on p.id=i.product_id where i.id=$1 and s.unit_id=$2 for update of i", [requireUuid(i.saleItemId, "Item"), ctx.unitId]);
    if (!it) throw new DomainError("not_found", "Item não encontrado.");
    if (it.status !== "concluida") throw new DomainError("bad_status", "Só vendas concluídas aceitam devolução.");
    const newQty = it.returned_qty + i.quantity;
    if (newQty > it.quantity) throw new DomainError("invalid", `Só restam ${it.quantity - it.returned_qty} unidade(s) para devolver.`);
    const amount = Math.round((it.total_cents * newQty) / it.quantity) - it.returned_cents;
    const [r] = await q<{ amount_due_cents: number; status: string }>("select amount_due_cents, status from receivables where id=$1 for update", [it.receivable_id]);
    if (r.status !== "ativo") throw new DomainError("bad_status", "A cobrança desta venda foi cancelada.");
    const [b] = await q<{ registered_cents: number }>("select registered_cents from receivable_balances where receivable_id=$1", [it.receivable_id]);
    const newDue = r.amount_due_cents - amount;
    const over = b.registered_cents - newDue;
    let refundId: string | null = null;
    if (over > 0) {
      need(ctx, "payments.reverse");
      const [p] = await q<{ id: string; method_id: string; kind: string; status: string }>(
        `select p.id, p.method_id, m.kind, p.status from payments p join payment_methods m on m.id=p.method_id where p.receivable_id=$1 and p.kind='recebimento' and p.amount_cents >= $2 and not exists (select 1 from payments x where x.reversal_of=p.id) order by p.amount_cents desc limit 1 for update of p`, [it.receivable_id, over]);
      if (!p) throw new DomainError("refund", "Não há um pagamento único que cubra a devolução. Estorne os pagamentos na cobrança antes de devolver.");
      const session = await findOpenSession(q, ctx.unitId);
      if (p.kind === "dinheiro" && !session) throw new DomainError("cash_closed", "Abra o caixa para devolver dinheiro ao cliente.");
      const [rev] = await q<{ id: string }>(
        `insert into payments(unit_id,receivable_id,method_id,cash_session_id,kind,reversal_of,amount_cents,fee_cents,status,idempotency_key,paid_at,registered_by,confirmed_by,confirmed_at,confirmation_evidence,notes)
         values ($1,$2,$3,$4,'estorno',$5,$6,0,$7,$8,now(),$9,$9,now(),$10,$10) returning id`, [ctx.unitId, it.receivable_id, p.method_id, session?.id ?? null, p.id, over, p.status, `prodreturn:${key}`, ctx.userId, `Devolução de produto: ${why}`]);
      refundId = rev.id;
      if (session) await q("insert into cash_movements(unit_id,cash_session_id,kind,method_id,amount_cents,direction,payment_id,description,idempotency_key,created_by) values ($1,$2,'estorno',$3,$4,-1,$5,$6,$7,$8)", [ctx.unitId, session.id, p.method_id, over, rev.id, `Devolução de produto: ${why}`, `rev:${rev.id}`, ctx.userId]);
    }
    await q("update receivables set amount_due_cents=$2 where id=$1", [it.receivable_id, newDue]);
    await q("update product_sale_items set returned_qty=$2, returned_cents=returned_cents+$3 where id=$1", [it.id, newQty, amount]);
    const [ret] = await q<{ id: string }>("insert into product_returns(unit_id,sale_item_id,quantity,amount_cents,restock,refund_payment_id,reason,idempotency_key,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id", [ctx.unitId, it.id, i.quantity, amount, i.restock, refundId, why, key, ctx.userId]);
    if (i.restock && it.track_stock) await moveStock(q, ctx, it.product_id, i.quantity, "devolucao", ["product_return", ret.id], why);
    await adjustForReturnTx(q, ctx, it.id, ret.id, i.quantity, newQty, it.quantity);
    await audit(q, ctx, "PRODUTO_DEVOLVIDO", "product_sale_item", it.id, { due: r.amount_due_cents }, { due: newDue, quantity: i.quantity, amount, refund: refundId }, why);
    await emit(q, ctx, "product.refunded", "product_return", ret.id, { staffId: it.seller }, `product.refunded:${ret.id}`);
    return { id: ret.id, duplicate: false };
  });
}

export async function listSales(db: Db, ctx: Ctx, o: { limit?: number; offset?: number } = {}) {
  need(ctx, "products.sell", "products.manage", "finance.view");
  const own = !can(ctx, "finance.view") && !can(ctx, "products.manage");
  const rows = await db.query<{ id: string; finished_at: Date; customer_name: string | null; seller_name: string; total_cents: number; returned_cents: number; items: string; attendance_id: string | null; receivable_id: string; total: number }>(
    `select s.id, s.finished_at, c.name as customer_name, f.name as seller_name, s.total_cents, s.attendance_id, s.receivable_id,
       (select string_agg(i.quantity || '× ' || i.name_snapshot, ', ') from product_sale_items i where i.sale_id=s.id) as items, (select coalesce(sum(i.returned_cents),0) from product_sale_items i where i.sale_id=s.id)::bigint as returned_cents, count(*) over()::bigint as total
     from product_sales s join staff f on f.id=s.seller_staff_id left join customers c on c.id=s.customer_id where s.unit_id=$1 and s.status='concluida' and ($2::uuid is null or s.seller_staff_id=$2) order by s.finished_at desc limit $3 offset $4`,
    [ctx.unitId, own ? ctx.staffId ?? "00000000-0000-0000-0000-000000000000" : null, o.limit ?? 30, o.offset ?? 0]);
  return { rows, total: rows[0]?.total ?? 0 };
}
export async function getSale(db: Db, ctx: Ctx, id: string) {
  need(ctx, "products.sell", "products.manage", "finance.view");
  const [s] = await db.query<Omit<Sale, "items"> & { finished_at: Date; customer_name: string | null; attendance_id: string | null }>("select s.id, s.status, s.gross_cents, s.discount_cents, s.discount_reason, s.total_cents, s.seller_staff_id, f.name as seller_name, s.receivable_id, s.finished_at, c.name as customer_name, s.attendance_id from product_sales s join staff f on f.id=s.seller_staff_id left join customers c on c.id=s.customer_id where s.id=$1 and s.unit_id=$2", [requireUuid(id, "Venda"), ctx.unitId]);
  if (!s) throw new DomainError("not_found", "Venda não encontrada.");
  if (!can(ctx, "finance.view") && !can(ctx, "products.manage") && s.seller_staff_id !== ctx.staffId) throw new ForbiddenError();
  return { ...s, items: await saleItems(db.query, id) };
}
