import type { Db, Q } from "../db";
import { assertPeriodOpen, audit, can, getSettings, need, requireText, requireUuid } from "../core";
import { DomainError, ForbiddenError } from "../errors";
import type { Ctx } from "../permissions";
import { dayEndUtc, dayStartUtc, todayYmd, toYmd, type Period } from "@/lib/dates";
import { payPayableTx } from "./finance";
import { emit } from "./events";
import { notifyUsers } from "./notify";
import type { FileInput } from "./tasks";

/**
 * Comissões.
 * Prioridade da regra (a mais específica vence): profissional+item > profissional+categoria > profissional > item > categoria > geral.
 * Cada lançamento guarda a regra, a base e o percentual usados; mudar a regra depois não altera lançamentos.
 * Estados: gerada → exigível (conforme a política) → aprovada (entra num repasse) → paga (pagamento do repasse).
 * O repasse é uma conta a pagar (custo): nunca entra como receita.
 */

// ---------- regras ----------
export interface RuleInput { scope: "servico" | "produto"; staffId?: string | null; serviceId?: string | null; categoryId?: string | null; productId?: string | null; pctBps: number; base: "bruto" | "liquido"; validFrom: string; note?: string | null }
export interface RuleRow { id: string; scope: string; staff_id: string | null; staff_name: string | null; target: string; pct_bps: number; base: string; valid_from: string; valid_to: string | null; note: string | null; created_by_name: string; active: boolean }

export async function saveRule(db: Db, ctx: Ctx, i: RuleInput): Promise<string> {
  need(ctx, "commissions.rules");
  if (!Number.isInteger(i.pctBps) || i.pctBps < 0 || i.pctBps > 10000) throw new DomainError("invalid", "Percentual deve ficar entre 0% e 100%.");
  if (!["bruto", "liquido"].includes(i.base)) throw new DomainError("invalid", "Defina a base de cálculo: bruto ou após descontos.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.validFrom)) throw new DomainError("invalid", "Data de vigência inválida.");
  if (i.validFrom < todayYmd()) throw new DomainError("past", "A vigência não pode começar no passado: comissões já geradas não são recalculadas.");
  const own = async (q: Q, table: string, id: string | null | undefined, label: string) => {
    if (!id) return;
    const [r] = await q(`select 1 from ${table} where id=$1 and unit_id=$2`, [requireUuid(id, label), ctx.unitId]);
    if (!r) throw new DomainError("not_found", `${label} não encontrado.`);
  };
  return db.tx(async (q) => {
    await own(q, "staff", i.staffId, "Profissional"); await own(q, "services", i.serviceId, "Serviço"); await own(q, "service_categories", i.categoryId, "Categoria"); await own(q, "products", i.productId, "Produto");
    const target = [ctx.unitId, i.scope, i.staffId ?? null, i.serviceId ?? null, i.categoryId ?? null, i.productId ?? null];
    const same = "unit_id=$1 and scope=$2 and staff_id is not distinct from $3::uuid and service_id is not distinct from $4::uuid and category_id is not distinct from $5::uuid and product_id is not distinct from $6::uuid";
    const prev = await q(`select id, pct_bps, base, to_char(valid_from,'YYYY-MM-DD') as valid_from from commission_rules where ${same} and valid_to is null`, target);
    // encerra a vigência anterior na véspera; regra do mesmo dia ainda sem uso é substituída pela mais nova
    await q(`update commission_rules set valid_to = greatest(valid_from, $7::date - 1) where ${same} and valid_to is null`, [...target, i.validFrom]);
    const [r] = await q<{ id: string }>("insert into commission_rules(unit_id,scope,staff_id,service_id,category_id,product_id,pct_bps,base,valid_from,note,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id", [...target, i.pctBps, i.base, i.validFrom, i.note ?? null, ctx.userId]);
    await audit(q, ctx, "COMISSAO_REGRA_ALTERADA", "commission_rule", r.id, prev, i);
    return r.id;
  });
}

export async function endRule(db: Db, ctx: Ctx, id: string) {
  need(ctx, "commissions.rules");
  await db.tx(async (q) => {
    const r = await q("update commission_rules set valid_to=greatest(valid_from, $3::date) where id=$1 and unit_id=$2 and valid_to is null returning id", [requireUuid(id, "Regra"), ctx.unitId, todayYmd()]);
    if (!r.length) throw new DomainError("not_found", "Regra não encontrada ou já encerrada.");
    await audit(q, ctx, "COMISSAO_REGRA_ENCERRADA", "commission_rule", id);
  });
}

export async function listRules(db: Db, ctx: Ctx): Promise<RuleRow[]> {
  need(ctx, "commissions.rules", "commissions.view_all");
  return db.query<RuleRow>(
    `select r.id, r.scope, r.staff_id, s.name as staff_name, coalesce(sv.name, 'Categoria ' || c.name, p.name, 'Todos') as target, r.pct_bps, r.base, to_char(r.valid_from,'YYYY-MM-DD') as valid_from, to_char(r.valid_to,'YYYY-MM-DD') as valid_to,
       r.note, u.full_name as created_by_name, (r.valid_to is null or r.valid_to >= $2::date) as active
     from commission_rules r left join staff s on s.id=r.staff_id left join services sv on sv.id=r.service_id left join service_categories c on c.id=r.category_id left join products p on p.id=r.product_id join users u on u.id=r.created_by
     where r.unit_id=$1 order by active desc, r.scope desc, s.name nulls first, target, r.valid_from desc limit 200`, [ctx.unitId, todayYmd()]);
}

async function findRule(q: Q, unitId: string, at: string, t: { scope: "servico" | "produto"; staffId: string; serviceId?: string | null; categoryId?: string | null; productId?: string | null }) {
  const [r] = await q<{ id: string; pct_bps: number; base: "bruto" | "liquido" }>(
    `select r.id, r.pct_bps, r.base from commission_rules r
     where r.unit_id=$1 and r.scope=$2 and r.valid_from <= $3::date and (r.valid_to is null or r.valid_to >= $3::date)
       and (r.staff_id = $4 or (r.staff_id is null and not exists (select 1 from staff s where s.id=$4 and s.contract_type='administrador')))
       and (r.service_id is null or r.service_id=$5) and (r.category_id is null or r.category_id=$6) and (r.product_id is null or r.product_id=$7)
     order by (r.staff_id is not null) desc, (r.service_id is not null or r.product_id is not null) desc, (r.category_id is not null) desc, r.valid_from desc, r.created_at desc limit 1`,
    [unitId, t.scope, at, t.staffId, t.serviceId ?? null, t.categoryId ?? null, t.productId ?? null],
  );
  return r ?? null;
}

// ---------- geração ----------
const pct = (base: number, bps: number) => Math.round((base * bps) / 10000);
/** Divide o desconto proporcionalmente sem perder centavos. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!total || !sum) return weights.map(() => 0);
  let acc = 0, done = 0;
  return weights.map((w) => { acc += w; const v = Math.round((total * acc) / sum) - done; done += v; return v; });
}

/** Chamado dentro da transação que conclui o atendimento/venda. Único por item: repetir não duplica. */
export async function generateCommissionsTx(q: Q, ctx: Ctx, i: { attendanceId?: string | null; saleId?: string | null; receivableId: string }) {
  const now = new Date(), day = toYmd(now);
  let n = 0;
  const add = async (v: { staffId: string; kind: "servico" | "produto"; itemId: string; desc: string; gross: number; discount: number; rule: { id: string; pct_bps: number; base: string } }) => {
    const base = v.rule.base === "bruto" ? v.gross : v.gross - v.discount;
    const r = await q<{ id: string }>(
      `insert into commission_entries(unit_id,staff_id,kind,attendance_id,attendance_item_id,sale_item_id,receivable_id,description,gross_cents,discount_cents,base,base_cents,pct_bps,amount_cents,rule_id,reference_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) on conflict do nothing returning id`,
      [ctx.unitId, v.staffId, v.kind, i.attendanceId ?? null, v.kind === "servico" ? v.itemId : null, v.kind === "produto" ? v.itemId : null, i.receivableId, v.desc, v.gross, v.discount, v.rule.base, base, v.rule.pct_bps, pct(base, v.rule.pct_bps), v.rule.id, now]);
    if (r[0]) { n++; await emit(q, ctx, "commission.generated", "commission_entry", r[0].id, { staffId: v.staffId }, `commission.generated:${r[0].id}`); }
  };
  if (i.attendanceId) {
    const [a] = await q<{ staff_id: string; discount_cents: number }>("select staff_id, discount_cents from attendances where id=$1", [i.attendanceId]);
    const items = await q<{ id: string; service_id: string | null; category_id: string | null; name_snapshot: string; line_total_cents: number }>("select i.id, i.service_id, s.category_id, i.name_snapshot, i.line_total_cents from attendance_items i left join services s on s.id=i.service_id where i.attendance_id=$1 order by i.id", [i.attendanceId]);
    const disc = allocate(a.discount_cents, items.map((x) => x.line_total_cents));
    for (const [k, it] of items.entries()) {
      const rule = await findRule(q, ctx.unitId, day, { scope: "servico", staffId: a.staff_id, serviceId: it.service_id, categoryId: it.category_id });
      if (rule) await add({ staffId: a.staff_id, kind: "servico", itemId: it.id, desc: it.name_snapshot, gross: it.line_total_cents, discount: disc[k], rule });
    }
  }
  if (i.saleId) {
    const items = await q<{ id: string; product_id: string; name_snapshot: string; quantity: number; gross_cents: number; discount_cents: number; seller: string }>(
      "select i.id, i.product_id, i.name_snapshot, i.quantity, i.gross_cents, i.discount_cents, s.seller_staff_id as seller from product_sale_items i join product_sales s on s.id=i.sale_id join products p on p.id=i.product_id where i.sale_id=$1 and p.commission_enabled order by i.id", [i.saleId]);
    for (const it of items) {
      const rule = await findRule(q, ctx.unitId, day, { scope: "produto", staffId: it.seller, productId: it.product_id });
      if (rule) await add({ staffId: it.seller, kind: "produto", itemId: it.id, desc: `${it.quantity}× ${it.name_snapshot}`, gross: it.gross_cents, discount: it.discount_cents, rule });
    }
  }
  return n;
}

async function adjust(q: Q, unitId: string, staffId: string, entryId: string | null, amount: number, reason: string, dedupe: string, userId: string | null) {
  if (!amount) return;
  await q("insert into commission_adjustments(unit_id,staff_id,entry_id,amount_cents,reason,dedupe_key,created_by) values ($1,$2,$3,$4,$5,$6,$7) on conflict (dedupe_key) do nothing", [unitId, staffId, entryId, amount, reason, dedupe, userId]);
}

/** Devolução de produto: reduz a comissão na mesma proporção, por ajuste (o lançamento original não muda). */
export async function adjustForReturnTx(q: Q, ctx: Ctx, saleItemId: string, returnId: string, returnedQty: number, totalReturnedQty: number, quantity: number) {
  const [e] = await q<{ id: string; staff_id: string; amount_cents: number; status: string }>("select id, staff_id, amount_cents, status from commission_entries where sale_item_id=$1", [saleItemId]);
  if (!e || e.status === "cancelada") return;
  const before = Math.round((e.amount_cents * (totalReturnedQty - returnedQty)) / quantity), after = Math.round((e.amount_cents * totalReturnedQty) / quantity);
  await adjust(q, ctx.unitId, e.staff_id, e.id, -(after - before), "Devolução de produto", `return:${returnId}`, ctx.userId);
}

/** Cobrança cancelada: cancela o que não foi repassado e estorna, por ajuste negativo, o que já foi. */
export async function syncCommissions(q: Q, unitId: string, receivableId: string) {
  const [r] = await q<{ status: string }>("select status from receivables where id=$1", [receivableId]);
  if (r?.status !== "cancelado") return;
  await q("update commission_entries set status='cancelada', cancel_reason='Cobrança cancelada' where receivable_id=$1 and status='gerada'", [receivableId]);
  const done = await q<{ id: string; staff_id: string; left: number }>(
    "select e.id, e.staff_id, (e.amount_cents + coalesce((select sum(a.amount_cents) from commission_adjustments a where a.entry_id=e.id),0))::bigint as left from commission_entries e where e.receivable_id=$1 and e.status='aprovada'", [receivableId]);
  for (const e of done) await adjust(q, unitId, e.staff_id, e.id, -e.left, "Cobrança cancelada após o repasse", `reccancel:${e.id}`, null);
}

export async function addAdjustment(db: Db, ctx: Ctx, i: { staffId: string; amountCents: number; reason: string }) {
  need(ctx, "commissions.approve");
  const why = requireText(i.reason, "Motivo do ajuste", 3);
  if (!Number.isInteger(i.amountCents) || i.amountCents === 0) throw new DomainError("invalid", "Valor do ajuste inválido.");
  await db.tx(async (q) => {
    const [s] = await q("select 1 from staff where id=$1 and unit_id=$2", [requireUuid(i.staffId, "Profissional"), ctx.unitId]);
    if (!s) throw new DomainError("not_found", "Profissional não encontrado.");
    const [a] = await q<{ id: string }>("insert into commission_adjustments(unit_id,staff_id,amount_cents,reason,created_by) values ($1,$2,$3,$4,$5) returning id", [ctx.unitId, i.staffId, i.amountCents, why, ctx.userId]);
    await audit(q, ctx, "COMISSAO_AJUSTE", "commission_adjustment", a.id, null, i, why);
  });
}

// ---------- consultas ----------
/** Exigível: política "conclusão" = sempre; "recebimento" = cobrança quitada e conferida. */
const DUE = "(st.commission_trigger='conclusao' or b.confirmed_cents >= r.amount_due_cents)";
const FROM = "from commission_entries e join receivables r on r.id=e.receivable_id join receivable_balances b on b.receivable_id=r.id join unit_settings st on st.unit_id=e.unit_id";

export function scopeStaff(ctx: Ctx, staffId?: string | null): string | null {
  if (can(ctx, "commissions.view_all")) return staffId ?? null;
  need(ctx, "finance.own");
  if (!ctx.staffId || (staffId && staffId !== ctx.staffId)) throw new ForbiddenError("Você só pode ver as suas próprias comissões.");
  return ctx.staffId;
}

export interface CommissionTotals { generated: number; pending: number; due: number; adjustments: number; approvedOpen: number; paid: number }
export async function totals(db: Db, ctx: Ctx, p: Period, staffId?: string | null): Promise<CommissionTotals> {
  const sid = scopeStaff(ctx, staffId);
  const [e] = await db.query<{ generated: number; pending: number; due: number }>(
    `select coalesce(sum(e.amount_cents),0)::bigint as generated, coalesce(sum(e.amount_cents) filter (where e.status='gerada' and not ${DUE}),0)::bigint as pending, coalesce(sum(e.amount_cents) filter (where e.status='gerada' and ${DUE}),0)::bigint as due
     ${FROM} where e.unit_id=$1 and e.status<>'cancelada' and e.reference_at >= $2 and e.reference_at < $3 and ($4::uuid is null or e.staff_id=$4)`, [ctx.unitId, dayStartUtc(p.start), dayEndUtc(p.end), sid]);
  const [a] = await db.query<{ v: number }>("select coalesce(sum(a.amount_cents),0)::bigint as v from commission_adjustments a left join commission_entries e on e.id=a.entry_id where a.unit_id=$1 and a.settlement_id is null and (e.id is null or e.status<>'cancelada') and ($2::uuid is null or a.staff_id=$2)", [ctx.unitId, sid]);
  const [s] = await db.query<{ open: number; paid: number }>(
    `select coalesce(sum(s.total_cents - b.paid_cents),0)::bigint as open, coalesce(sum(b.paid_cents),0)::bigint as paid from commission_settlements s join payables p on p.id=s.payable_id join payable_balances b on b.payable_id=p.id
     where s.unit_id=$1 and p.status='ativo' and s.period_end >= $2::date and s.period_start <= $3::date and ($4::uuid is null or s.staff_id=$4)`, [ctx.unitId, p.start, p.end, sid]);
  return { ...e, adjustments: a.v, approvedOpen: s.open, paid: s.paid };
}

export async function byStaff(db: Db, ctx: Ctx, p: Period) {
  need(ctx, "commissions.view_all");
  return db.query<{ staff_id: string; name: string; generated: number; pending: number; due: number; adjustments: number; approved_open: number; paid: number }>(
    `select s.id as staff_id, s.name, coalesce(x.generated,0)::bigint as generated, coalesce(x.pending,0)::bigint as pending, coalesce(x.due,0)::bigint as due,
       coalesce((select sum(a.amount_cents) from commission_adjustments a left join commission_entries e on e.id=a.entry_id where a.staff_id=s.id and a.settlement_id is null and (e.id is null or e.status<>'cancelada')),0)::bigint as adjustments,
       coalesce(y.open,0)::bigint as approved_open, coalesce(y.paid,0)::bigint as paid
     from staff s
     left join (select e.staff_id, sum(e.amount_cents) as generated, sum(e.amount_cents) filter (where e.status='gerada' and not ${DUE}) as pending, sum(e.amount_cents) filter (where e.status='gerada' and ${DUE}) as due
        ${FROM} where e.unit_id=$1 and e.status<>'cancelada' and e.reference_at >= $2 and e.reference_at < $3 group by e.staff_id) x on x.staff_id=s.id
     left join (select s2.staff_id, sum(s2.total_cents - b.paid_cents) as open, sum(b.paid_cents) as paid from commission_settlements s2 join payables p on p.id=s2.payable_id join payable_balances b on b.payable_id=p.id
        where p.status='ativo' and s2.period_end >= $4::date and s2.period_start <= $5::date group by s2.staff_id) y on y.staff_id=s.id
     where s.unit_id=$1 and (s.is_active or x.generated > 0 or y.paid > 0) order by s.name`, [ctx.unitId, dayStartUtc(p.start), dayEndUtc(p.end), p.start, p.end]);
}

export interface EntryRow { id: string; staff_name: string; kind: string; description: string; gross_cents: number; discount_cents: number; base: string; base_cents: number; pct_bps: number; amount_cents: number; reference_at: Date; state: "pendente" | "exigivel" | "aprovada" | "paga" | "cancelada"; attendance_id: string | null; customer_name: string | null; adj_cents: number }
const STATE = `case when e.status='cancelada' then 'cancelada' when e.status='aprovada' then (case when pb.paid_cents >= s.total_cents then 'paga' else 'aprovada' end) when ${DUE} then 'exigivel' else 'pendente' end`;
export async function listEntries(db: Db, ctx: Ctx, o: { period: Period; staffId?: string | null; kind?: string | null; state?: string | null; search?: string | null; settlementId?: string | null; limit?: number; offset?: number }) {
  const sid = scopeStaff(ctx, o.staffId);
  const rows = await db.query<EntryRow & { total: number }>(
    `select *, count(*) over()::bigint as total from (select e.id, sf.name as staff_name, e.kind, e.description, e.gross_cents, e.discount_cents, e.base, e.base_cents, e.pct_bps, e.amount_cents, e.reference_at, ${STATE} as state, e.attendance_id, c.name as customer_name,
       coalesce((select sum(a.amount_cents) from commission_adjustments a where a.entry_id=e.id),0)::bigint as adj_cents
     ${FROM} join staff sf on sf.id=e.staff_id left join customers c on c.id=r.customer_id left join commission_settlements s on s.id=e.settlement_id left join payable_balances pb on pb.payable_id=s.payable_id
     where e.unit_id=$1 and ($9::uuid is not null or (e.reference_at >= $2 and e.reference_at < $3)) and ($4::uuid is null or e.staff_id=$4) and ($5::text is null or e.kind=$5) and ($6::text is null or lower(e.description) like $6) and ($9::uuid is null or e.settlement_id=$9)) x
     where ($10::text is null or state=$10) order by reference_at desc limit $7 offset $8`,
    [ctx.unitId, dayStartUtc(o.period.start), dayEndUtc(o.period.end), sid, o.kind || null, o.search ? `%${o.search.toLowerCase()}%` : null, o.limit ?? 50, o.offset ?? 0, o.settlementId ?? null, o.state || null]);
  return { rows, total: rows[0]?.total ?? 0 };
}

export interface SettlementRow { id: string; staff_id: string; staff_name: string; period_start: string; period_end: string; entries_cents: number; adjustments_cents: number; total_cents: number; paid_cents: number; state: "aprovado" | "parcial" | "pago" | "cancelado"; approved_at: Date; note: string | null; evidence_name: string | null; payable_id: string }
export async function listSettlements(db: Db, ctx: Ctx, o: { staffId?: string | null; id?: string; limit?: number } = {}) {
  const sid = scopeStaff(ctx, o.staffId);
  return db.query<SettlementRow>(
    `select s.id, s.staff_id, sf.name as staff_name, to_char(s.period_start,'YYYY-MM-DD') as period_start, to_char(s.period_end,'YYYY-MM-DD') as period_end, s.entries_cents, s.adjustments_cents, s.total_cents, b.paid_cents, s.approved_at, s.note, s.evidence_name, s.payable_id,
       case when p.status='cancelado' then 'cancelado' when b.paid_cents >= s.total_cents then 'pago' when b.paid_cents > 0 then 'parcial' else 'aprovado' end as state
     from commission_settlements s join staff sf on sf.id=s.staff_id join payables p on p.id=s.payable_id join payable_balances b on b.payable_id=p.id
     where s.unit_id=$1 and ($2::uuid is null or s.staff_id=$2) and ($3::uuid is null or s.id=$3) order by s.approved_at desc limit $4`, [ctx.unitId, sid, o.id ?? null, o.limit ?? 50]);
}

/** Divergências: repasses cuja cobrança deixou de estar quitada (ex.: estorno posterior). */
export async function divergences(db: Db, ctx: Ctx) {
  need(ctx, "commissions.view_all");
  return db.query<{ id: string; staff_name: string; description: string; amount_cents: number; reference_at: Date; attendance_id: string | null }>(
    `select e.id, sf.name as staff_name, e.description, e.amount_cents, e.reference_at, e.attendance_id ${FROM} join staff sf on sf.id=e.staff_id
     where e.unit_id=$1 and e.status='aprovada' and r.status='ativo' and not ${DUE} order by e.reference_at desc limit 50`, [ctx.unitId]);
}
/** Itens concluídos sem nenhuma regra aplicável no período (não geraram comissão). */
export async function withoutRule(db: Db, ctx: Ctx, p: Period) {
  need(ctx, "commissions.view_all");
  const [r] = await db.query<{ n: number }>(
    `select count(*)::bigint as n from attendance_items i join attendances a on a.id=i.attendance_id join staff s on s.id=a.staff_id where a.unit_id=$1 and a.status='concluido' and a.finished_at >= $2 and a.finished_at < $3 and coalesce(s.contract_type,'') <> 'administrador'
       and not exists (select 1 from commission_entries e where e.attendance_item_id=i.id)`, [ctx.unitId, dayStartUtc(p.start), dayEndUtc(p.end)]);
  return r.n;
}

// ---------- fechamento e pagamento ----------
const ADJ_OK = "a.staff_id=$2 and a.unit_id=$1 and a.settlement_id is null and (a.entry_id is null or exists (select 1 from commission_entries e2 where e2.id=a.entry_id and e2.status='aprovada'))";

export async function approveSettlement(db: Db, ctx: Ctx, i: { staffId: string; period: Period; note?: string | null }): Promise<string> {
  need(ctx, "commissions.approve");
  if (i.period.start > i.period.end) throw new DomainError("invalid", "Período inválido.");
  return db.tx(async (q) => {
    const [s] = await q<{ name: string; user_id: string | null }>("select name, user_id from staff where id=$1 and unit_id=$2 for update", [requireUuid(i.staffId, "Profissional"), ctx.unitId]);
    if (!s) throw new DomainError("not_found", "Profissional não encontrado.");
    if (s.user_id === ctx.userId && ctx.role !== "administrador") throw new ForbiddenError("Você não pode aprovar o próprio repasse.");
    await assertPeriodOpen(q, ctx.unitId, i.period.end);
    const rows = await q<{ id: string; amount_cents: number }>(
      `select e.id, e.amount_cents ${FROM} where e.unit_id=$1 and e.staff_id=$2 and e.status='gerada' and r.status='ativo' and ${DUE} and e.reference_at >= $3 and e.reference_at < $4 for update of e`, [ctx.unitId, i.staffId, dayStartUtc(i.period.start), dayEndUtc(i.period.end)]);
    const ids = rows.map((r) => r.id);
    const entries = rows.reduce((a, r) => a + r.amount_cents, 0);
    const adjs = await q<{ id: string; amount_cents: number }>(
      "select a.id, a.amount_cents from commission_adjustments a where a.unit_id=$1 and a.staff_id=$2 and a.settlement_id is null and (a.entry_id is null or a.entry_id = any($3::uuid[]) or exists (select 1 from commission_entries e2 where e2.id=a.entry_id and e2.status='aprovada')) for update", [ctx.unitId, i.staffId, ids]);
    const adjustments = adjs.reduce((a, r) => a + r.amount_cents, 0);
    const total = entries + adjustments;
    if (!ids.length && !adjs.length) throw new DomainError("empty", "Não há comissões exigíveis neste período.");
    if (total <= 0) throw new DomainError("negative", "Os ajustes superam as comissões exigíveis. O saldo negativo fica para o próximo repasse.");
    let [cat] = await q<{ id: string }>("select id from financial_categories where unit_id=$1 and kind='custo' and lower(name)='comissões de profissionais' and is_active", [ctx.unitId]);
    if (!cat) [cat] = await q<{ id: string }>("insert into financial_categories(unit_id,name,kind,sort_order) values ($1,'Comissões de profissionais','custo',90) returning id", [ctx.unitId]);
    const [p] = await q<{ id: string }>("insert into payables(unit_id,category_id,description,supplier,amount_cents,due_date,competence_date,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
      [ctx.unitId, cat.id, `Comissões ${s.name}`, s.name, total, todayYmd(), i.period.end, ctx.userId]);
    const [st] = await q<{ id: string }>("insert into commission_settlements(unit_id,staff_id,period_start,period_end,entries_cents,adjustments_cents,total_cents,payable_id,note,approved_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",
      [ctx.unitId, i.staffId, i.period.start, i.period.end, entries, adjustments, total, p.id, i.note ?? null, ctx.userId]);
    await q("update commission_entries set status='aprovada', settlement_id=$2 where id = any($1::uuid[])", [ids, st.id]);
    await q("update commission_adjustments set settlement_id=$2 where id = any($1::uuid[])", [adjs.map((a) => a.id), st.id]);
    await audit(q, ctx, "COMISSAO_REPASSE_APROVADO", "commission_settlement", st.id, null, { staff: i.staffId, total, entries: ids.length });
    await emit(q, ctx, "commission.approved", "commission_settlement", st.id, { staffId: i.staffId }, `commission.approved:${st.id}`);
    if (s.user_id) await notifyUsers(q, { unitId: ctx.unitId, userIds: [s.user_id], kind: "comissao_aprovada", message: "Um repasse de comissões foi aprovado.", url: "/meu-financeiro", ref: ["commission_settlement", st.id], dedupe: `commission.approved:${st.id}` });
    return st.id;
  });
}

export async function paySettlement(db: Db, ctx: Ctx, i: { id: string; amountCents: number; accountId: string; idempotencyKey: string; evidence?: string | null; file?: FileInput | null }) {
  need(ctx, "commissions.pay");
  if (i.file && (i.file.bytes.byteLength > 2 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(i.file.mime))) throw new DomainError("invalid", "Comprovante: imagem ou PDF de até 2 MB.");
  return db.tx(async (q) => {
    const [s] = await q<{ payable_id: string; staff_id: string; user_id: string | null }>("select s.payable_id, s.staff_id, sf.user_id from commission_settlements s join staff sf on sf.id=s.staff_id where s.id=$1 and s.unit_id=$2 for update of s", [requireUuid(i.id, "Repasse"), ctx.unitId]);
    if (!s) throw new DomainError("not_found", "Repasse não encontrado.");
    // o repasse é pago pela conta a pagar vinculada: caixa, DRE e fluxo enxergam um único lançamento
    const r = await payPayableTx(q, { ...ctx, perms: new Set([...ctx.perms, "finance.manage"]) } as Ctx, { payableId: s.payable_id, amountCents: i.amountCents, accountId: i.accountId, idempotencyKey: i.idempotencyKey, evidence: i.evidence ?? null });
    if (r.duplicate) return r;
    if (i.file) await q("update commission_settlements set evidence_name=$2, evidence_mime=$3, evidence_b64=$4 where id=$1", [i.id, i.file.name.slice(0, 120), i.file.mime, Buffer.from(i.file.bytes).toString("base64")]);
    await audit(q, ctx, "COMISSAO_REPASSE_PAGO", "commission_settlement", i.id, null, { amount: i.amountCents, payment: r.id });
    await emit(q, ctx, "commission.paid", "commission_settlement", i.id, { staffId: s.staff_id, amount: i.amountCents }, `commission.paid:${r.id}`);
    if (s.user_id) await notifyUsers(q, { unitId: ctx.unitId, userIds: [s.user_id], kind: "comissao_paga", message: "Um pagamento de comissões foi registrado.", url: "/meu-financeiro", ref: ["commission_settlement", i.id], dedupe: `commission.paid:${r.id}` });
    return r;
  });
}

export async function cancelSettlement(db: Db, ctx: Ctx, id: string, reason: string) {
  need(ctx, "commissions.approve");
  const why = requireText(reason, "Motivo", 3);
  await db.tx(async (q) => {
    const [s] = await q<{ payable_id: string; status: string; paid: number }>("select s.payable_id, p.status, (select paid_cents from payable_balances where payable_id=p.id) as paid from commission_settlements s join payables p on p.id=s.payable_id where s.id=$1 and s.unit_id=$2 for update of s, p", [requireUuid(id, "Repasse"), ctx.unitId]);
    if (!s) throw new DomainError("not_found", "Repasse não encontrado.");
    if (s.status !== "ativo") throw new DomainError("bad_status", "Este repasse já foi cancelado.");
    if (s.paid > 0) throw new DomainError("paid", "Este repasse tem pagamento. Estorne o pagamento na conta a pagar antes de cancelar.");
    await q("update payables set status='cancelado', cancel_reason=$2 where id=$1", [s.payable_id, why]);
    await q("update commission_entries set status='gerada', settlement_id=null where settlement_id=$1", [id]);
    await q("update commission_adjustments set settlement_id=null where settlement_id=$1", [id]);
    await audit(q, ctx, "COMISSAO_REPASSE_CANCELADO", "commission_settlement", id, null, null, why);
  });
}

export async function getEvidence(db: Db, ctx: Ctx, id: string) {
  const [s] = await db.query<{ staff_id: string; evidence_name: string | null; evidence_mime: string | null; evidence_b64: string | null }>("select staff_id, evidence_name, evidence_mime, evidence_b64 from commission_settlements where id=$1 and unit_id=$2", [requireUuid(id, "Repasse"), ctx.unitId]);
  if (!s?.evidence_b64) throw new DomainError("not_found", "Comprovante não encontrado.");
  scopeStaff(ctx, s.staff_id);
  return { name: s.evidence_name!, mime: s.evidence_mime!, bytes: Buffer.from(s.evidence_b64, "base64") };
}

export async function setTrigger(db: Db, ctx: Ctx, trigger: string) {
  need(ctx, "commissions.rules");
  if (!["conclusao", "recebimento"].includes(trigger)) throw new DomainError("invalid", "Opção inválida.");
  await db.tx(async (q) => {
    const st = await getSettings(q, ctx.unitId) as unknown as { commission_trigger: string };
    await q("update unit_settings set commission_trigger=$2, updated_at=now(), updated_by=$3 where unit_id=$1", [ctx.unitId, trigger, ctx.userId]);
    await audit(q, ctx, "COMISSAO_POLITICA", "unit_settings", ctx.unitId, { trigger: st.commission_trigger }, { trigger });
  });
}
void ADJ_OK;
