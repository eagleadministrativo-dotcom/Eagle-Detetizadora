import type { Db, Q } from "../db";
import { assertPeriodOpen, audit, finishAutomation, need, requirePositive, requireText, requireUuid, startAutomation } from "../core";
import { DomainError } from "../errors";
import type { Ctx } from "../permissions";
import { addDays, addMonths, todayYmd, toYmd } from "@/lib/dates";
import { splitInstallments } from "@/lib/money";
import { expectedByMethod, findOpenSession } from "./cash";

export interface CreatePayableInput {
  categoryId: string; description: string; supplier?: string | null; amountCents: number; dueDate: string; competenceDate?: string | null;
  recurrence?: "mensal" | "trimestral" | "anual" | null; installments?: number | null; notes?: string | null;
}

const validYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export async function createPayable(db: Db, ctx: Ctx, input: CreatePayableInput): Promise<string[]> {
  need(ctx, "finance.manage");
  requireUuid(input.categoryId, "Categoria");
  const description = requireText(input.description, "Descrição", 3);
  requirePositive(input.amountCents, "Valor");
  if (!validYmd(input.dueDate)) throw new DomainError("invalid", "Data de vencimento inválida.");
  const n = input.installments && input.installments > 1 ? input.installments : 1;
  if (n > 60) throw new DomainError("invalid", "Máximo de 60 parcelas.");
  if (n > 1 && input.recurrence) throw new DomainError("invalid", "Escolha parcelamento ou recorrência, não os dois.");
  return db.tx(async (q) => {
    await assertPeriodOpen(q, ctx.unitId, input.competenceDate ?? input.dueDate);
    const [cat] = await q<{ kind: string }>("select kind from financial_categories where id=$1 and unit_id=$2 and is_active", [input.categoryId, ctx.unitId]);
    if (!cat) throw new DomainError("invalid_category", "Categoria inexistente ou inativa.");
    const amounts = splitInstallments(input.amountCents, n);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const due = addMonths(input.dueDate, i);
      const [p] = await q<{ id: string }>(
        `insert into payables(unit_id,category_id,description,supplier,amount_cents,due_date,competence_date,recurrence,installment_no,installment_total,notes,created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [ctx.unitId, input.categoryId, description, input.supplier ?? null, amounts[i], due, input.competenceDate ? addMonths(input.competenceDate, i) : null, input.recurrence ?? null, n > 1 ? i + 1 : null, n > 1 ? n : null, input.notes ?? null, ctx.userId],
      );
      ids.push(p.id);
    }
    await audit(q, ctx, "CONTA_PAGAR_CRIADA", "payable", ids[0], null, { description, amount: input.amountCents, installments: n, recurrence: input.recurrence ?? null });
    return ids;
  });
}

export interface PayRow {
  id: string; description: string; supplier: string | null; category_name: string; category_kind: string; amount_cents: number; paid_cents: number; due_date: string;
  recurrence: string | null; installment_no: number | null; installment_total: number | null; status: string; recurrence_parent_id: string | null;
  pay_status: "pendente" | "parcialmente_pago" | "pago" | "cancelado"; overdue: boolean;
}

export async function listPayables(db: Db, ctx: Ctx, opts: { filter?: "abertas" | "pagas" | "todas"; from?: string; to?: string; limit?: number; offset?: number } = {}) {
  need(ctx, "finance.view");
  const today = todayYmd();
  const rows = await db.query<PayRow & { total: number }>(
    `select *, count(*) over() as total from (
       select p.id, p.description, p.supplier, c.name as category_name, c.kind as category_kind, p.amount_cents, b.paid_cents, to_char(p.due_date,'YYYY-MM-DD') as due_date,
         p.recurrence, p.installment_no, p.installment_total, p.status, p.recurrence_parent_id,
         case when p.status='cancelado' then 'cancelado' when b.paid_cents >= p.amount_cents then 'pago' when b.paid_cents > 0 then 'parcialmente_pago' else 'pendente' end as pay_status,
         (p.status='ativo' and b.paid_cents < p.amount_cents and p.due_date < $2::date) as overdue
       from payables p join payable_balances b on b.payable_id=p.id join financial_categories c on c.id=p.category_id
       where p.unit_id=$1 and ($3::date is null or p.due_date >= $3) and ($4::date is null or p.due_date <= $4)
     ) x
     where case $5 when 'abertas' then pay_status in ('pendente','parcialmente_pago') when 'pagas' then pay_status='pago' else true end
     order by due_date, description limit $6 offset $7`,
    [ctx.unitId, today, opts.from ?? null, opts.to ?? null, opts.filter ?? "todas", opts.limit ?? 100, opts.offset ?? 0],
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

export async function getPayable(db: Db, ctx: Ctx, id: string) {
  need(ctx, "finance.view");
  const [p] = await db.query<PayRow>(
    `select p.id, p.description, p.supplier, c.name as category_name, c.kind as category_kind, p.amount_cents, b.paid_cents, to_char(p.due_date,'YYYY-MM-DD') as due_date,
       p.recurrence, p.installment_no, p.installment_total, p.status, p.recurrence_parent_id,
       case when p.status='cancelado' then 'cancelado' when b.paid_cents >= p.amount_cents then 'pago' when b.paid_cents > 0 then 'parcialmente_pago' else 'pendente' end as pay_status, false as overdue
     from payables p join payable_balances b on b.payable_id=p.id join financial_categories c on c.id=p.category_id where p.id=$1 and p.unit_id=$2`,
    [id, ctx.unitId],
  );
  if (!p) throw new DomainError("not_found", "Conta não encontrada.");
  const payments = await db.query<{ id: string; kind: string; amount_cents: number; paid_at: Date; evidence: string | null; account_name: string | null; by_name: string; reversed: boolean }>(
    `select pp.id, pp.kind, pp.amount_cents, pp.paid_at, pp.evidence, fa.name as account_name, u.full_name as by_name, exists(select 1 from payable_payments x where x.reversal_of=pp.id) as reversed
     from payable_payments pp left join financial_accounts fa on fa.id=pp.account_id join users u on u.id=pp.created_by where pp.payable_id=$1 order by pp.created_at`, [id]);
  return { payable: p, payments };
}

export async function payPayableTx(q: Q, ctx: Ctx, input: { payableId: string; amountCents: number; accountId: string; idempotencyKey: string; evidence?: string | null; paidAt?: Date }) {
  need(ctx, "finance.manage");
  requirePositive(input.amountCents, "Valor do pagamento");
  const key = requireText(input.idempotencyKey, "Chave de idempotência", 8);
  const [dup] = await q<{ id: string }>("select id from payable_payments where idempotency_key=$1", [key]);
  if (dup) return { id: dup.id, duplicate: true };
  if (input.paidAt) await assertPeriodOpen(q, ctx.unitId, toYmd(input.paidAt));
  const [p] = await q<{ amount_cents: number; status: string }>("select amount_cents,status from payables where id=$1 and unit_id=$2 for update", [input.payableId, ctx.unitId]);
  if (!p) throw new DomainError("not_found", "Conta não encontrada.");
  if (p.status !== "ativo") throw new DomainError("bad_status", "Esta conta foi cancelada.");
  const [b] = await q<{ paid_cents: number }>("select paid_cents from payable_balances where payable_id=$1", [input.payableId]);
  if (b.paid_cents + input.amountCents > p.amount_cents) throw new DomainError("overpay", `O valor excede o saldo da conta (saldo: ${((p.amount_cents - b.paid_cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).`);
  const [acc] = await q<{ kind: string }>("select kind from financial_accounts where id=$1 and unit_id=$2 and is_active", [input.accountId, ctx.unitId]);
  if (!acc) throw new DomainError("invalid_account", "Conta financeira inexistente ou inativa.");
  let sessionId: string | null = null;
  if (acc.kind === "caixa") {
    const s = await findOpenSession(q, ctx.unitId);
    if (!s || s.account_id !== input.accountId) throw new DomainError("cash_closed", "Abra o caixa para pagar com dinheiro do caixa.");
    sessionId = s.id;
    const [dinheiro] = await q<{ id: string }>("select id from payment_methods where unit_id=$1 and kind='dinheiro' and is_active order by sort_order limit 1", [ctx.unitId]);
    if (!dinheiro) throw new DomainError("no_cash_method", "Cadastre uma forma de pagamento do tipo Dinheiro.");
    const cash = (await expectedByMethod(q, s.id)).filter((t) => t.kind === "dinheiro").reduce((a, t) => a + t.expected_cents, 0);
    if (input.amountCents > cash) throw new DomainError("insufficient_cash", "Dinheiro insuficiente no caixa para esta despesa.");
  }
  const [pp] = await q<{ id: string }>(
    "insert into payable_payments(unit_id,payable_id,account_id,cash_session_id,amount_cents,paid_at,idempotency_key,evidence,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id",
    [ctx.unitId, input.payableId, input.accountId, sessionId, input.amountCents, input.paidAt ?? new Date(), key, input.evidence ?? null, ctx.userId],
  );
  if (sessionId) {
    const [m] = await q<{ id: string }>("select id from payment_methods where unit_id=$1 and kind='dinheiro' and is_active order by sort_order limit 1", [ctx.unitId]);
    await q("insert into cash_movements(unit_id,cash_session_id,kind,method_id,amount_cents,direction,description,idempotency_key,created_by) values ($1,$2,'despesa',$3,$4,-1,$5,$6,$7)", [
      ctx.unitId, sessionId, m.id, input.amountCents, "Pagamento de conta", `pp:${key}`, ctx.userId,
    ]);
  }
  await audit(q, ctx, "CONTA_PAGA", "payable_payment", pp.id, null, { payable: input.payableId, amount: input.amountCents, account: input.accountId });
  return { id: pp.id, duplicate: false };
}

export async function payPayable(db: Db, ctx: Ctx, input: Parameters<typeof payPayableTx>[2]) {
  try {
    return await db.tx((q) => payPayableTx(q, ctx, input));
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return db.tx((q) => payPayableTx(q, ctx, input));
    throw e;
  }
}

export async function reversePayablePayment(db: Db, ctx: Ctx, paymentId: string, reason: string) {
  need(ctx, "payments.reverse");
  const why = requireText(reason, "Motivo do estorno", 3);
  await db.tx(async (q) => {
    const [pp] = await q<{ id: string; payable_id: string; account_id: string | null; amount_cents: number; kind: string }>("select id,payable_id,account_id,amount_cents,kind from payable_payments where id=$1 and unit_id=$2 for update", [paymentId, ctx.unitId]);
    if (!pp) throw new DomainError("not_found", "Pagamento não encontrado.");
    if (pp.kind !== "pagamento") throw new DomainError("bad_status", "Um estorno não pode ser estornado.");
    const [already] = await q("select 1 from payable_payments where reversal_of=$1", [paymentId]);
    if (already) throw new DomainError("already_reversed", "Este pagamento já foi estornado.");
    let sessionId: string | null = null;
    const [acc] = pp.account_id ? await q<{ kind: string }>("select kind from financial_accounts where id=$1", [pp.account_id]) : [];
    if (acc?.kind === "caixa") {
      const s = await findOpenSession(q, ctx.unitId);
      if (!s) throw new DomainError("cash_closed", "Abra o caixa para estornar um pagamento feito com dinheiro do caixa.");
      sessionId = s.id;
    }
    const [rev] = await q<{ id: string }>(
      "insert into payable_payments(unit_id,payable_id,account_id,cash_session_id,kind,reversal_of,amount_cents,idempotency_key,evidence,created_by) values ($1,$2,$3,$4,'estorno',$5,$6,$7,$8,$9) returning id",
      [ctx.unitId, pp.payable_id, pp.account_id, sessionId, pp.id, pp.amount_cents, `ppreversal:${pp.id}`, why, ctx.userId],
    );
    if (sessionId) {
      const [m] = await q<{ id: string }>("select id from payment_methods where unit_id=$1 and kind='dinheiro' and is_active order by sort_order limit 1", [ctx.unitId]);
      await q("insert into cash_movements(unit_id,cash_session_id,kind,method_id,amount_cents,direction,description,idempotency_key,created_by) values ($1,$2,'ajuste',$3,$4,1,$5,$6,$7)", [
        ctx.unitId, sessionId, m.id, pp.amount_cents, `Estorno de pagamento de conta: ${why}`, `ppr:${pp.id}`, ctx.userId,
      ]);
    }
    await audit(q, ctx, "CONTA_PAGAMENTO_ESTORNADO", "payable_payment", pp.id, null, { reversal: rev.id }, why);
  });
}

export async function cancelPayable(db: Db, ctx: Ctx, id: string, reason: string) {
  need(ctx, "finance.manage");
  const why = requireText(reason, "Motivo do cancelamento", 3);
  await db.tx(async (q) => {
    const [b] = await q<{ paid_cents: number }>("select b.paid_cents from payable_balances b join payables p on p.id=b.payable_id where p.id=$1 and p.unit_id=$2", [id, ctx.unitId]);
    if (!b) throw new DomainError("not_found", "Conta não encontrada.");
    if (b.paid_cents !== 0) throw new DomainError("has_payments", "Há pagamentos nesta conta. Estorne-os antes de cancelar.");
    await q("update payables set status='cancelado', cancel_reason=$2 where id=$1", [id, why]);
    await audit(q, ctx, "CONTA_PAGAR_CANCELADA", "payable", id, null, null, why);
  });
}

export async function addCapitalEntry(db: Db, ctx: Ctx, input: { kind: "aporte" | "emprestimo"; amountCents: number; entryDate: string; accountId?: string | null; description: string; idempotencyKey: string }) {
  need(ctx, "finance.manage");
  requirePositive(input.amountCents, "Valor");
  if (!validYmd(input.entryDate)) throw new DomainError("invalid", "Data inválida.");
  const description = requireText(input.description, "Descrição", 3);
  return db.tx(async (q) => {
    await assertPeriodOpen(q, ctx.unitId, input.entryDate);
    const [dup] = await q<{ id: string }>("select id from capital_entries where idempotency_key=$1", [input.idempotencyKey]);
    if (dup) return dup.id;
    const [r] = await q<{ id: string }>("insert into capital_entries(unit_id,kind,amount_cents,entry_date,account_id,description,idempotency_key,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id", [
      ctx.unitId, input.kind, input.amountCents, input.entryDate, input.accountId || null, description, input.idempotencyKey, ctx.userId,
    ]);
    await audit(q, ctx, input.kind === "aporte" ? "APORTE_REGISTRADO" : "EMPRESTIMO_REGISTRADO", "capital_entry", r.id, null, { amount: input.amountCents, description });
    return r.id;
  });
}

export async function listCapitalEntries(db: Db, ctx: Ctx) {
  need(ctx, "finance.view");
  return db.query<{ id: string; kind: string; amount_cents: number; entry_date: string; description: string | null; account_name: string | null }>(
    "select c.id, c.kind, c.amount_cents, to_char(c.entry_date,'YYYY-MM-DD') as entry_date, c.description, a.name as account_name from capital_entries c left join financial_accounts a on a.id=c.account_id where c.unit_id=$1 order by c.entry_date desc, c.created_at desc limit 100",
    [ctx.unitId],
  );
}

// ---------- metas ----------
export async function saveGoal(db: Db, ctx: Ctx, input: { id?: string; kind: "receita" | "resultado" | "reserva"; name: string; targetCents: number; periodStart?: string | null; periodEnd?: string | null; isActive?: boolean }) {
  need(ctx, "finance.goals");
  const name = requireText(input.name, "Nome da meta");
  if (!Number.isInteger(input.targetCents) || input.targetCents < 0) throw new DomainError("invalid", "Valor da meta inválido.");
  if (input.kind !== "reserva" && (!input.periodStart || !input.periodEnd)) throw new DomainError("invalid", "Informe o período da meta.");
  await db.tx(async (q) => {
    if (input.id) await q("update financial_goals set kind=$2,name=$3,target_cents=$4,period_start=$5,period_end=$6,is_active=$7 where id=$1 and unit_id=$8", [input.id, input.kind, name, input.targetCents, input.periodStart || null, input.periodEnd || null, input.isActive ?? true, ctx.unitId]);
    else await q("insert into financial_goals(unit_id,kind,name,target_cents,period_start,period_end,is_active) values ($1,$2,$3,$4,$5,$6,$7)", [ctx.unitId, input.kind, name, input.targetCents, input.periodStart || null, input.periodEnd || null, input.isActive ?? true]);
    await audit(q, ctx, "META_SALVA", "financial_goal", input.id ?? null, null, { name, kind: input.kind, target: input.targetCents });
  });
}

// ---------- automações A07 / A08 ----------
const STEP: Record<string, number> = { mensal: 1, trimestral: 3, anual: 12 };

/** A07: gera as próximas ocorrências das contas recorrentes (idempotente pela chave única pai+vencimento). */
export async function generateRecurringPayables(db: Db, unitId: string, today = todayYmd(), horizonDays = 35) {
  return db.tx(async (q) => {
    const roots = await q<{ id: string; category_id: string; description: string; supplier: string | null; amount_cents: number; due_date: string; competence_date: string | null; recurrence: string; created_by: string | null }>(
      "select id, category_id, description, supplier, amount_cents, to_char(due_date,'YYYY-MM-DD') as due_date, to_char(competence_date,'YYYY-MM-DD') as competence_date, recurrence, created_by from payables where unit_id=$1 and recurrence is not null and recurrence_parent_id is null and status='ativo'",
      [unitId],
    );
    const limit = addDays(today, horizonDays);
    let created = 0;
    for (const r of roots) {
      for (let k = 1; k < 600; k++) {
        const due = addMonths(r.due_date, k * STEP[r.recurrence]);
        if (due > limit) break;
        const res = await q(
          `insert into payables(unit_id,category_id,description,supplier,amount_cents,due_date,competence_date,recurrence_parent_id,created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (recurrence_parent_id, due_date) where recurrence_parent_id is not null do nothing returning id`,
          [unitId, r.category_id, r.description, r.supplier, r.amount_cents, due, r.competence_date ? addMonths(r.competence_date, k * STEP[r.recurrence]) : null, r.id, r.created_by],
        );
        created += res.length;
      }
    }
    await finishAutomation(q, "A07", unitId, null, "ROTINA_DIARIA", { today }, { created });
    return { created };
  });
}

/** A08: notificações de vencimento, sem duplicar no mesmo dia. */
export async function alertDueDates(db: Db, unitId: string, today = todayYmd()) {
  return db.tx(async (q) => {
    if (!(await startAutomation(q, "A08", unitId, `a08:${today}`, "ROTINA_DIARIA", { today }))) return { sent: 0 };
    const due = await q<{ id: string; description: string; due_date: string; balance: number }>(
      `select p.id, p.description, to_char(p.due_date,'YYYY-MM-DD') as due_date, (p.amount_cents - b.paid_cents)::bigint as balance
       from payables p join payable_balances b on b.payable_id=p.id
       where p.unit_id=$1 and p.status='ativo' and b.paid_cents < p.amount_cents and p.due_date <= $2::date + 7`,
      [unitId, today],
    );
    let sent = 0;
    for (const d of due) {
      const overdue = d.due_date < today;
      const sev = overdue || d.due_date === today ? "critico" : "atencao";
      const msg = overdue ? `Conta vencida em ${d.due_date.split("-").reverse().join("/")}: ${d.description}` : d.due_date === today ? `Conta vence hoje: ${d.description}` : `Conta vence em ${d.due_date.split("-").reverse().join("/")}: ${d.description}`;
      const r = await q("insert into notifications(unit_id,kind,severity,message,ref_entity,ref_id,dedupe_key) values ($1,'vencimento',$2,$3,'payable',$4,$5) on conflict (dedupe_key) do nothing returning id", [unitId, sev, msg, d.id, `due:${d.id}:${today}`]);
      sent += r.length;
    }
    await finishAutomation(q, "A08", unitId, `a08:${today}`, "ROTINA_DIARIA", { today }, { sent });
    return { sent };
  });
}
