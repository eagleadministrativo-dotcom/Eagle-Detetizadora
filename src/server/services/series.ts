import type { Db, Q } from "../db";
import { audit, requireText, requireUuid } from "../core";
import { DomainError, isDomainError } from "../errors";
import type { Ctx } from "../permissions";
import { addDays, atLocal, daysBetween, fmtYmd, todayYmd, toYmd } from "@/lib/dates";
import { occurrences, parseRule, ruleLabel, type Rule } from "@/lib/recurrence";
import { assertManage, createAppointmentTx, rescheduleTx } from "./agenda";
import { refreshReturn } from "./returns";

/** Agendamento recorrente CONFIRMADO pelo cliente. A simples preferência de retorno fica em customer_return_rules e não reserva horário. */
const HORIZON_DAYS = 90;

export interface SeriesInput { customerId: string; staffId: string; chairId?: string | null; serviceIds: string[]; rule: Rule; time: string; startDate: string; endDate?: string | null; maxOccurrences?: number | null; confirmed: boolean; confirmedNote: string; notes?: string | null }
interface SeriesRow { id: string; unit_id: string; customer_id: string; staff_id: string; chair_id: string | null; service_ids: string[]; rule: Rule; time_hhmm: string; start_date: string; end_date: string | null; max_occurrences: number | null; is_active: boolean; created_by: string }
const COLS = "id, unit_id, customer_id, staff_id, chair_id, service_ids, rule, time_hhmm, to_char(start_date,'YYYY-MM-DD') as start_date, to_char(end_date,'YYYY-MM-DD') as end_date, max_occurrences, is_active, created_by";

export async function createSeries(db: Db, ctx: Ctx, i: SeriesInput) {
  assertManage(ctx, i.staffId, "agenda.create");
  if (!i.confirmed) throw new DomainError("not_confirmed", "Só reserve horários futuros com a confirmação do cliente. Sem confirmação, use a preferência de retorno.");
  const note = requireText(i.confirmedNote, "Como o cliente confirmou", 3);
  const rule = parseRule(i.rule);
  if (!rule) throw new DomainError("invalid", "Recorrência inválida.");
  if (!/^\d{2}:\d{2}$/.test(i.time) || !/^\d{4}-\d{2}-\d{2}$/.test(i.startDate)) throw new DomainError("invalid", "Data ou hora inválida.");
  if (i.endDate && i.endDate < i.startDate) throw new DomainError("invalid", "A data final é anterior ao início.");
  if (i.maxOccurrences != null && (!Number.isInteger(i.maxOccurrences) || i.maxOccurrences < 1 || i.maxOccurrences > 104)) throw new DomainError("invalid", "Quantidade de ocorrências inválida.");
  const id = await db.tx(async (q) => {
    const [s] = await q<{ id: string }>(
      "insert into appointment_series(unit_id,customer_id,staff_id,chair_id,service_ids,rule,time_hhmm,start_date,end_date,max_occurrences,confirmed_note,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id",
      [ctx.unitId, requireUuid(i.customerId, "Cliente"), requireUuid(i.staffId, "Profissional"), i.chairId ?? null, i.serviceIds, JSON.stringify(rule), i.time, i.startDate, i.endDate ?? null, i.maxOccurrences ?? null, note, ctx.userId]);
    await audit(q, ctx, "SERIE_CRIADA", "appointment_series", s.id, null, { ...i, rule });
    return s.id;
  });
  const r = await extendSeries(db, ctx, id);
  if (!r.created) {
    await db.query("update appointment_series set is_active=false where id=$1", [id]);
    throw new DomainError("conflict", `Nenhum horário da série está livre. ${r.conflicts[0]?.error ?? ""}`.trim());
  }
  await db.query("insert into notifications(unit_id,kind,severity,message,url,ref_entity,ref_id,dedupe_key) values ($1,'novo_agendamento','info',$2,'/agenda','appointment_series',$3,$4) on conflict (dedupe_key) do nothing", [ctx.unitId, `Série de agendamentos criada: ${ruleLabel(rule)}, ${r.created} horário(s) reservado(s).`, id, `series:${id}`]);
  return { id, ...r };
}

/** Cria as ocorrências que faltam até 90 dias à frente. Conflitos ficam registrados e não bloqueiam as demais datas. */
export async function extendSeries(db: Db, ctx: Ctx, seriesId: string) {
  const [s] = await db.query<SeriesRow>(`select ${COLS} from appointment_series where id=$1 and unit_id=$2`, [seriesId, ctx.unitId]);
  if (!s || !s.is_active) return { created: 0, conflicts: [] as { date: string; error: string }[] };
  const today = todayYmd();
  const limit = addDays(s.start_date > today ? s.start_date : today, HORIZON_DAYS);
  const until = s.end_date && s.end_date < limit ? s.end_date : limit;
  const dates = occurrences(s.rule, s.start_date, until, s.max_occurrences ?? 400).filter((d) => d >= today);
  const known = new Set((await db.query<{ d: string }>("select to_char(occurrence_date,'YYYY-MM-DD') as d from appointment_series_occurrences where series_id=$1", [s.id])).map((r) => r.d));
  let created = 0;
  const conflicts: { date: string; error: string }[] = [];
  for (const d of dates) {
    if (known.has(d)) continue;
    try {
      const ok = await db.tx(async (q) => {
        const claim = await q("insert into appointment_series_occurrences(series_id,occurrence_date,status) values ($1,$2,'conflito') on conflict do nothing returning series_id", [s.id, d]);
        if (!claim.length) return false;
        const id = await createAppointmentTx(q, ctx, { customerId: s.customer_id, staffId: s.staff_id, chairId: s.chair_id, startsAt: atLocal(d, s.time_hhmm), serviceIds: s.service_ids }, { silent: true, seriesId: s.id });
        await q("update appointment_series_occurrences set status='criado', appointment_id=$3 where series_id=$1 and occurrence_date=$2", [s.id, d, id]);
        return true;
      });
      if (ok) created++;
    } catch (e) {
      const msg = isDomainError(e) ? e.message : (e as { code?: string }).code === "23P01" ? "Horário ocupado." : null;
      if (!msg) throw e;
      conflicts.push({ date: d, error: msg });
      await db.query("insert into appointment_series_occurrences(series_id,occurrence_date,status,error) values ($1,$2,'conflito',$3) on conflict do nothing", [s.id, d, msg]);
    }
  }
  return { created, conflicts };
}

async function affected(q: Q, ctx: Ctx, appointmentId: string, scope: "seguintes" | "todas") {
  const [a] = await q<{ id: string; series_id: string | null; starts_at: Date; staff_id: string }>("select id, series_id, starts_at, staff_id from appointments where id=$1 and unit_id=$2", [requireUuid(appointmentId, "Agendamento"), ctx.unitId]);
  if (!a?.series_id) throw new DomainError("no_series", "Este agendamento não faz parte de uma série.");
  // realizados, cancelados e em andamento ficam intactos
  const list = await q<{ id: string; starts_at: Date; staff_id: string }>("select id, starts_at, staff_id from appointments where series_id=$1 and status='agendado' and starts_at > now() and ($2::timestamptz is null or starts_at >= $2) order by starts_at for update", [a.series_id, scope === "seguintes" ? a.starts_at : null]);
  if (!list.length) throw new DomainError("empty", "Não há ocorrências futuras para alterar.");
  const [s] = await q<SeriesRow>(`select ${COLS} from appointment_series where id=$1 for update`, [a.series_id]);
  return { a, list, s };
}

/** Altera esta e as seguintes, ou todas as futuras. É tudo ou nada: um conflito desfaz a alteração inteira. */
export async function updateSeries(db: Db, ctx: Ctx, i: { appointmentId: string; scope: "seguintes" | "todas"; date: string; time: string; staffId?: string | null; chairId?: string | null }) {
  if (!/^\d{2}:\d{2}$/.test(i.time) || !/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new DomainError("invalid", "Data ou hora inválida.");
  try {
    return await db.tx(async (q) => {
      const { a, list, s } = await affected(q, ctx, i.appointmentId, i.scope);
      const delta = daysBetween(toYmd(a.starts_at), i.date);
      if (delta && s.rule.kind === "ordinal") throw new DomainError("invalid", "Em séries por dia do mês, mude a data de uma ocorrência por vez ou crie outra série.");
      const staffId = i.staffId || s.staff_id;
      assertManage(ctx, s.staff_id); assertManage(ctx, staffId);
      const chairId = i.chairId === undefined ? s.chair_id : i.chairId;
      const rule: Rule = s.rule.kind === "dia_semana" ? { ...s.rule, dow: (((s.rule.dow + delta) % 7) + 7) % 7 } : s.rule;
      const first = addDays(toYmd(list[0].starts_at), delta);
      const last = toYmd(list[0].starts_at);
      const left = s.max_occurrences != null ? list.length : null;
      const [n] = await q<{ id: string }>(
        "insert into appointment_series(unit_id,customer_id,staff_id,chair_id,service_ids,rule,time_hhmm,start_date,end_date,max_occurrences,confirmed_note,created_by) select unit_id,customer_id,$2,$3,service_ids,$4,$5,$6,end_date + $7::int,$8,confirmed_note,$9 from appointment_series where id=$1 returning id",
        [s.id, staffId, chairId, JSON.stringify(rule), i.time, first, delta, left, ctx.userId]);
      for (const x of delta > 0 ? [...list].reverse() : list) {
        const d = addDays(toYmd(x.starts_at), delta);
        await rescheduleTx(q, ctx, x.id, { startsAt: atLocal(d, i.time), staffId, chairId: chairId ?? undefined, reason: "Alteração da série" }, true);
        await q("update appointments set series_id=$2 where id=$1", [x.id, n.id]);
        await q("delete from appointment_series_occurrences where appointment_id=$1", [x.id]);
        await q("insert into appointment_series_occurrences(series_id,occurrence_date,appointment_id,status) values ($1,$2,$3,'criado')", [n.id, d, x.id]);
      }
      await q("update appointment_series set is_active=false, end_date=least(coalesce(end_date,$2::date), greatest($2::date, start_date)) where id=$1", [s.id, addDays(last, -1)]);
      await audit(q, ctx, "SERIE_ALTERADA", "appointment_series", n.id, { from: s.id, time: s.time_hhmm, staff: s.staff_id }, { ...i, changed: list.length });
      return { changed: list.length };
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23P01") throw new DomainError("conflict", "Um dos horários da série já está ocupado. Nada foi alterado.");
    throw e;
  }
}

export async function cancelSeries(db: Db, ctx: Ctx, i: { appointmentId: string; scope: "seguintes" | "todas"; reason: string }) {
  const why = requireText(i.reason, "Motivo do cancelamento", 3);
  return db.tx(async (q) => {
    const { list, s } = await affected(q, ctx, i.appointmentId, i.scope);
    assertManage(ctx, s.staff_id, "agenda.cancel");
    await q("update appointments set status='cancelado', cancellation_reason=$2, cancelled_by=$3, cancelled_at=now(), updated_at=now(), updated_by=$3 where id = any($1::uuid[])", [list.map((x) => x.id), why, ctx.userId]);
    await q("update appointment_series set is_active=false where id=$1", [s.id]);
    await audit(q, ctx, "SERIE_CANCELADA", "appointment_series", s.id, null, { scope: i.scope, cancelled: list.length, from: fmtYmd(toYmd(list[0].starts_at)) }, why);
    await refreshReturn(q, ctx.unitId, s.customer_id);
    return { cancelled: list.length };
  });
}

export async function seriesOf(db: Db, ctx: Ctx, seriesId: string) {
  const [s] = await db.query<SeriesRow & { future: number }>(`select ${COLS}, (select count(*) from appointments a where a.series_id=appointment_series.id and a.status='agendado' and a.starts_at > now())::bigint as future from appointment_series where id=$1 and unit_id=$2`, [seriesId, ctx.unitId]);
  if (!s) return null;
  const conflicts = await db.query<{ d: string; error: string | null }>("select to_char(occurrence_date,'YYYY-MM-DD') as d, error from appointment_series_occurrences where series_id=$1 and status='conflito' and occurrence_date >= current_date order by occurrence_date", [seriesId]);
  return { ...s, label: ruleLabel(s.rule), conflicts };
}

export async function runSeriesJobs(db: Db, unitId: string, sysCtx: Ctx) {
  let created = 0;
  // o horário é criado em nome de quem confirmou a série
  for (const s of await db.query<{ id: string; created_by: string }>("select id, created_by from appointment_series where unit_id=$1 and is_active", [unitId])) created += (await extendSeries(db, { ...sysCtx, userId: s.created_by }, s.id)).created;
  return { created };
}
