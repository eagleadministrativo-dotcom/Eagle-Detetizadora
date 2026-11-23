import type { Db, Q } from "../db";
import { audit, can, need, requireUuid } from "../core";
import { DomainError, ForbiddenError } from "../errors";
import type { Ctx } from "../permissions";
import { addDays, dayOfWeek, monthStart, todayYmd } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { notifyUsers } from "./notify";

export interface Definition { metric: string; label: string; unit: "brl" | "int"; period: "dia" | "semana" | "mes"; sort_order: number }
const D = (c: string) => `(${c} at time zone 'America/Sao_Paulo')::date`;
export const weekStart = (ymd: string) => addDays(ymd, -((dayOfWeek(ymd) + 6) % 7)); // segunda a domingo

interface DayStat { d: string; revenue: number; services: number; n: number; units: number }
/** Produção por dia: atendimentos concluídos com cobrança válida + produtos vendidos, já sem devoluções. */
async function daily(q: Q, unitId: string, staffId: string): Promise<DayStat[]> {
  return q<DayStat>(
    `select to_char(d,'YYYY-MM-DD') as d, sum(revenue)::bigint as revenue, sum(services)::bigint as services, sum(n)::bigint as n, sum(units)::bigint as units from (
       select ${D("a.finished_at")} as d, a.total_cents as revenue, a.total_cents as services, 1 as n, 0 as units from attendances a join receivables r on r.attendance_id=a.id where a.unit_id=$1 and a.staff_id=$2 and a.status='concluido' and r.status='ativo'
       union all
       select ${D("s.finished_at")}, i.total_cents - i.returned_cents, 0, 0, i.quantity - i.returned_qty from product_sales s join product_sale_items i on i.sale_id=s.id join receivables r on r.id=s.receivable_id where s.unit_id=$1 and s.seller_staff_id=$2 and s.status='concluida' and r.status='ativo'
     ) x group by d order by d`, [unitId, staffId]);
}

type Best = { value: number; period: string };
function compute(days: DayStat[], today: string, minVolume: number): Record<string, { closed: Best | null; current: Best | null }> {
  const acc = (keyOf: (d: string) => string) => {
    const m = new Map<string, DayStat>();
    for (const x of days) { const k = keyOf(x.d), c = m.get(k) ?? { d: k, revenue: 0, services: 0, n: 0, units: 0 }; m.set(k, { d: k, revenue: c.revenue + x.revenue, services: c.services + x.services, n: c.n + x.n, units: c.units + x.units }); }
    return [...m.values()];
  };
  const best = (rows: DayStat[], cur: string, f: (r: DayStat) => number | null, includeCurrent = false) => {
    let closed: Best | null = null, current: Best | null = null;
    for (const r of rows) {
      const v = f(r);
      if (v == null || v <= 0) continue;
      if (r.d === cur) current = { value: v, period: r.d };
      if ((r.d < cur || includeCurrent) && (!closed || v > closed.value)) closed = { value: v, period: r.d };
    }
    return { closed, current };
  };
  const wk = acc(weekStart), mo = acc(monthStart), cw = weekStart(today), cm = monthStart(today);
  return {
    faturamento_dia: best(days, today, (r) => r.revenue, true),
    atendimentos_dia: best(days, today, (r) => r.n, true),
    faturamento_semana: best(wk, cw, (r) => r.revenue),
    faturamento_mes: best(mo, cm, (r) => r.revenue),
    ticket_mes: best(mo, cm, (r) => (r.n >= minVolume ? Math.round(r.services / r.n) : null)),
    produtos_mes: best(mo, cm, (r) => r.units),
  };
}

const show = (d: Definition, v: number) => (d.unit === "brl" ? fmtBRL(v) : v.toLocaleString("pt-BR"));

/**
 * Recalcula os recordes de UM profissional e registra o que mudou. Semana e mês só contam fechados; o dia conta na hora.
 * Se uma correção (cancelamento, devolução) derruba um recorde, ele é corrigido e o histórico marcado, nunca apagado.
 */
export async function evaluateRecords(q: Q, unitId: string, staffId: string, today = todayYmd()): Promise<number> {
  await q("select 1 from staff where id=$1 for update", [staffId]);
  const defs = await q<Definition>("select metric,label,unit,period,sort_order from achievement_definitions order by sort_order");
  const [st] = await q<{ v: number }>("select record_min_volume as v from unit_settings where unit_id=$1", [unitId]);
  const [staff] = await q<{ user_id: string | null }>("select user_id from staff where id=$1 and unit_id=$2", [staffId, unitId]);
  if (!staff) return 0;
  const c = compute(await daily(q, unitId, staffId), today, st.v);
  let fresh = 0;
  for (const def of defs) {
    const b = c[def.metric]?.closed ?? null;
    const [cur] = await q<{ value: number; period_start: string }>("select value, to_char(period_start,'YYYY-MM-DD') as period_start from employee_records where staff_id=$1 and metric=$2", [staffId, def.metric]);
    if (b && cur && b.value === cur.value && b.period === cur.period_start) continue;
    if (!b) {
      if (cur) { await q("delete from employee_records where staff_id=$1 and metric=$2", [staffId, def.metric]); await q("update employee_achievements set status='corrigida' where staff_id=$1 and metric=$2", [staffId, def.metric]); await audit(q, { unitId }, "RECORDE_CORRIGIDO", "staff", staffId, cur, null, def.metric); }
      continue;
    }
    if (!cur || b.value > cur.value) {
      // recorde anterior = o melhor de OUTRO período (o mesmo dia pode ir subindo)
      const [prev] = await q<{ value: number }>("select value from employee_achievements where staff_id=$1 and metric=$2 and status='valida' and period_start <> $3::date order by value desc limit 1", [staffId, def.metric, b.period]);
      await q("insert into employee_records(staff_id,metric,unit_id,value,period_start) values ($1,$2,$3,$4,$5) on conflict (staff_id,metric) do update set value=excluded.value, period_start=excluded.period_start, updated_at=now()", [staffId, def.metric, unitId, b.value, b.period]);
      await q("insert into employee_achievements(unit_id,staff_id,metric,period_start,value,previous_value) values ($1,$2,$3,$4,$5,$6) on conflict (staff_id,metric,period_start) do update set value=excluded.value, status='valida'", [unitId, staffId, def.metric, b.period, b.value, prev?.value ?? null]);
      if (prev) {
        fresh++;
        await q("insert into domain_events(unit_id,type,entity,entity_id,payload,dedupe_key) values ($1,'record.achieved','staff',$2,$3,$4) on conflict (dedupe_key) do nothing", [unitId, staffId, JSON.stringify({ metric: def.metric, value: b.value, previous: prev.value }), `record:${staffId}:${def.metric}:${b.period}`]);
        if (staff.user_id) await notifyUsers(q, { unitId, userIds: [staff.user_id], kind: "recorde_pessoal", message: `Novo recorde pessoal! ${def.label}: ${show(def, b.value)}, superando ${show(def, prev.value)}.`, url: "/conquistas", ref: ["staff", staffId], dedupe: `record:${staffId}:${def.metric}:${b.period}` });
      }
    } else {
      await q("update employee_records set value=$3, period_start=$4, updated_at=now() where staff_id=$1 and metric=$2", [staffId, def.metric, b.value, b.period]);
      await q("update employee_achievements set status='corrigida' where staff_id=$1 and metric=$2 and (value > $3 or period_start=$4::date)", [staffId, def.metric, b.value, cur.period_start]);
      await q("insert into employee_achievements(unit_id,staff_id,metric,period_start,value) values ($1,$2,$3,$4,$5) on conflict (staff_id,metric,period_start) do update set value=excluded.value, status='valida'", [unitId, staffId, def.metric, b.period, b.value]);
      await audit(q, { unitId }, "RECORDE_CORRIGIDO", "staff", staffId, cur, b, def.metric);
    }
  }
  return fresh;
}

/** Conquistas são privadas: só o próprio profissional (e a gestão com painel da equipe) consulta. */
export async function getAchievements(db: Db, ctx: Ctx, staffId?: string | null) {
  const sid = staffId ?? ctx.staffId;
  if (!sid) throw new DomainError("no_staff", "Seu usuário não está vinculado a um profissional.");
  requireUuid(sid, "Profissional");
  if (sid === ctx.staffId) need(ctx, "achievements.own", "team.view");
  else if (!can(ctx, "team.view")) throw new ForbiddenError();
  const [staff] = await db.query<{ name: string }>("select name from staff where id=$1 and unit_id=$2", [sid, ctx.unitId]);
  if (!staff) throw new DomainError("not_found", "Profissional não encontrado.");
  const defs = await db.query<Definition>("select metric,label,unit,period,sort_order from achievement_definitions order by sort_order");
  const records = await db.query<{ metric: string; value: number; period_start: string }>("select metric, value, to_char(period_start,'YYYY-MM-DD') as period_start from employee_records where staff_id=$1", [sid]);
  const history = await db.query<{ id: string; metric: string; value: number; previous_value: number | null; period_start: string; achieved_at: Date; status: string }>("select id, metric, value, previous_value, to_char(period_start,'YYYY-MM-DD') as period_start, achieved_at, status from employee_achievements where staff_id=$1 order by achieved_at desc limit 40", [sid]);
  const [st] = await db.query<{ v: number }>("select record_min_volume as v from unit_settings where unit_id=$1", [ctx.unitId]);
  const today = todayYmd();
  const c = compute(await daily(db.query, ctx.unitId, sid), today, st.v);
  const cards = defs.map((d) => {
    const r = records.find((x) => x.metric === d.metric) ?? null;
    const now = c[d.metric]?.current ?? null;
    return { def: d, record: r, current: now, provisional: Boolean(now && d.period !== "dia" && (!r || now.value > r.value)), previous: history.find((h) => h.metric === d.metric && h.period_start === r?.period_start)?.previous_value ?? null };
  });
  const recent = history.filter((h) => h.status === "valida" && h.previous_value != null && Date.now() - h.achieved_at.getTime() < 3 * 86400000);
  return { staffId: sid, name: staff.name, cards, history, minVolume: st.v, recent, defs };
}

export async function runRecordJobs(db: Db, unitId: string) {
  let fresh = 0;
  for (const s of await db.query<{ id: string }>("select id from staff where unit_id=$1 and is_active", [unitId])) fresh += await db.tx((q) => evaluateRecords(q, unitId, s.id));
  return { fresh };
}
