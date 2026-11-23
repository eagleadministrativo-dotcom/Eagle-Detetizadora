import type { Db } from "../db";
import { assertPeriodOpen, audit, need, requirePositive, requireText, requireUuid } from "../core";
import { DomainError } from "../errors";
import type { Ctx } from "../permissions";
import { addMonths, monthStart, todayYmd } from "@/lib/dates";
import { splitInstallments } from "@/lib/money";

/**
 * Compras planejadas. Enquanto pendente, é só uma lista. Ao marcar como comprada, cada parcela vira uma conta a pagar
 * (categoria escolhida) com vencimento e competência no mês da fatura: a despesa entra na DRE do mês certo.
 * Desmarcar cancela as contas, desde que nenhuma tenha sido paga.
 */
export interface PurchaseInput { name: string; notes?: string | null; quantity?: number; totalCents: number; payment: "avista" | "credito"; installments?: number; firstDue?: string | null; categoryId?: string | null; priority?: "baixa" | "normal" | "alta" }
export interface PurchaseRow {
  id: string; name: string; notes: string | null; quantity: number; total_cents: number; payment: string; installments: number; first_due: string | null; category_id: string | null; category_name: string | null;
  priority: string; status: string; bought_at: Date | null; bought_by_name: string | null; created_by_name: string; paid_cents: number; payable_count: number;
}

const ymd = (v: string | null | undefined, label: string) => {
  if (v == null || v === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new DomainError("invalid", `${label} inválida.`);
  return v;
};

function clean(i: PurchaseInput) {
  const name = requireText(i.name, "O que comprar", 2).slice(0, 120);
  requirePositive(i.totalCents, "Valor total");
  const installments = i.payment === "credito" ? i.installments ?? 1 : 1;
  if (!["avista", "credito"].includes(i.payment)) throw new DomainError("invalid", "Forma de pagamento inválida.");
  if (!Number.isInteger(installments) || installments < 1 || installments > 24) throw new DomainError("invalid", "Parcelas: de 1 a 24.");
  const quantity = i.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) throw new DomainError("invalid", "Quantidade inválida.");
  if (i.priority && !["baixa", "normal", "alta"].includes(i.priority)) throw new DomainError("invalid", "Prioridade inválida.");
  return { name, notes: i.notes?.trim().slice(0, 500) || null, quantity, total: i.totalCents, payment: i.payment, installments, firstDue: ymd(i.firstDue, "Data da fatura"), categoryId: i.categoryId ? requireUuid(i.categoryId, "Categoria") : null, priority: i.priority ?? "normal" };
}

export async function savePurchase(db: Db, ctx: Ctx, i: PurchaseInput & { id?: string | null }): Promise<string> {
  need(ctx, "purchases.manage");
  const v = clean(i);
  return db.tx(async (q) => {
    if (v.categoryId) { const [c] = await q("select 1 from financial_categories where id=$1 and unit_id=$2 and is_active", [v.categoryId, ctx.unitId]); if (!c) throw new DomainError("invalid", "Categoria inexistente."); }
    if (i.id) {
      const [cur] = await q<{ status: string }>("select status from purchase_items where id=$1 and unit_id=$2 for update", [requireUuid(i.id, "Compra"), ctx.unitId]);
      if (!cur) throw new DomainError("not_found", "Compra não encontrada.");
      if (cur.status !== "pendente") throw new DomainError("bad_status", "Desmarque como comprado antes de editar.");
      await q("update purchase_items set name=$2, notes=$3, quantity=$4, total_cents=$5, payment=$6, installments=$7, first_due=$8, category_id=$9, priority=$10, updated_at=now() where id=$1", [i.id, v.name, v.notes, v.quantity, v.total, v.payment, v.installments, v.firstDue, v.categoryId, v.priority]);
      await audit(q, ctx, "COMPRA_ALTERADA", "purchase", i.id, null, v);
      return i.id;
    }
    const [r] = await q<{ id: string }>("insert into purchase_items(unit_id,name,notes,quantity,total_cents,payment,installments,first_due,category_id,priority,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id", [ctx.unitId, v.name, v.notes, v.quantity, v.total, v.payment, v.installments, v.firstDue, v.categoryId, v.priority, ctx.userId]);
    await audit(q, ctx, "COMPRA_CRIADA", "purchase", r.id, null, v);
    return r.id;
  });
}

/** Marca como comprada: gera as parcelas em contas a pagar. Repetir não duplica. */
export async function markBought(db: Db, ctx: Ctx, id: string, o: { firstDue: string; categoryId: string }) {
  need(ctx, "purchases.manage");
  need(ctx, "finance.manage");
  const first = ymd(o.firstDue, "Data da fatura ou vencimento")!;
  if (!first) throw new DomainError("invalid", "Informe a data da fatura ou do vencimento.");
  return db.tx(async (q) => {
    const [p] = await q<{ name: string; total_cents: number; installments: number; payment: string; status: string; quantity: number }>("select name,total_cents,installments,payment,status,quantity from purchase_items where id=$1 and unit_id=$2 for update", [requireUuid(id, "Compra"), ctx.unitId]);
    if (!p) throw new DomainError("not_found", "Compra não encontrada.");
    if (p.status === "comprado") return { created: 0 };
    if (p.status !== "pendente") throw new DomainError("bad_status", "Esta compra foi cancelada.");
    const [cat] = await q<{ kind: string }>("select kind from financial_categories where id=$1 and unit_id=$2 and is_active", [requireUuid(o.categoryId, "Categoria"), ctx.unitId]);
    if (!cat) throw new DomainError("invalid", "Categoria inexistente ou inativa.");
    await assertPeriodOpen(q, ctx.unitId, first);
    const parts = splitInstallments(p.total_cents, p.installments);
    const ids: string[] = [];
    for (const [k, amount] of parts.entries()) {
      const due = addMonths(first, k);
      const desc = p.name; // o número da parcela já aparece pela própria conta
      // competência = mês da fatura: a despesa cai nos gastos daquele mês
      const [r] = await q<{ id: string }>(
        "insert into payables(unit_id,category_id,description,supplier,amount_cents,due_date,competence_date,installment_no,installment_total,notes,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id",
        [ctx.unitId, o.categoryId, desc, p.payment === "credito" ? "Cartão de crédito" : null, amount, due, monthStart(due), p.installments > 1 ? k + 1 : null, p.installments > 1 ? p.installments : null, `Compra registrada na lista de compras${p.quantity > 1 ? ` · ${p.quantity} un.` : ""}`, ctx.userId]);
      ids.push(r.id);
    }
    await q("update purchase_items set status='comprado', bought_at=now(), bought_by=$2, first_due=$3, category_id=$4, payable_ids=$5, updated_at=now() where id=$1", [id, ctx.userId, first, o.categoryId, ids]);
    await audit(q, ctx, "COMPRA_REALIZADA", "purchase", id, null, { payables: ids, first, total: p.total_cents, installments: p.installments });
    return { created: ids.length };
  });
}

/** Desfaz a marcação: cancela as parcelas, se nenhuma foi paga. */
export async function unmarkBought(db: Db, ctx: Ctx, id: string) {
  need(ctx, "purchases.manage");
  need(ctx, "finance.manage");
  await db.tx(async (q) => {
    const [p] = await q<{ status: string; payable_ids: string[] }>("select status, payable_ids from purchase_items where id=$1 and unit_id=$2 for update", [requireUuid(id, "Compra"), ctx.unitId]);
    if (!p) throw new DomainError("not_found", "Compra não encontrada.");
    if (p.status !== "comprado") throw new DomainError("bad_status", "Esta compra não está marcada como comprada.");
    const [paid] = await q<{ n: number }>("select count(*)::bigint as n from payable_balances where payable_id = any($1::uuid[]) and paid_cents <> 0", [p.payable_ids]);
    if (paid.n > 0) throw new DomainError("paid", "Uma parcela já foi paga. Estorne o pagamento em Contas a pagar antes de desfazer.");
    for (const pid of p.payable_ids) {
      const [b] = await q<{ due: string }>("select to_char(coalesce(competence_date,due_date),'YYYY-MM-DD') as due from payables where id=$1", [pid]);
      if (b) await assertPeriodOpen(q, ctx.unitId, b.due);
    }
    await q("update payables set status='cancelado', cancel_reason='Compra desmarcada' where id = any($1::uuid[]) and status='ativo'", [p.payable_ids]);
    await q("update purchase_items set status='pendente', bought_at=null, bought_by=null, payable_ids='{}', updated_at=now() where id=$1", [id]);
    await audit(q, ctx, "COMPRA_DESFEITA", "purchase", id, { payables: p.payable_ids }, null);
  });
}

export async function removePurchase(db: Db, ctx: Ctx, id: string) {
  need(ctx, "purchases.manage");
  await db.tx(async (q) => {
    const r = await q("update purchase_items set status='cancelado', updated_at=now() where id=$1 and unit_id=$2 and status='pendente' returning name", [requireUuid(id, "Compra"), ctx.unitId]);
    if (!r.length) throw new DomainError("bad_status", "Só é possível remover compras pendentes.");
    await audit(q, ctx, "COMPRA_REMOVIDA", "purchase", id, r[0]);
  });
}

export async function listPurchases(db: Db, ctx: Ctx, status: "pendente" | "comprado") {
  need(ctx, "purchases.manage");
  return db.query<PurchaseRow>(
    `select p.id, p.name, p.notes, p.quantity, p.total_cents, p.payment, p.installments, to_char(p.first_due,'YYYY-MM-DD') as first_due, p.category_id, c.name as category_name, p.priority, p.status, p.bought_at,
       bu.full_name as bought_by_name, cu.full_name as created_by_name,
       coalesce((select sum(b.paid_cents) from payable_balances b where b.payable_id = any(p.payable_ids)),0)::bigint as paid_cents, cardinality(p.payable_ids) as payable_count
     from purchase_items p left join financial_categories c on c.id=p.category_id left join users bu on bu.id=p.bought_by join users cu on cu.id=p.created_by
     where p.unit_id=$1 and p.status=$2 order by ${status === "pendente" ? "array_position(array['alta','normal','baixa'], p.priority), p.created_at" : "p.bought_at desc"} limit 300`, [ctx.unitId, status]);
}

/** Quanto das compras já feitas cai em cada mês (parcelas em aberto ou pagas, por competência). */
export async function purchaseSchedule(db: Db, ctx: Ctx, months = 6) {
  need(ctx, "purchases.manage");
  const start = monthStart(todayYmd());
  const rows = await db.query<{ m: string; cents: number; paid: number }>(
    `select to_char(date_trunc('month', coalesce(b.competence_date,b.due_date)),'YYYY-MM-DD') as m, sum(b.amount_cents)::bigint as cents, sum(bb.paid_cents)::bigint as paid
     from purchase_items p join payables b on b.id = any(p.payable_ids) join payable_balances bb on bb.payable_id=b.id
     where p.unit_id=$1 and p.status='comprado' and b.status='ativo' and coalesce(b.competence_date,b.due_date) >= $2::date and coalesce(b.competence_date,b.due_date) < $3::date group by 1`,
    [ctx.unitId, start, addMonths(start, months)]);
  return Array.from({ length: months }, (_, i) => { const m = addMonths(start, i); const r = rows.find((x) => x.m === m); return { month: m, cents: r?.cents ?? 0, paid: r?.paid ?? 0 }; });
}

export async function expenseCategories(db: Db, ctx: Ctx) {
  return db.query<{ id: string; name: string; kind: string }>("select id, name, kind from financial_categories where unit_id=$1 and is_active and kind in ('custo','despesa') order by kind desc, sort_order, name", [ctx.unitId]);
}
