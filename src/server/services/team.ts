import type { Db } from "../db";
import { audit, can, need, requirePositive, requireUuid } from "../core";
import { DomainError, ForbiddenError } from "../errors";
import type { Ctx } from "../permissions";
import { addDays, dayEndUtc, dayOfWeek, dayStartUtc, daysBetween, monthEnd, monthStart, type Period } from "@/lib/dates";

const D = (c: string) => `(${c} at time zone 'America/Sao_Paulo')::date`;

function ownStaff(ctx: Ctx, staffId?: string | null) {
  const sid = staffId ?? ctx.staffId;
  if (!sid) throw new DomainError("no_staff", "Seu usuário não está vinculado a um profissional.");
  if (sid !== ctx.staffId && !can(ctx, "team.view")) throw new ForbiddenError("Você só pode ver o seu próprio desempenho.");
  if (sid === ctx.staffId) need(ctx, "finance.own", "team.view");
  return requireUuid(sid, "Profissional");
}

export interface StaffStats { services: number; products: number; units: number; n: number; customers: number; ticket: number | null }
/** Produção do profissional. Não é remuneração: a comissão vem de commissions.ts. */
export async function staffStats(db: Db, ctx: Ctx, p: Period, staffId?: string | null): Promise<StaffStats> {
  const sid = ownStaff(ctx, staffId);
  const args = [ctx.unitId, sid, dayStartUtc(p.start), dayEndUtc(p.end)];
  const [a] = await db.query<{ services: number; n: number; customers: number }>("select coalesce(sum(a.total_cents),0)::bigint as services, count(*)::bigint as n, count(distinct a.customer_id)::bigint as customers from attendances a left join receivables r on r.attendance_id=a.id where a.unit_id=$1 and a.staff_id=$2 and a.status='concluido' and a.finished_at >= $3 and a.finished_at < $4 and coalesce(r.status,'ativo')='ativo'", args);
  const [s] = await db.query<{ products: number; units: number }>("select coalesce(sum(i.total_cents - i.returned_cents),0)::bigint as products, coalesce(sum(i.quantity - i.returned_qty),0)::bigint as units from product_sales s join product_sale_items i on i.sale_id=s.id join receivables r on r.id=s.receivable_id where s.unit_id=$1 and s.seller_staff_id=$2 and s.status='concluida' and r.status='ativo' and s.finished_at >= $3 and s.finished_at < $4", args);
  return { ...a, ...s, ticket: a.n ? Math.round(a.services / a.n) : null };
}

export async function staffSeries(db: Db, ctx: Ctx, p: Period, grain: "dia" | "semana" | "mes", staffId?: string | null) {
  const sid = ownStaff(ctx, staffId);
  const unit = grain === "dia" ? "day" : grain === "semana" ? "week" : "month"; // semana ISO: segunda a domingo
  const bucket = (c: string) => `to_char(date_trunc('${unit}', ${D(c)}), 'YYYY-MM-DD')`;
  return db.query<{ date: string; services: number; products: number; n: number; commission: number }>(
    `select date, sum(services)::bigint as services, sum(products)::bigint as products, sum(n)::bigint as n, sum(commission)::bigint as commission from (
       select ${bucket("a.finished_at")} as date, a.total_cents as services, 0 as products, 1 as n, 0 as commission from attendances a left join receivables r on r.attendance_id=a.id where a.unit_id=$1 and a.staff_id=$2 and a.status='concluido' and a.finished_at >= $3 and a.finished_at < $4 and coalesce(r.status,'ativo')='ativo'
       union all select ${bucket("s.finished_at")}, 0, i.total_cents - i.returned_cents, 0, 0 from product_sales s join product_sale_items i on i.sale_id=s.id join receivables r on r.id=s.receivable_id where s.unit_id=$1 and s.seller_staff_id=$2 and s.status='concluida' and r.status='ativo' and s.finished_at >= $3 and s.finished_at < $4
       union all select ${bucket("e.reference_at")}, 0, 0, 0, e.amount_cents from commission_entries e where e.unit_id=$1 and e.staff_id=$2 and e.status<>'cancelada' and e.reference_at >= $3 and e.reference_at < $4
     ) x group by date order by date`, [ctx.unitId, sid, dayStartUtc(p.start), dayEndUtc(p.end)]);
}

export async function topServices(db: Db, ctx: Ctx, p: Period, staffId?: string | null) {
  const sid = ownStaff(ctx, staffId);
  return db.query<{ name: string; qty: number; cents: number }>("select i.name_snapshot as name, sum(i.quantity)::bigint as qty, sum(i.line_total_cents)::bigint as cents from attendance_items i join attendances a on a.id=i.attendance_id where a.unit_id=$1 and a.staff_id=$2 and a.status='concluido' and a.finished_at >= $3 and a.finished_at < $4 group by 1 order by 2 desc limit 6", [ctx.unitId, sid, dayStartUtc(p.start), dayEndUtc(p.end)]);
}

// ---------- painel da equipe ----------
export interface TeamRow { staff_id: string; name: string; color: string; n: number; services: number; products: number; units: number; ticket: number | null; booked_min: number; avail_min: number; occupancy: number | null; tasks_open: number; tasks_overdue: number; returns_due: number; commission_open: number }
export async function teamOverview(db: Db, ctx: Ctx, p: Period, staffId?: string | null): Promise<TeamRow[]> {
  need(ctx, "team.view");
  const money = can(ctx, "commissions.view_all");
  const rows = await db.query<Omit<TeamRow, "ticket" | "avail_min" | "occupancy">>(
    `select s.id as staff_id, s.name, s.color,
       (select count(*) from attendances a left join receivables r on r.attendance_id=a.id where a.staff_id=s.id and a.status='concluido' and coalesce(r.status,'ativo')='ativo' and a.finished_at >= $2 and a.finished_at < $3)::bigint as n,
       (select coalesce(sum(a.total_cents),0) from attendances a left join receivables r on r.attendance_id=a.id where a.staff_id=s.id and a.status='concluido' and coalesce(r.status,'ativo')='ativo' and a.finished_at >= $2 and a.finished_at < $3)::bigint as services,
       (select coalesce(sum(i.total_cents - i.returned_cents),0) from product_sales ps join product_sale_items i on i.sale_id=ps.id join receivables r on r.id=ps.receivable_id where ps.seller_staff_id=s.id and ps.status='concluida' and r.status='ativo' and ps.finished_at >= $2 and ps.finished_at < $3)::bigint as products,
       (select coalesce(sum(i.quantity - i.returned_qty),0) from product_sales ps join product_sale_items i on i.sale_id=ps.id join receivables r on r.id=ps.receivable_id where ps.seller_staff_id=s.id and ps.status='concluida' and r.status='ativo' and ps.finished_at >= $2 and ps.finished_at < $3)::bigint as units,
       (select coalesce(sum(extract(epoch from a.ends_at - a.starts_at)/60),0) from appointments a where a.staff_id=s.id and a.status in ('agendado','em_atendimento','concluido') and a.starts_at >= $2 and a.starts_at < $3)::bigint as booked_min,
       (select count(*) from task_assignees x join tasks t on t.id=x.task_id where x.user_id=s.user_id and x.status<>'concluida' and t.status in ('pendente','em_andamento','aguardando_aprovacao'))::bigint as tasks_open,
       (select count(*) from task_assignees x join tasks t on t.id=x.task_id where x.user_id=s.user_id and x.status<>'concluida' and t.status in ('pendente','em_andamento') and t.due_at < now())::bigint as tasks_overdue,
       (select count(*) from customer_return_status cs join customers c on c.id=cs.customer_id where cs.staff_id=s.id and c.is_active and not c.contact_opt_out and cs.due_date <= (now() at time zone 'America/Sao_Paulo')::date
          and not exists (select 1 from appointments a where a.customer_id=cs.customer_id and a.status in ('agendado','em_atendimento') and a.ends_at > now()))::bigint as returns_due,
       case when $5::boolean then (select coalesce(sum(e.amount_cents),0) from commission_entries e where e.staff_id=s.id and e.status='gerada') else 0 end::bigint as commission_open
     from staff s where s.unit_id=$1 and s.is_active and ($4::uuid is null or s.id=$4) order by s.name`, [ctx.unitId, dayStartUtc(p.start), dayEndUtc(p.end), staffId ?? null, money]);
  const sched = await db.query<{ staff_id: string; day_of_week: number; min: number }>("select ss.staff_id, ss.day_of_week, sum(extract(epoch from ss.end_time - ss.start_time)/60)::bigint as min from staff_schedules ss join staff s on s.id=ss.staff_id where s.unit_id=$1 group by 1,2", [ctx.unitId]);
  const days = Math.min(daysBetween(p.start, p.end) + 1, 400);
  const dowCount = Array(7).fill(0) as number[];
  for (let i = 0; i < days; i++) dowCount[dayOfWeek(addDays(p.start, i))]++;
  return rows.map((r) => {
    const avail = sched.filter((x) => x.staff_id === r.staff_id).reduce((a, x) => a + x.min * dowCount[x.day_of_week], 0);
    return { ...r, ticket: r.n ? Math.round(r.services / r.n) : null, avail_min: avail, occupancy: avail ? (r.booked_min / avail) * 100 : null };
  });
}

// ---------- metas individuais ----------
export const GOAL_METRICS = { atendimentos: ["Atendimentos no mês", "int"], receita_servicos: ["Receita de serviços", "brl"], vendas_produtos: ["Vendas de produtos", "brl"], ticket_medio: ["Ticket médio", "brl"], tarefas: ["Tarefas concluídas", "int"] } as const;
export type GoalMetric = keyof typeof GOAL_METRICS;

/** Meta é gerencial: não altera percentuais nem valores de comissão. */
export async function saveStaffGoal(db: Db, ctx: Ctx, i: { staffId: string; metric: GoalMetric; month: string; target: number }) {
  need(ctx, "team.goals");
  if (!(i.metric in GOAL_METRICS) || !/^\d{4}-\d{2}$/.test(i.month)) throw new DomainError("invalid", "Meta inválida.");
  requirePositive(i.target, "Meta");
  await db.tx(async (q) => {
    const [s] = await q("select 1 from staff where id=$1 and unit_id=$2", [requireUuid(i.staffId, "Profissional"), ctx.unitId]);
    if (!s) throw new DomainError("not_found", "Profissional não encontrado.");
    await q("insert into staff_goals(unit_id,staff_id,metric,month,target,created_by) values ($1,$2,$3,$4,$5,$6) on conflict (staff_id,metric,month) do update set target=excluded.target", [ctx.unitId, i.staffId, i.metric, `${i.month}-01`, i.target, ctx.userId]);
    await audit(q, ctx, "META_INDIVIDUAL", "staff", i.staffId, null, i);
  });
}
export async function removeStaffGoal(db: Db, ctx: Ctx, id: string) {
  need(ctx, "team.goals");
  await db.tx(async (q) => {
    const r = await q("delete from staff_goals where id=$1 and unit_id=$2 returning staff_id, metric, target", [requireUuid(id, "Meta"), ctx.unitId]);
    if (!r.length) throw new DomainError("not_found", "Meta não encontrada.");
    await audit(q, ctx, "META_INDIVIDUAL_REMOVIDA", "staff_goal", id, r[0]);
  });
}
export async function staffGoals(db: Db, ctx: Ctx, staffId: string, month: string) {
  const sid = ownStaff(ctx, staffId);
  const goals = await db.query<{ id: string; metric: GoalMetric; target: number }>("select id, metric, target from staff_goals where staff_id=$1 and month=$2 order by metric", [sid, `${month}-01`]);
  if (!goals.length) return [];
  const p = { start: monthStart(`${month}-01`), end: monthEnd(`${month}-01`) };
  const s = await staffStats(db, ctx, p, sid);
  const [t] = await db.query<{ n: number }>("select count(*)::bigint as n from task_assignees a join tasks k on k.id=a.task_id join staff f on f.user_id=a.user_id where f.id=$1 and k.unit_id=$2 and a.status='concluida' and a.completed_at >= $3 and a.completed_at < $4 and k.status<>'cancelada'", [sid, ctx.unitId, dayStartUtc(p.start), dayEndUtc(p.end)]);
  const value: Record<GoalMetric, number> = { atendimentos: s.n, receita_servicos: s.services, vendas_produtos: s.products, ticket_medio: s.ticket ?? 0, tarefas: t.n };
  return goals.map((g) => ({ ...g, label: GOAL_METRICS[g.metric][0], unit: GOAL_METRICS[g.metric][1], value: value[g.metric], pct: Math.round((value[g.metric] / g.target) * 100) }));
}
