import type { Db, Q } from "../db";
import { assertPeriodOpen, audit, can, finishAutomation, need, requirePositive, requireText, requireUuid } from "../core";
import { toYmd } from "@/lib/dates";
import { DomainError, ForbiddenError } from "../errors";
import type { Ctx } from "../permissions";
import { feeCents } from "@/lib/money";
import { findOpenSession } from "./cash";
import { emit } from "./events";
import { syncCommissions } from "./commissions";

export interface RegisterPaymentInput {
  receivableId: string; methodId: string; amountCents: number; idempotencyKey: string;
  reference?: string | null; paidAt?: Date; notes?: string | null;
}

export async function registerPaymentTx(q: Q, ctx: Ctx, input: RegisterPaymentInput): Promise<{ id: string; duplicate: boolean }> {
  need(ctx, "payments.register");
  const key = requireText(input.idempotencyKey, "Chave de idempotência", 8);
  requireUuid(input.receivableId, "Cobrança");
  requireUuid(input.methodId, "Forma de pagamento");
  requirePositive(input.amountCents, "Valor do pagamento");

  const [dup] = await q<{ id: string; receivable_id: string; amount_cents: number }>("select id, receivable_id, amount_cents from payments where idempotency_key=$1", [key]);
  if (dup) {
    if (dup.receivable_id !== input.receivableId || dup.amount_cents !== input.amountCents) {
      throw new DomainError("idempotency_conflict", "Esta chave de operação já foi usada com outros dados.");
    }
    return { id: dup.id, duplicate: true };
  }

  if (input.paidAt) await assertPeriodOpen(q, ctx.unitId, toYmd(input.paidAt));
  const [r] = await q<{ id: string; amount_due_cents: number; status: string; staff_id: string | null }>(
    `select r.id, r.amount_due_cents, r.status, a.staff_id from receivables r left join attendances a on a.id=r.attendance_id
     where r.id=$1 and r.unit_id=$2 for update of r`,
    [input.receivableId, ctx.unitId],
  );
  if (!r) throw new DomainError("not_found", "Cobrança não encontrada.");
  if (r.status !== "ativo") throw new DomainError("bad_status", "Esta cobrança foi cancelada.");
  if (!can(ctx, "attendance.view_all") && r.staff_id && r.staff_id !== ctx.staffId) {
    throw new ForbiddenError("Você só pode registrar pagamentos dos seus próprios atendimentos.");
  }
  const [bal] = await q<{ registered_cents: number }>("select registered_cents from receivable_balances where receivable_id=$1", [r.id]);
  if (bal.registered_cents + input.amountCents > r.amount_due_cents) {
    const left = r.amount_due_cents - bal.registered_cents;
    throw new DomainError("overpay", `O valor excede o saldo da cobrança (saldo: ${(left / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).`);
  }
  const [m] = await q<{ id: string; kind: string; fee_bps: number; fee_fixed_cents: number }>("select id, kind, fee_bps, fee_fixed_cents from payment_methods where id=$1 and unit_id=$2 and is_active", [input.methodId, ctx.unitId]);
  if (!m) throw new DomainError("invalid_method", "Forma de pagamento inexistente ou inativa.");
  const session = await findOpenSession(q, ctx.unitId);
  if (m.kind === "dinheiro" && !session) throw new DomainError("cash_closed", "Abra o caixa para receber em dinheiro.");

  const isCash = m.kind === "dinheiro";
  const fee = feeCents(input.amountCents, m.fee_bps, m.fee_fixed_cents);
  const [p] = await q<{ id: string }>(
    `insert into payments(unit_id,receivable_id,method_id,cash_session_id,amount_cents,fee_cents,status,idempotency_key,reference,paid_at,registered_by,
        confirmed_by,confirmed_at,confirmation_evidence,notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
    [
      ctx.unitId, r.id, m.id, session?.id ?? null, input.amountCents, fee, isCash ? "confirmado" : "registrado", key, input.reference ?? null, input.paidAt ?? new Date(), ctx.userId,
      isCash ? ctx.userId : null, isCash ? new Date() : null, isCash ? "Espécie recebida pelo operador; conferida na contagem do fechamento do caixa." : null, input.notes ?? null,
    ],
  );
  if (session) {
    await q("insert into cash_movements(unit_id,cash_session_id,kind,method_id,amount_cents,direction,payment_id,description,idempotency_key,created_by) values ($1,$2,'recebimento',$3,$4,1,$5,$6,$7,$8)", [
      ctx.unitId, session.id, m.id, input.amountCents, p.id, "Recebimento de atendimento", `pay:${key}`, ctx.userId,
    ]);
  }
  await audit(q, ctx, "PAGAMENTO_REGISTRADO", "payment", p.id, null, { receivable: r.id, amount: input.amountCents, method: m.kind, status: isCash ? "confirmado" : "registrado" });
  await finishAutomation(q, "A05", ctx.unitId, `pay:${key}`, "PAGAMENTO_REGISTRADO", { receivable: r.id }, { payment: p.id });
  return { id: p.id, duplicate: false };
}

export async function registerPayment(db: Db, ctx: Ctx, input: RegisterPaymentInput) {
  try {
    return await db.tx((q) => registerPaymentTx(q, ctx, input));
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return db.tx((q) => registerPaymentTx(q, ctx, input)); // corrida com a mesma chave: devolve o já gravado
    throw e;
  }
}

export async function confirmPayment(db: Db, ctx: Ctx, paymentId: string, evidence: string) {
  need(ctx, "payments.confirm");
  const ev = requireText(evidence, "Evidência ou referência da conferência", 3);
  await db.tx(async (q) => {
    const [p] = await q<{ status: string; kind: string }>("select status, kind from payments where id=$1 and unit_id=$2 for update", [paymentId, ctx.unitId]);
    if (!p) throw new DomainError("not_found", "Pagamento não encontrado.");
    if (p.kind !== "recebimento") throw new DomainError("bad_status", "Estornos não são confirmados.");
    if (p.status !== "registrado") throw new DomainError("bad_status", "Este pagamento já foi conferido.");
    const [rv] = await q("select 1 from payments x join payments o on o.id=x.reversal_of where x.reversal_of=$1 and x.amount_cents >= o.amount_cents", [paymentId]);
    if (rv) throw new DomainError("reversed", "Este pagamento foi estornado.");
    await q("update payments set status='confirmado', confirmed_by=$2, confirmed_at=now(), confirmation_evidence=$3 where id=$1", [paymentId, ctx.userId, ev]);
    await audit(q, ctx, "PAGAMENTO_CONFIRMADO", "payment", paymentId, { status: "registrado" }, { status: "confirmado", evidence: ev });
  });
}

export async function settlePayment(db: Db, ctx: Ctx, paymentId: string) {
  need(ctx, "payments.confirm");
  await db.tx(async (q) => {
    const [p] = await q<{ status: string; kind: string }>("select status, kind from payments where id=$1 and unit_id=$2 for update", [paymentId, ctx.unitId]);
    if (!p) throw new DomainError("not_found", "Pagamento não encontrado.");
    if (p.kind !== "recebimento") throw new DomainError("bad_status", "Estornos não são liquidados.");
    if (p.status !== "confirmado") throw new DomainError("bad_status", p.status === "liquidado" ? "Já liquidado." : "Confirme o pagamento antes de registrar a liquidação.");
    const [rv] = await q("select 1 from payments x join payments o on o.id=x.reversal_of where x.reversal_of=$1 and x.amount_cents >= o.amount_cents", [paymentId]);
    if (rv) throw new DomainError("reversed", "Este pagamento foi estornado.");
    await q("update payments set status='liquidado', liquidated_by=$2, liquidated_at=now() where id=$1", [paymentId, ctx.userId]);
    await audit(q, ctx, "PAGAMENTO_LIQUIDADO", "payment", paymentId, { status: "confirmado" }, { status: "liquidado" });
  });
}

export async function flagDivergence(db: Db, ctx: Ctx, paymentId: string, note: string) {
  need(ctx, "payments.confirm");
  const n = requireText(note, "Descrição da divergência", 5);
  await db.tx(async (q) => {
    const r = await q("update payments set divergence_note=$2 where id=$1 and unit_id=$3 returning id", [paymentId, n, ctx.unitId]);
    if (!r.length) throw new DomainError("not_found", "Pagamento não encontrado.");
    await q("insert into notifications(unit_id,kind,severity,message,ref_entity,ref_id,dedupe_key) values ($1,'divergencia_pagamento','atencao',$2,'payment',$3,$4) on conflict (dedupe_key) do nothing", [
      ctx.unitId, `Divergência registrada em pagamento: ${n}`, paymentId, `paydiv:${paymentId}`,
    ]);
    await audit(q, ctx, "PAGAMENTO_DIVERGENCIA", "payment", paymentId, null, { note: n });
  });
}

export async function reversePayment(db: Db, ctx: Ctx, paymentId: string, reason: string) {
  need(ctx, "payments.reverse");
  const why = requireText(reason, "Motivo do estorno", 3);
  return db.tx(async (q) => {
    const [p] = await q<{ id: string; receivable_id: string; method_id: string; amount_cents: number; fee_cents: number; kind: string; method_kind: string; status: string }>(
      "select p.id, p.receivable_id, p.method_id, p.amount_cents, p.fee_cents, p.kind, p.status, m.kind as method_kind from payments p join payment_methods m on m.id=p.method_id where p.id=$1 and p.unit_id=$2 for update of p",
      [paymentId, ctx.unitId],
    );
    if (!p) throw new DomainError("not_found", "Pagamento não encontrado.");
    if (p.kind !== "recebimento") throw new DomainError("bad_status", "Um estorno não pode ser estornado.");
    const [already] = await q("select 1 from payments where reversal_of=$1", [paymentId]);
    if (already) throw new DomainError("already_reversed", "Este pagamento já foi estornado.");
    const session = await findOpenSession(q, ctx.unitId);
    if (p.method_kind === "dinheiro" && !session) throw new DomainError("cash_closed", "Abra o caixa para estornar um pagamento em dinheiro.");
    const [rev] = await q<{ id: string }>(
      `insert into payments(unit_id,receivable_id,method_id,cash_session_id,kind,reversal_of,amount_cents,fee_cents,status,idempotency_key,paid_at,registered_by,confirmed_by,confirmed_at,confirmation_evidence,notes)
       values ($1,$2,$3,$4,'estorno',$5,$6,$7,$11,$8,now(),$9,$9,now(),$10,$10) returning id`,
      [ctx.unitId, p.receivable_id, p.method_id, session?.id ?? null, p.id, p.amount_cents, p.fee_cents, `reversal:${p.id}`, ctx.userId, why, p.status],
    );
    if (session) {
      await q("insert into cash_movements(unit_id,cash_session_id,kind,method_id,amount_cents,direction,payment_id,description,idempotency_key,created_by) values ($1,$2,'estorno',$3,$4,-1,$5,$6,$7,$8)", [
        ctx.unitId, session.id, p.method_id, p.amount_cents, rev.id, `Estorno: ${why}`, `rev:${p.id}`, ctx.userId,
      ]);
    }
    await audit(q, ctx, "PAGAMENTO_ESTORNADO", "payment", p.id, null, { reversal: rev.id, amount: p.amount_cents }, why);
    return rev.id;
  });
}

// ---------- consultas ----------
export interface ReceivableRow {
  id: string; description: string; customer_name: string | null; amount_due_cents: number; registered_cents: number; confirmed_cents: number; settled_cents: number;
  due_date: string; status: string; attendance_id: string | null; created_at: Date; staff_name: string | null;
  pay_status: "pendente" | "parcialmente_recebido" | "recebido" | "cancelado"; conc_status: "nao_conciliado" | "parcialmente_conciliado" | "conciliado";
}

export async function listReceivables(db: Db, ctx: Ctx, opts: { filter?: "abertos" | "todos" | "nao_conciliados"; search?: string; limit?: number; offset?: number } = {}) {
  need(ctx, "finance.view", "finance.receivables_view", "attendance.view_all", "attendance.view_own");
  const own = !can(ctx, "finance.view") && !can(ctx, "finance.receivables_view") && !can(ctx, "attendance.view_all");
  const rows = await db.query<ReceivableRow & { total: number }>(
    `select *, count(*) over() as total from (
       select r.id, r.description, c.name as customer_name, r.amount_due_cents, b.registered_cents, b.confirmed_cents, b.settled_cents,
         to_char(r.due_date,'YYYY-MM-DD') as due_date, r.status, r.attendance_id, r.created_at, s.name as staff_name,
         case when r.status='cancelado' then 'cancelado' when b.registered_cents >= r.amount_due_cents then 'recebido' when b.registered_cents > 0 then 'parcialmente_recebido' else 'pendente' end as pay_status,
         case when b.registered_cents > 0 and b.settled_cents >= b.registered_cents then 'conciliado' when b.confirmed_cents > 0 or b.settled_cents > 0 then 'parcialmente_conciliado' else 'nao_conciliado' end as conc_status
       from receivables r join receivable_balances b on b.receivable_id=r.id
       left join customers c on c.id=r.customer_id left join attendances a on a.id=r.attendance_id left join staff s on s.id=a.staff_id
       where r.unit_id=$1 and ($2::uuid is null or a.staff_id=$2) and ($3::text is null or lower(coalesce(c.name,'') || ' ' || r.description) like $3)
     ) x
     where case $4 when 'abertos' then pay_status in ('pendente','parcialmente_recebido') when 'nao_conciliados' then registered_cents > 0 and conc_status <> 'conciliado' else true end
     order by created_at desc limit $5 offset $6`,
    [ctx.unitId, own ? ctx.staffId ?? "00000000-0000-0000-0000-000000000000" : null, opts.search ? `%${opts.search.toLowerCase()}%` : null, opts.filter ?? "todos", opts.limit ?? 50, opts.offset ?? 0],
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

export interface PaymentRow {
  id: string; receivable_id: string; kind: string; status: string; amount_cents: number; fee_cents: number; method_name: string; method_kind: string; paid_at: Date;
  reference: string | null; confirmation_evidence: string | null; confirmed_at: Date | null; confirmed_by_name: string | null; registered_by_name: string;
  divergence_note: string | null; liquidated_at: Date | null; customer_name: string | null; reversal_of: string | null; reversed: boolean; notes: string | null;
}
const PAYMENT_SELECT = `select p.id, p.receivable_id, p.kind, p.status, p.amount_cents, p.fee_cents, m.name as method_name, m.kind as method_kind, p.paid_at, p.reference,
    p.confirmation_evidence, p.confirmed_at, cu.full_name as confirmed_by_name, ru.full_name as registered_by_name, p.divergence_note, p.liquidated_at,
    c.name as customer_name, p.reversal_of, exists(select 1 from payments x where x.reversal_of=p.id and x.amount_cents >= p.amount_cents) as reversed, p.notes
  from payments p join payment_methods m on m.id=p.method_id join users ru on ru.id=p.registered_by left join users cu on cu.id=p.confirmed_by
  join receivables r on r.id=p.receivable_id left join customers c on c.id=r.customer_id`;

export async function getReceivable(db: Db, ctx: Ctx, id: string) {
  need(ctx, "finance.view", "finance.receivables_view", "attendance.view_all", "attendance.view_own");
  const rows = await db.query<ReceivableRow>(
    `select r.id, r.description, c.name as customer_name, r.amount_due_cents, b.registered_cents, b.confirmed_cents, b.settled_cents, to_char(r.due_date,'YYYY-MM-DD') as due_date, r.status,
       r.attendance_id, r.created_at, s.name as staff_name,
       case when r.status='cancelado' then 'cancelado' when b.registered_cents >= r.amount_due_cents then 'recebido' when b.registered_cents > 0 then 'parcialmente_recebido' else 'pendente' end as pay_status,
       case when b.registered_cents > 0 and b.settled_cents >= b.registered_cents then 'conciliado' when b.confirmed_cents > 0 or b.settled_cents > 0 then 'parcialmente_conciliado' else 'nao_conciliado' end as conc_status
     from receivables r join receivable_balances b on b.receivable_id=r.id left join customers c on c.id=r.customer_id left join attendances a on a.id=r.attendance_id left join staff s on s.id=a.staff_id
     where r.id=$1 and r.unit_id=$2`,
    [id, ctx.unitId],
  );
  const r = rows[0];
  if (!r) throw new DomainError("not_found", "Cobrança não encontrada.");
  const payments = await db.query<PaymentRow>(`${PAYMENT_SELECT} where p.receivable_id=$1 order by p.registered_at`, [id]);
  return { receivable: r, payments };
}

export async function listPaymentsForReconciliation(db: Db, ctx: Ctx, status: "registrado" | "confirmado" | "divergentes", limit = 100) {
  need(ctx, "payments.confirm", "finance.view");
  return db.query<PaymentRow>(
    `${PAYMENT_SELECT} where p.unit_id=$1 and p.kind='recebimento' and (case $2 when 'divergentes' then p.divergence_note is not null else p.status=$2 end)
       and m.kind <> 'dinheiro' order by p.paid_at limit $3`,
    [ctx.unitId, status, limit],
  );
}

export async function createManualReceivable(db: Db, ctx: Ctx, input: { customerId?: string | null; description: string; amountCents: number; dueDate: string }) {
  need(ctx, "finance.manage");
  const description = requireText(input.description, "Descrição", 3);
  requirePositive(input.amountCents, "Valor");
  return db.tx(async (q) => {
    const [r] = await q<{ id: string }>("insert into receivables(unit_id,customer_id,description,amount_due_cents,due_date,created_by) values ($1,$2,$3,$4,$5,$6) returning id", [
      ctx.unitId, input.customerId || null, description, input.amountCents, input.dueDate, ctx.userId,
    ]);
    await audit(q, ctx, "RECEBIVEL_MANUAL_CRIADO", "receivable", r.id, null, { description, amount: input.amountCents });
    return r.id;
  });
}

export async function cancelReceivable(db: Db, ctx: Ctx, id: string, reason: string) {
  need(ctx, "finance.manage");
  const why = requireText(reason, "Motivo", 3);
  await db.tx(async (q) => {
    const [b] = await q<{ registered_cents: number }>("select b.registered_cents from receivable_balances b join receivables r on r.id=b.receivable_id where r.id=$1 and r.unit_id=$2", [id, ctx.unitId]);
    if (!b) throw new DomainError("not_found", "Cobrança não encontrada.");
    if (b.registered_cents !== 0) throw new DomainError("has_payments", "Há pagamentos nesta cobrança. Estorne-os antes de cancelar.");
    const [sold] = await q("select 1 from product_sales s join product_sale_items i on i.sale_id=s.id where s.receivable_id=$1 and i.returned_qty < i.quantity limit 1", [id]);
    if (sold) throw new DomainError("has_products", "Esta cobrança tem produtos vendidos. Registre a devolução antes de cancelar.");
    await q("update receivables set status='cancelado' where id=$1", [id]);
    await syncCommissions(q, ctx.unitId, id);
    const [att] = await q<{ staff_id: string }>("select a.staff_id from receivables r join attendances a on a.id=r.attendance_id where r.id=$1", [id]);
    await emit(q, ctx, "receivable.cancelled", "receivable", id, { staffId: att?.staff_id ?? null }, `receivable.cancelled:${id}`);
    await audit(q, ctx, "RECEBIVEL_CANCELADO", "receivable", id, null, null, why);
  });
}
