import type { Db } from "../db";
import { can, need } from "../core";
import type { Ctx } from "../permissions";
import { addDays, fmtYmd, todayYmd } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { notifyUsers } from "./notify";

/**
 * Números da Eagle a partir das ordens de serviço: a OS concluída é o faturamento; a OS concluída e paga é o recebido;
 * a OS concluída sem pagamento é o "a receber". Data de referência: a data do serviço.
 */
export interface Period { start: string; end: string }

const OS_DATE = "coalesce(so.service_date, (a.starts_at at time zone 'America/Sao_Paulo')::date, (so.executed_at at time zone 'America/Sao_Paulo')::date)";
const OS_VALUE = "coalesce(so.value_cents, (select sum(ai.price_cents) from appointment_services ai where ai.appointment_id=a.id), 0)";
const OS_FROM = "from service_orders so left join appointments a on a.id=so.appointment_id left join staff st on st.id=a.staff_id";

/** Técnico só vê as próprias OS; quem vê o painel completo pode filtrar por técnico. */
function staffScope(ctx: Ctx, staffId?: string | null): string | null {
  if (can(ctx, "dashboard.full") || can(ctx, "finance.view")) return staffId || null;
  return ctx.staffId ?? "00000000-0000-0000-0000-000000000000";
}

export interface OrderTotals { done: number; billed: number; paid: number; unpaid: number; open: number; late: number; ticket: number | null }

export async function orderTotals(db: Db, ctx: Ctx, p: Period, staffId?: string | null): Promise<OrderTotals> {
  const s = staffScope(ctx, staffId);
  const [r] = await db.query<{ done: number; billed: number; paid: number; unpaid: number; open: number; late: number }>(
    `select count(*) filter (where so.status='executada' and d between $2 and $3)::bigint as done,
            coalesce(sum(v) filter (where so.status='executada' and d between $2 and $3),0)::bigint as billed,
            coalesce(sum(v) filter (where so.status='executada' and d between $2 and $3 and so.payment_status='pago'),0)::bigint as paid,
            coalesce(sum(v) filter (where so.status='executada' and d between $2 and $3 and so.payment_status<>'pago'),0)::bigint as unpaid,
            count(*) filter (where so.status='aberta')::bigint as open,
            count(*) filter (where so.status='aberta' and d < $5::date)::bigint as late
     from (select so.*, a.staff_id as a_staff, ${OS_DATE} as d, ${OS_VALUE} as v ${OS_FROM} where so.unit_id=$1) so
     where ($4::uuid is null or so.a_staff=$4)`, [ctx.unitId, p.start, p.end, s, todayYmd()]);
  return { ...r, ticket: r.done ? Math.round(r.billed / r.done) : null };
}

export interface ReceivableOrder { id: string; number: number; customer_id: string; customer_name: string; customer_phone: string | null; service_date: string | null; total_cents: number; payment_status: string; payment_method: string | null }

/** OS concluídas ainda sem pagamento (todas as datas): é o "a receber" da Eagle. */
export async function receivableOrders(db: Db, ctx: Ctx, limit = 200): Promise<{ rows: ReceivableOrder[]; total: number }> {
  need(ctx, "finance.view", "agenda.manage");
  const rows = await db.query<ReceivableOrder>(
    `select so.id, so.number, so.customer_id, c.name as customer_name, c.phone as customer_phone, to_char(${OS_DATE},'YYYY-MM-DD') as service_date,
            ${OS_VALUE}::bigint as total_cents, so.payment_status, so.payment_method
     ${OS_FROM} join customers c on c.id=so.customer_id
     where so.unit_id=$1 and so.status='executada' and so.payment_status<>'pago'
     order by ${OS_DATE} nulls last, so.number limit $2`, [ctx.unitId, limit]);
  return { rows, total: rows.reduce((a, r) => a + r.total_cents, 0) };
}

export interface PaidOrder { id: string; number: number; customer_name: string; service_date: string | null; total_cents: number; payment_method: string | null }

export async function paidOrders(db: Db, ctx: Ctx, p: Period): Promise<PaidOrder[]> {
  need(ctx, "finance.view");
  return db.query<PaidOrder>(
    `select so.id, so.number, c.name as customer_name, to_char(${OS_DATE},'YYYY-MM-DD') as service_date, ${OS_VALUE}::bigint as total_cents, so.payment_method
     ${OS_FROM} join customers c on c.id=so.customer_id
     where so.unit_id=$1 and so.status='executada' and so.payment_status='pago' and ${OS_DATE} between $2 and $3
     order by ${OS_DATE} desc, so.number desc`, [ctx.unitId, p.start, p.end]);
}

export interface Breakdown { label: string; n: number; cents: number }

/** Faturamento por dia, por serviço, por técnico e por forma de pagamento (OS concluídas no período). */
export async function orderBreakdowns(db: Db, ctx: Ctx, p: Period, staffId?: string | null) {
  const s = staffScope(ctx, staffId);
  const rows = await db.query<{ d: string; v: number; services: string | null; staff: string | null; method: string | null }>(
    `select to_char(${OS_DATE},'YYYY-MM-DD') as d, ${OS_VALUE}::bigint as v,
            coalesce(so.services_text, (select string_agg(ai.name_snapshot, ', ') from appointment_services ai where ai.appointment_id=a.id)) as services,
            st.name as staff, nullif(trim(so.payment_method),'') as method
     ${OS_FROM} where so.unit_id=$1 and so.status='executada' and ${OS_DATE} between $2 and $3 and ($4::uuid is null or a.staff_id=$4)`,
    [ctx.unitId, p.start, p.end, s]);
  const byDay = new Map<string, number>();
  for (let d = p.start; d <= p.end; d = addDays(d, 1)) byDay.set(d, 0);
  const add = (m: Map<string, Breakdown>, label: string, cents: number) => {
    const cur = m.get(label.toLowerCase()) ?? { label, n: 0, cents: 0 };
    cur.n++; cur.cents += cents;
    m.set(label.toLowerCase(), cur);
  };
  const services = new Map<string, Breakdown>(), staff = new Map<string, Breakdown>(), methods = new Map<string, Breakdown>();
  for (const r of rows) {
    byDay.set(r.d, (byDay.get(r.d) ?? 0) + r.v);
    const names = (r.services ?? "").split(/,|\n/).map((x) => x.trim().replace(/[.;:]+$/, "")).filter((x) => x && x.length < 80);
    // valor dividido entre os serviços da OS, para a soma bater com o faturamento
    for (const n of names) add(services, n[0].toUpperCase() + n.slice(1), Math.round(r.v / names.length));
    if (!names.length) add(services, "Sem descrição", r.v);
    add(staff, r.staff ?? "Sem técnico", r.v);
    add(methods, r.method ?? "Não informado", r.v);
  }
  const sorted = (m: Map<string, Breakdown>) => [...m.values()].sort((a, b) => b.cents - a.cents || b.n - a.n);
  return { byDay: [...byDay.entries()].map(([date, cents]) => ({ date, cents })), byService: sorted(services), byStaff: sorted(staff), byMethod: sorted(methods) };
}

export interface QuoteTotals { created: number; sent: number; approved: number; refused: number; approvedCents: number; conversion: number | null; expiring: number }

/** Orçamentos emitidos no período e quantos foram aprovados (conversão = aprovados ÷ enviados, aprovados e recusados). */
export async function quoteTotals(db: Db, ctx: Ctx, p: Period): Promise<QuoteTotals | null> {
  if (!can(ctx, "quotes.view") && !can(ctx, "quotes.manage")) return null;
  const today = todayYmd();
  const [r] = await db.query<{ created: number; sent: number; approved: number; refused: number; approved_cents: number; expiring: number }>(
    `select count(*) filter (where issue_date between $2 and $3)::bigint as created,
            count(*) filter (where issue_date between $2 and $3 and status in ('enviado','aprovado','recusado'))::bigint as sent,
            count(*) filter (where issue_date between $2 and $3 and status='aprovado')::bigint as approved,
            count(*) filter (where issue_date between $2 and $3 and status='recusado')::bigint as refused,
            coalesce(sum(coalesce(q.value_cents, greatest(coalesce((select round(sum(i.quantity*i.unit_price_cents)) from quote_items i where i.quote_id=q.id),0) - q.discount_cents, 0)))
              filter (where issue_date between $2 and $3 and status='aprovado'),0)::bigint as approved_cents,
            count(*) filter (where status in ('rascunho','enviado') and valid_until between $4::date and $4::date + 7)::bigint as expiring
     from quotes q where unit_id=$1`, [ctx.unitId, p.start, p.end, today]);
  return { created: r.created, sent: r.sent, approved: r.approved, refused: r.refused, approvedCents: r.approved_cents, expiring: r.expiring, conversion: r.sent ? r.approved / r.sent : null };
}

export interface ReturnTotals { overdue: number; today: number; week: number }

export async function returnTotals(db: Db, ctx: Ctx): Promise<ReturnTotals | null> {
  const all = can(ctx, "returns.view_all") || can(ctx, "returns.manage");
  if (!all && !can(ctx, "returns.own")) return null;
  const today = todayYmd();
  const [r] = await db.query<ReturnTotals>(
    `select count(*) filter (where due_date < $2::date)::bigint as overdue, count(*) filter (where due_date = $2::date)::bigint as today,
            count(*) filter (where due_date > $2::date and due_date <= $2::date + 7)::bigint as week
     from service_returns where unit_id=$1 and status in ('pendente','agendado') and ($3::uuid is null or staff_id=$3)`,
    [ctx.unitId, today, all ? null : ctx.staffId ?? "00000000-0000-0000-0000-000000000000"]);
  return r;
}

/** Lançamentos manuais do mês (receitas e gastos avulsos). */
export async function entryTotals(db: Db, ctx: Ctx, p: Period): Promise<{ income: number; expense: number } | null> {
  if (!can(ctx, "finance.view")) return null;
  const [r] = await db.query<{ income: number; expense: number }>(
    `select coalesce(sum(amount_cents) filter (where kind='receita'),0)::bigint as income, coalesce(sum(amount_cents) filter (where kind='gasto'),0)::bigint as expense
     from finance_entries where unit_id=$1 and entry_date between $2 and $3`, [ctx.unitId, p.start, p.end]);
  return r;
}

/**
 * Avisos diários da Eagle: orçamento vencendo (3 dias antes e no dia), retorno de garantia ou manutenção vencendo hoje ou atrasado,
 * e o resumo de ontem. O aviso vai para a central (e por push ao administrador e gerente); retorno com técnico avisa também o técnico.
 */
export async function runEagleJobs(db: Db, unitId: string, today = todayYmd()) {
  let quotes = 0, returns = 0;
  const expiring = await db.query<{ id: string; number: number; customer: string; valid_until: string }>(
    `select q.id, q.number, c.name as customer, to_char(q.valid_until,'YYYY-MM-DD') as valid_until from quotes q join customers c on c.id=q.customer_id
     where q.unit_id=$1 and q.status in ('rascunho','enviado') and q.valid_until in ($2::date, $2::date + 3)`, [unitId, today]);
  for (const q of expiring) {
    const when = q.valid_until === today ? "vence hoje" : `vence em ${fmtYmd(q.valid_until)}`;
    const r = await db.query(
      "insert into notifications(unit_id,kind,severity,message,url,ref_entity,ref_id,dedupe_key) values ($1,'orcamento_vencendo',$2,$3,$4,'quote',$5,$6) on conflict (dedupe_key) do nothing returning id",
      [unitId, q.valid_until === today ? "atencao" : "info", `Orçamento nº ${q.number} de ${q.customer} ${when}. Vale ligar para o cliente.`, `/orcamentos/${q.id}`, q.id, `quote.exp:${q.id}:${q.valid_until}:${q.valid_until === today ? 0 : 3}`]);
    quotes += r.length;
  }
  const due = await db.query<{ id: string; kind: string; customer: string; due_date: string; user_id: string | null }>(
    `select r.id, r.kind, c.name as customer, to_char(r.due_date,'YYYY-MM-DD') as due_date, st.user_id
     from service_returns r join customers c on c.id=r.customer_id left join staff st on st.id=r.staff_id
     where r.unit_id=$1 and r.status='pendente' and r.due_date <= $2::date and r.due_date >= $2::date - 30`, [unitId, today]);
  for (const r of due) {
    const what = r.kind === "garantia" ? "Retorno de garantia" : r.kind === "manutencao" ? "Manutenção/renovação" : "Retorno";
    const msg = r.due_date === today ? `${what} de ${r.customer} vence hoje.` : `${what} de ${r.customer} está atrasado desde ${fmtYmd(r.due_date)}.`;
    // no dia do vencimento e uma vez por semana enquanto estiver atrasado
    const late = r.due_date < today;
    const week = late ? Math.floor((Date.parse(today) - Date.parse(r.due_date)) / (7 * 86400000)) : 0;
    const key = `ret.due:${r.id}:${late ? `w${week}` : "d0"}`;
    const n = await db.query(
      "insert into notifications(unit_id,kind,severity,message,url,ref_entity,ref_id,dedupe_key) values ($1,'retorno_vencendo',$2,$3,$4,'service_return',$5,$6) on conflict (dedupe_key) do nothing returning id",
      [unitId, late ? "critico" : "atencao", msg, `/retornos/${r.id}`, r.id, key]);
    returns += n.length;
    if (n.length && r.user_id) await db.tx((q) => notifyUsers(q, { unitId, userIds: [r.user_id!], kind: "retorno_vencendo", severity: late ? "critico" : "atencao", message: msg, url: `/retornos/${r.id}`, ref: ["service_return", r.id], dedupe: key }));
  }
  const y = addDays(today, -1);
  const [s] = await db.query<{ n: number; v: number }>(
    `select count(*)::bigint as n, coalesce(sum(${OS_VALUE}),0)::bigint as v ${OS_FROM} where so.unit_id=$1 and so.status='executada' and ${OS_DATE} = $2::date`, [unitId, y]);
  if (s.n > 0) await db.query("insert into notifications(unit_id,kind,severity,message,dedupe_key) values ($1,'resumo_diario','info',$2,$3) on conflict (dedupe_key) do nothing",
    [unitId, `Resumo de ${fmtYmd(y)}: ${s.n} ordem(ns) de serviço concluída(s), ${fmtBRL(s.v)} faturados.`, `summary:${y}`]);
  return { quotes, returns, yesterday: s.n };
}
