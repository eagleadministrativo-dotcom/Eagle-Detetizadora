import type { Db, Q } from "../db";
import { audit, can, getSettings, need, requireText, requireUuid } from "../core";
import { DomainError, ForbiddenError } from "../errors";
import type { Ctx } from "../permissions";
import { priceAt } from "./catalog";
import { emit } from "./events";
import { refreshReturn } from "./returns";
import { dayOfWeek, toYmd, atLocal } from "@/lib/dates";

export interface AppointmentRow {
  id: string; customer_id: string; customer_name: string; customer_phone: string | null; customer_notes: string | null;
  staff_id: string; staff_name: string; staff_color: string; chair_id: string; chair_name: string;
  starts_at: Date; ends_at: Date; status: string; notes: string | null; cancellation_reason: string | null;
  services: string; total_cents: number; attendance_id: string | null; series_id: string | null;
}

const ACTIVE = "('agendado','em_atendimento','concluido')";

export function assertManage(ctx: Ctx, staffId: string, action: "agenda.create" | "agenda.edit" | "agenda.cancel" = "agenda.edit") {
  if (!can(ctx, action)) throw new ForbiddenError("Seu acesso não permite esta ação na agenda.");
  if (can(ctx, "agenda.manage")) return;
  if (can(ctx, "agenda.manage_own") && ctx.staffId && ctx.staffId === staffId) return;
  throw new ForbiddenError("Você só pode alterar a sua própria agenda.");
}

interface Slot { unitId: string; staffId: string; chairId: string; startsAt: Date; endsAt: Date; excludeId?: string }

export async function validateSlot(q: Q, s: Slot) {
  const [staff] = await q<{ is_active: boolean; name: string }>("select is_active, name from staff where id=$1 and unit_id=$2", [s.staffId, s.unitId]);
  if (!staff || !staff.is_active) throw new DomainError("invalid_staff", "Profissional inexistente ou inativo.");
  const [chair] = await q<{ is_active: boolean; name: string }>("select is_active, name from chairs where id=$1 and unit_id=$2", [s.chairId, s.unitId]);
  if (!chair || !chair.is_active) throw new DomainError("invalid_chair", "Cadeira inexistente ou inativa.");

  const scheds = await q<{ day_of_week: number; st: string; en: string }>(
    "select day_of_week, to_char(start_time,'HH24:MI') as st, to_char(end_time,'HH24:MI') as en from staff_schedules where staff_id=$1",
    [s.staffId],
  );
  if (scheds.length > 0) {
    const ymd = toYmd(s.startsAt);
    if (toYmd(new Date(s.endsAt.getTime() - 1)) !== ymd) throw new DomainError("outside_hours", "O atendimento não pode atravessar a meia-noite.");
    const dow = dayOfWeek(ymd);
    const ok = scheds.some((x) => x.day_of_week === dow && s.startsAt >= atLocal(ymd, x.st) && s.endsAt <= atLocal(ymd, x.en));
    if (!ok) throw new DomainError("outside_hours", `${staff.name} não atende nesse horário (fora da escala cadastrada).`);
  }

  const [blk] = await q<{ reason: string }>(
    `select reason from schedule_blocks where unit_id=$1 and cancelled_at is null and tstzrange(starts_at,ends_at) && tstzrange($2,$3)
       and (chair_id is null and staff_id is null or chair_id=$4 or staff_id=$5) limit 1`,
    [s.unitId, s.startsAt, s.endsAt, s.chairId, s.staffId],
  );
  if (blk) throw new DomainError("blocked", `Horário bloqueado: ${blk.reason}.`);

  const [cc] = await q<{ customer_name: string; starts_at: Date; ends_at: Date }>(
    `select c.name as customer_name, a.starts_at, a.ends_at from appointments a join customers c on c.id=a.customer_id
     where a.chair_id=$1 and a.status in ${ACTIVE} and tstzrange(a.starts_at,a.ends_at) && tstzrange($2,$3) and ($4::uuid is null or a.id <> $4) limit 1`,
    [s.chairId, s.startsAt, s.endsAt, s.excludeId ?? null],
  );
  if (cc) throw new DomainError("chair_conflict", `${chair.name} já está ocupada nesse horário (${cc.customer_name}).`, cc);
  const [sc] = await q<{ customer_name: string }>(
    `select c.name as customer_name from appointments a join customers c on c.id=a.customer_id
     where a.staff_id=$1 and a.status in ${ACTIVE} and tstzrange(a.starts_at,a.ends_at) && tstzrange($2,$3) and ($4::uuid is null or a.id <> $4) limit 1`,
    [s.staffId, s.startsAt, s.endsAt, s.excludeId ?? null],
  );
  if (sc) throw new DomainError("staff_conflict", `${staff.name} já tem atendimento nesse horário (${sc.customer_name}).`, sc);
}

async function checkRetroactive(q: Q, ctx: Ctx, startsAt: Date) {
  if (startsAt.getTime() >= Date.now() - 10 * 60000) return;
  if (!can(ctx, "agenda.retroactive")) throw new DomainError("past", "Não é possível agendar no passado.");
  const st = await getSettings(q, ctx.unitId);
  if (startsAt.getTime() < Date.now() - st.retroactive_edit_days * 86400000) {
    throw new DomainError("past_limit", `Lançamentos retroativos são permitidos até ${st.retroactive_edit_days} dia(s).`);
  }
}

async function resolveServices(q: Q, unitId: string, staffId: string, serviceIds: string[], at: Date) {
  if (serviceIds.length === 0) throw new DomainError("no_services", "Selecione pelo menos um serviço.");
  const out: { id: string; name: string; price: number; minutes: number }[] = [];
  for (const sid of serviceIds) {
    requireUuid(sid, "Serviço");
    const [s] = await q<{ name: string; duration_minutes: number; buffer_minutes: number; is_active: boolean }>("select name,duration_minutes,buffer_minutes,is_active from services where id=$1 and unit_id=$2", [sid, unitId]);
    if (!s || !s.is_active) throw new DomainError("invalid_service", "Serviço inexistente ou inativo.");
    const allowed = await q("select 1 from service_staff where service_id=$1", [sid]);
    if (allowed.length > 0) {
      const [ok] = await q("select 1 from service_staff where service_id=$1 and staff_id=$2", [sid, staffId]);
      if (!ok) throw new DomainError("staff_not_allowed", `Este profissional não realiza "${s.name}".`);
    }
    // retroativo: se não havia preço vigente na data, usa o preço atual
    const price = (await priceAt(q, sid, staffId, at)) ?? (await priceAt(q, sid, staffId, new Date()));
    if (price == null) throw new DomainError("no_price", `O serviço "${s.name}" ainda não tem preço cadastrado.`);
    out.push({ id: sid, name: s.name, price, minutes: s.duration_minutes + s.buffer_minutes });
  }
  return out;
}

export interface CreateAppointmentInput { customerId: string; staffId: string; chairId?: string | null; startsAt: Date; serviceIds: string[]; notes?: string | null }

export async function createAppointmentTx(q: Q, ctx: Ctx, input: CreateAppointmentInput, opts: { silent?: boolean; seriesId?: string } = {}): Promise<string> {
  assertManage(ctx, input.staffId, "agenda.create");
  requireUuid(input.customerId, "Cliente");
  requireUuid(input.staffId, "Profissional");
  const [cust] = await q<{ is_active: boolean }>("select is_active from customers where id=$1 and unit_id=$2", [input.customerId, ctx.unitId]);
  if (!cust || !cust.is_active) throw new DomainError("invalid_customer", "Cliente inexistente ou inativo.");
  await checkRetroactive(q, ctx, input.startsAt);
  const svcs = await resolveServices(q, ctx.unitId, input.staffId, input.serviceIds, input.startsAt);
  const minutes = svcs.reduce((a, s) => a + s.minutes, 0);
  const endsAt = new Date(input.startsAt.getTime() + minutes * 60000);

  let chairId = input.chairId ?? null;
  if (chairId) await validateSlot(q, { unitId: ctx.unitId, staffId: input.staffId, chairId, startsAt: input.startsAt, endsAt });
  else {
    const chairs = await q<{ id: string }>("select id from chairs where unit_id=$1 and is_active order by name", [ctx.unitId]);
    let lastErr: unknown = new DomainError("no_chair", "Não há cadeira ativa cadastrada.");
    for (const c of chairs) {
      try {
        await validateSlot(q, { unitId: ctx.unitId, staffId: input.staffId, chairId: c.id, startsAt: input.startsAt, endsAt });
        chairId = c.id;
        break;
      } catch (e) {
        lastErr = e;
        if (e instanceof DomainError && !["chair_conflict"].includes(e.code)) throw e;
      }
    }
    if (!chairId) throw lastErr;
  }
  const [a] = await q<{ id: string }>(
    "insert into appointments(unit_id,customer_id,staff_id,chair_id,starts_at,ends_at,notes,created_by,updated_by,series_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) returning id",
    [ctx.unitId, input.customerId, input.staffId, chairId, input.startsAt, endsAt, input.notes ?? null, ctx.userId, opts.seriesId ?? null],
  );
  for (const s of svcs) {
    await q("insert into appointment_services(appointment_id,service_id,name_snapshot,price_cents,duration_minutes) values ($1,$2,$3,$4,$5)", [a.id, s.id, s.name, s.price, s.minutes]);
  }
  await audit(q, ctx, "AGENDAMENTO_CRIADO", "appointment", a.id, null, { customer: input.customerId, staff: input.staffId, chair: chairId, starts_at: input.startsAt, ends_at: endsAt, services: svcs.map((s) => s.name) });
  if (!opts.silent) await notifyAppointment(q, ctx, a.id, "novo_agendamento", "Novo agendamento", svcs.map((s) => s.name).join(", "));
  return a.id;
}

/** Avisa (alerta + push) proprietário/gerente e o próprio profissional sobre mudanças na agenda. */
async function notifyAppointment(q: Q, ctx: Ctx, id: string, kind: "novo_agendamento" | "agendamento_cancelado" | "agendamento_reagendado", verb: string, extra?: string) {
  const [r] = await q<{ cname: string; sname: string; user_id: string | null; starts_at: Date }>(
    "select c.name as cname, s.name as sname, s.user_id, a.starts_at from appointments a join customers c on c.id=a.customer_id join staff s on s.id=a.staff_id where a.id=$1",
    [id],
  );
  if (!r) return;
  const when = r.starts_at.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const msg = `${verb}: ${r.cname} com ${r.sname} em ${when}${extra ? ` (${extra})` : ""}.`;
  const key = `${kind}:${id}:${Date.now()}`;
  await q("insert into notifications(unit_id,kind,severity,message,ref_entity,ref_id,dedupe_key,url) values ($1,$2,$3,$4,'appointment',$5,$6,'/agenda/' || $5)", [ctx.unitId, kind, kind === "agendamento_cancelado" ? "atencao" : "info", msg, id, key]);
  if (r.user_id && r.user_id !== ctx.userId) {
    await q("insert into notifications(unit_id,user_id,kind,severity,message,ref_entity,ref_id,dedupe_key,url) values ($1,$2,$3,$4,$5,'appointment',$6,$7,'/agenda/' || $6)", [ctx.unitId, r.user_id, kind, kind === "agendamento_cancelado" ? "atencao" : "info", msg, id, key + ":staff"]);
  }
}

export async function createAppointment(db: Db, ctx: Ctx, input: CreateAppointmentInput): Promise<string> {
  try {
    return await db.tx((q) => createAppointmentTx(q, ctx, input));
  } catch (e) {
    // rede de segurança: a constraint do banco barrou uma corrida entre dois operadores
    if ((e as { code?: string }).code === "23P01") throw new DomainError("conflict", "Esse horário acabou de ser ocupado por outro operador. Escolha outro.");
    throw e;
  }
}

export interface RescheduleInput { startsAt: Date; staffId?: string; chairId?: string; reason?: string; minutes?: number }

export async function rescheduleTx(q: Q, ctx: Ctx, id: string, input: RescheduleInput, silent = false) {
  const [a] = await q<{ staff_id: string; chair_id: string; starts_at: Date; ends_at: Date; status: string }>("select staff_id,chair_id,starts_at,ends_at,status from appointments where id=$1 and unit_id=$2 for update", [id, ctx.unitId]);
  if (!a) throw new DomainError("not_found", "Agendamento não encontrado.");
  if (a.status !== "agendado") throw new DomainError("bad_status", "Só é possível reagendar atendimentos com status Agendado.");
  const staffId = input.staffId ?? a.staff_id;
  assertManage(ctx, a.staff_id);
  assertManage(ctx, staffId);
  if (Number.isNaN(input.startsAt.getTime())) throw new DomainError("invalid", "Data inválida.");
  await checkRetroactive(q, ctx, input.startsAt);
  if (input.minutes != null && (!Number.isInteger(input.minutes) || input.minutes < 5 || input.minutes > 720)) throw new DomainError("invalid", "Duração inválida.");
  const duration = input.minutes != null ? input.minutes * 60000 : a.ends_at.getTime() - a.starts_at.getTime();
  const endsAt = new Date(input.startsAt.getTime() + duration);
  const chairId = input.chairId ?? a.chair_id;
  if (staffId !== a.staff_id) {
    // o novo profissional precisa realizar todos os serviços reservados
    const [no] = await q<{ name: string }>("select s.name from appointment_services x join services s on s.id=x.service_id where x.appointment_id=$1 and exists (select 1 from service_staff ss where ss.service_id=s.id) and not exists (select 1 from service_staff ss where ss.service_id=s.id and ss.staff_id=$2) limit 1", [id, staffId]);
    if (no) throw new DomainError("staff_not_allowed", `Este profissional não realiza "${no.name}".`);
  }
  await validateSlot(q, { unitId: ctx.unitId, staffId, chairId, startsAt: input.startsAt, endsAt, excludeId: id });
  await q("update appointments set staff_id=$2, chair_id=$3, starts_at=$4, ends_at=$5, updated_at=now(), updated_by=$6, reminder_sent_at=case when starts_at=$4 then reminder_sent_at end, reminder_channel=case when starts_at=$4 then reminder_channel end where id=$1", [id, staffId, chairId, input.startsAt, endsAt, ctx.userId]);
  await audit(q, ctx, "AGENDAMENTO_REAGENDADO", "appointment", id, { staff_id: a.staff_id, chair_id: a.chair_id, starts_at: a.starts_at, ends_at: a.ends_at }, { staff_id: staffId, chair_id: chairId, starts_at: input.startsAt, ends_at: endsAt }, input.reason);
  if (!silent) await notifyAppointment(q, ctx, id, "agendamento_reagendado", "Agendamento reagendado");
}

export async function rescheduleAppointment(db: Db, ctx: Ctx, id: string, input: RescheduleInput) {
  try {
    await db.tx((q) => rescheduleTx(q, ctx, id, input));
  } catch (e) {
    if ((e as { code?: string }).code === "23P01") throw new DomainError("conflict", "Esse horário acabou de ser ocupado por outro operador. Escolha outro.");
    throw e;
  }
}

export async function cancelAppointment(db: Db, ctx: Ctx, id: string, reason: string) {
  const why = requireText(reason, "Motivo do cancelamento", 3);
  await db.tx(async (q) => {
    const [a] = await q<{ staff_id: string; status: string; starts_at: Date }>("select staff_id,status,starts_at from appointments where id=$1 and unit_id=$2 for update", [id, ctx.unitId]);
    if (!a) throw new DomainError("not_found", "Agendamento não encontrado.");
    assertManage(ctx, a.staff_id, "agenda.cancel");
    if (a.status !== "agendado") throw new DomainError("bad_status", "Só é possível cancelar agendamentos com status Agendado.");
    await q("update appointments set status='cancelado', cancellation_reason=$2, cancelled_by=$3, cancelled_at=now(), updated_at=now(), updated_by=$3 where id=$1", [id, why, ctx.userId]);
    await audit(q, ctx, "AGENDAMENTO_CANCELADO", "appointment", id, { status: a.status }, { status: "cancelado" }, why);
    await notifyAppointment(q, ctx, id, "agendamento_cancelado", "Agendamento cancelado", why);
    const [cu] = await q<{ customer_id: string }>("select customer_id from appointments where id=$1", [id]);
    await emit(q, ctx, "appointment.cancelled", "appointment", id, { customerId: cu.customer_id, staffId: a.staff_id }, `appointment.cancelled:${id}`);
    await refreshReturn(q, ctx.unitId, cu.customer_id);
  });
}

export async function markNoShow(db: Db, ctx: Ctx, id: string) {
  await db.tx(async (q) => {
    const [a] = await q<{ staff_id: string; status: string; customer_id: string; starts_at: Date }>("select staff_id,status,customer_id,starts_at from appointments where id=$1 and unit_id=$2 for update", [id, ctx.unitId]);
    if (!a) throw new DomainError("not_found", "Agendamento não encontrado.");
    assertManage(ctx, a.staff_id);
    if (a.status !== "agendado") throw new DomainError("bad_status", "Só é possível marcar ausência em agendamentos com status Agendado.");
    if (a.starts_at.getTime() > Date.now()) throw new DomainError("too_early", "O horário ainda não passou.");
    await q("update appointments set status='nao_compareceu', updated_at=now(), updated_by=$2 where id=$1", [id, ctx.userId]);
    const st = await getSettings(q, ctx.unitId);
    if (st.no_show_policy === "cobrar_taxa" && (st.no_show_fee_cents ?? 0) > 0) {
      await q("insert into receivables(unit_id,customer_id,description,amount_due_cents,created_by) values ($1,$2,$3,$4,$5)", [ctx.unitId, a.customer_id, "Taxa de não comparecimento", st.no_show_fee_cents, ctx.userId]);
    }
    await audit(q, ctx, "AGENDAMENTO_NAO_COMPARECEU", "appointment", id, { status: a.status }, { status: "nao_compareceu" });
  });
}

export async function listAppointments(db: Db, ctx: Ctx, range: { from: Date; to: Date }, opts: { staffId?: string | null; includeCancelled?: boolean } = {}): Promise<AppointmentRow[]> {
  need(ctx, "agenda.view_all", "agenda.view_own");
  let staffId = opts.staffId ?? null;
  if (!can(ctx, "agenda.view_all")) {
    if (!ctx.staffId) return [];
    staffId = ctx.staffId;
  }
  const contact = can(ctx, "customers.view");
  return db.query<AppointmentRow>(
    `select a.id, a.series_id, a.customer_id, c.name as customer_name, ${contact ? "c.phone" : "null::text"} as customer_phone, ${contact ? "c.notes" : "null::text"} as customer_notes,
       a.staff_id, s.name as staff_name, s.color as staff_color, a.chair_id, ch.name as chair_name,
       a.starts_at, a.ends_at, a.status, a.notes, a.cancellation_reason,
       coalesce((select string_agg(x.name_snapshot, ' + ' order by x.name_snapshot) from appointment_services x where x.appointment_id=a.id),'') as services,
       coalesce((select sum(x.price_cents) from appointment_services x where x.appointment_id=a.id),0)::bigint as total_cents,
       (select t.id from attendances t where t.appointment_id=a.id) as attendance_id
     from appointments a
     join customers c on c.id=a.customer_id join staff s on s.id=a.staff_id join chairs ch on ch.id=a.chair_id
     where a.unit_id=$1 and a.starts_at >= $2 and a.starts_at < $3 and ($4::uuid is null or a.staff_id=$4) and ($5 or a.status <> 'cancelado')
     order by a.starts_at`,
    [ctx.unitId, range.from, range.to, staffId, opts.includeCancelled ?? false],
  );
}

export interface BlockRow { id: string; chair_id: string | null; staff_id: string | null; starts_at: Date; ends_at: Date; reason: string; chair_name: string | null; staff_name: string | null }
export async function listBlocks(db: Db, ctx: Ctx, range: { from: Date; to: Date }): Promise<BlockRow[]> {
  need(ctx, "agenda.view_all", "agenda.view_own");
  return db.query<BlockRow>(
    `select b.id,b.chair_id,b.staff_id,b.starts_at,b.ends_at,b.reason, c.name as chair_name, s.name as staff_name
     from schedule_blocks b left join chairs c on c.id=b.chair_id left join staff s on s.id=b.staff_id
     where b.unit_id=$1 and b.cancelled_at is null and b.starts_at < $3 and b.ends_at > $2 order by b.starts_at`,
    [ctx.unitId, range.from, range.to],
  );
}

export async function createBlock(db: Db, ctx: Ctx, input: { chairId?: string | null; staffId?: string | null; startsAt: Date; endsAt: Date; reason: string }) {
  need(ctx, "agenda.block");
  const reason = requireText(input.reason, "Motivo do bloqueio", 3);
  if (input.endsAt <= input.startsAt) throw new DomainError("invalid", "O fim deve ser depois do início.");
  await db.tx(async (q) => {
    const conflicts = await q(
      `select 1 from appointments a where a.unit_id=$1 and a.status in ('agendado','em_atendimento') and tstzrange(a.starts_at,a.ends_at) && tstzrange($2,$3)
         and ($4::uuid is null or a.chair_id=$4) and ($5::uuid is null or a.staff_id=$5) limit 1`,
      [ctx.unitId, input.startsAt, input.endsAt, input.chairId ?? null, input.staffId ?? null],
    );
    if (conflicts.length) throw new DomainError("has_appointments", "Já existem agendamentos nesse intervalo. Remaneje-os antes de bloquear.");
    const [b] = await q<{ id: string }>("insert into schedule_blocks(unit_id,chair_id,staff_id,starts_at,ends_at,reason,created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id", [
      ctx.unitId, input.chairId ?? null, input.staffId ?? null, input.startsAt, input.endsAt, reason, ctx.userId,
    ]);
    await audit(q, ctx, "BLOQUEIO_CRIADO", "schedule_block", b.id, null, { ...input, reason });
  });
}

export async function cancelBlock(db: Db, ctx: Ctx, id: string) {
  need(ctx, "agenda.block");
  await db.tx(async (q) => {
    await q("update schedule_blocks set cancelled_at=now() where id=$1 and unit_id=$2 and cancelled_at is null", [id, ctx.unitId]);
    await audit(q, ctx, "BLOQUEIO_REMOVIDO", "schedule_block", id);
  });
}

/** Horários livres (passo de 15 min) para o profissional no dia, respeitando escala, bloqueios e conflitos. */
export async function freeSlots(db: Db, ctx: Ctx, input: { date: string; staffId: string; minutes: number }): Promise<string[]> {
  need(ctx, "agenda.view_all", "agenda.view_own", "agenda.manage_own");
  const out: string[] = [];
  const settings = await getSettings(db.query, ctx.unitId);
  const dow = dayOfWeek(input.date);
  const scheds = await db.query<{ st: string; en: string }>(
    "select to_char(start_time,'HH24:MI') as st, to_char(end_time,'HH24:MI') as en from staff_schedules where staff_id=$1 and day_of_week=$2",
    [input.staffId, dow],
  );
  const windows: [string, string][] = scheds.length ? scheds.map((s) => [s.st, s.en]) : (settings.business_hours[String(dow)] ?? []);
  const chairs = await db.query<{ id: string }>("select id from chairs where unit_id=$1 and is_active", [ctx.unitId]);
  for (const [st, en] of windows) {
    for (let t = atLocal(input.date, st).getTime(); t + input.minutes * 60000 <= atLocal(input.date, en).getTime(); t += 15 * 60000) {
      const startsAt = new Date(t);
      if (startsAt.getTime() < Date.now()) continue;
      const endsAt = new Date(t + input.minutes * 60000);
      for (const c of chairs) {
        try {
          await validateSlot(db.query, { unitId: ctx.unitId, staffId: input.staffId, chairId: c.id, startsAt, endsAt });
          out.push(startsAt.toISOString());
          break;
        } catch {
          /* tenta a próxima cadeira */
        }
      }
    }
  }
  return out;
}
