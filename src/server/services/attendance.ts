import type { Db, Q } from "../db";
import { audit, can, finishAutomation, getSettings, need, requireText, requireUuid, startAutomation } from "../core";
import { DomainError, ForbiddenError } from "../errors";
import type { Ctx } from "../permissions";
import { priceAt } from "./catalog";
import { createAppointmentTx } from "./agenda";
import { registerPaymentTx, type RegisterPaymentInput } from "./payments";

function assertRun(ctx: Ctx, staffId: string) {
  if (can(ctx, "attendance.run")) return;
  if (can(ctx, "attendance.run_own") && ctx.staffId && ctx.staffId === staffId) return;
  throw new ForbiddenError("Você só pode operar os seus próprios atendimentos.");
}

async function recompute(q: Q, attendanceId: string) {
  const [t] = await q<{ subtotal: number }>("select coalesce(sum(line_total_cents),0)::bigint as subtotal from attendance_items where attendance_id=$1", [attendanceId]);
  const [a] = await q<{ discount_cents: number }>("select discount_cents from attendances where id=$1", [attendanceId]);
  const discount = Math.min(a.discount_cents, t.subtotal);
  await q("update attendances set subtotal_cents=$2, discount_cents=$3, total_cents=$4, updated_at=now() where id=$1", [attendanceId, t.subtotal, discount, t.subtotal - discount]);
}

export async function startAttendance(db: Db, ctx: Ctx, appointmentId: string): Promise<string> {
  return db.tx((q) => startAttendanceTx(q, ctx, appointmentId));
}

async function startAttendanceTx(q: Q, ctx: Ctx, appointmentId: string): Promise<string> {
  const [a] = await q<{ staff_id: string; chair_id: string; customer_id: string; status: string }>(
    "select staff_id, chair_id, customer_id, status from appointments where id=$1 and unit_id=$2 for update", [appointmentId, ctx.unitId]);
  if (!a) throw new DomainError("not_found", "Agendamento não encontrado.");
  assertRun(ctx, a.staff_id);
  if (a.status === "em_atendimento") {
    const [ex] = await q<{ id: string }>("select id from attendances where appointment_id=$1", [appointmentId]);
    if (ex) return ex.id;
  }
  if (a.status !== "agendado") throw new DomainError("bad_status", "Só é possível iniciar atendimentos com status Agendado.");
  const [att] = await q<{ id: string }>(
    "insert into attendances(unit_id,appointment_id,staff_id,chair_id,customer_id,created_by) values ($1,$2,$3,$4,$5,$6) returning id",
    [ctx.unitId, appointmentId, a.staff_id, a.chair_id, a.customer_id, ctx.userId],
  );
  await q(
    `insert into attendance_items(attendance_id,service_id,name_snapshot,quantity,unit_price_cents,line_total_cents)
     select $1, service_id, name_snapshot, 1, price_cents, price_cents from appointment_services where appointment_id=$2`,
    [att.id, appointmentId],
  );
  await q("update appointments set status='em_atendimento', updated_at=now(), updated_by=$2 where id=$1", [appointmentId, ctx.userId]);
  await recompute(q, att.id);
  await audit(q, ctx, "ATENDIMENTO_INICIADO", "attendance", att.id, null, { appointment: appointmentId });
  return att.id;
}

/** Cliente sem hora marcada: cria o agendamento para agora e já inicia o atendimento. */
export async function quickAttendance(db: Db, ctx: Ctx, input: { customerId: string; staffId: string; chairId?: string | null; serviceIds: string[]; startsAt?: Date }): Promise<string> {
  return db.tx(async (q) => {
    const apptId = await createAppointmentTx(q, ctx, { ...input, startsAt: input.startsAt ?? new Date() });
    return startAttendanceTx(q, ctx, apptId);
  });
}

export async function setAttendanceServices(db: Db, ctx: Ctx, attendanceId: string, serviceIds: string[]) {
  if (serviceIds.length === 0) throw new DomainError("no_services", "O atendimento precisa de pelo menos um serviço.");
  await db.tx(async (q) => {
    const [a] = await q<{ staff_id: string; status: string }>("select staff_id,status from attendances where id=$1 and unit_id=$2 for update", [attendanceId, ctx.unitId]);
    if (!a) throw new DomainError("not_found", "Atendimento não encontrado.");
    assertRun(ctx, a.staff_id);
    if (a.status !== "iniciado") throw new DomainError("bad_status", "Só é possível alterar serviços de atendimentos em andamento.");
    const current = await q<{ id: string; service_id: string }>("select id, service_id from attendance_items where attendance_id=$1", [attendanceId]);
    const want = new Set(serviceIds);
    for (const it of current) if (!want.has(it.service_id)) await q("delete from attendance_items where id=$1", [it.id]);
    const have = new Set(current.map((c) => c.service_id));
    for (const sid of serviceIds) {
      if (have.has(sid)) continue;
      requireUuid(sid, "Serviço");
      const [s] = await q<{ name: string; is_active: boolean }>("select name,is_active from services where id=$1 and unit_id=$2", [sid, ctx.unitId]);
      if (!s || !s.is_active) throw new DomainError("invalid_service", "Serviço inexistente ou inativo.");
      const price = await priceAt(q, sid, a.staff_id, new Date());
      if (price == null) throw new DomainError("no_price", `O serviço "${s.name}" ainda não tem preço cadastrado.`);
      await q("insert into attendance_items(attendance_id,service_id,name_snapshot,quantity,unit_price_cents,line_total_cents) values ($1,$2,$3,1,$4,$4)", [attendanceId, sid, s.name, price]);
    }
    await recompute(q, attendanceId);
    await audit(q, ctx, "ATENDIMENTO_SERVICOS_ALTERADOS", "attendance", attendanceId, null, { services: serviceIds });
  });
}

export async function applyDiscount(db: Db, ctx: Ctx, attendanceId: string, input: { discountCents: number; reason: string }) {
  const reason = requireText(input.reason, "Motivo do desconto", 3);
  if (!Number.isInteger(input.discountCents) || input.discountCents < 0) throw new DomainError("invalid", "Valor de desconto inválido.");
  await db.tx(async (q) => {
    const [a] = await q<{ staff_id: string; status: string; subtotal_cents: number; discount_cents: number }>("select staff_id,status,subtotal_cents,discount_cents from attendances where id=$1 and unit_id=$2 for update", [attendanceId, ctx.unitId]);
    if (!a) throw new DomainError("not_found", "Atendimento não encontrado.");
    assertRun(ctx, a.staff_id);
    if (a.status !== "iniciado") throw new DomainError("bad_status", "Só é possível dar desconto em atendimentos em andamento.");
    if (input.discountCents > a.subtotal_cents) throw new DomainError("invalid", "O desconto não pode ser maior que o total.");
    if (input.discountCents > 0) {
      const st = await getSettings(q, ctx.unitId);
      const unrestricted = can(ctx, "attendance.discount");
      const limited = can(ctx, "attendance.discount_limited") && !st.discount_owner_only && st.discount_limit_bps != null && input.discountCents * 10000 <= a.subtotal_cents * st.discount_limit_bps;
      if (!unrestricted && !limited) {
        throw new DomainError("discount_not_allowed", st.discount_owner_only || !can(ctx, "attendance.discount_limited")
          ? "Descontos precisam ser autorizados pelo proprietário."
          : "Desconto acima do limite autorizado. Peça a aprovação do proprietário.");
      }
    }
    await q("update attendances set discount_cents=$2, discount_reason=$3, discount_authorized_by=$4 where id=$1", [attendanceId, input.discountCents, input.discountCents > 0 ? reason : null, input.discountCents > 0 ? ctx.userId : null]);
    await recompute(q, attendanceId);
    await audit(q, ctx, "DESCONTO_APLICADO", "attendance", attendanceId, { discount: a.discount_cents }, { discount: input.discountCents }, reason);
  });
}

export interface CompleteInput { payments?: Omit<RegisterPaymentInput, "receivableId">[] }

/** Conclui o atendimento e cria a cobrança (A03). Pode registrar pagamentos na mesma transação; sem pagamentos, fica pendente. */
export async function completeAttendance(db: Db, ctx: Ctx, attendanceId: string, input: CompleteInput = {}): Promise<{ receivableId: string; paymentIds: string[] }> {
  return db.tx(async (q) => {
    const [a] = await q<{ staff_id: string; status: string; customer_id: string; total_cents: number; subtotal_cents: number; appointment_id: string }>(
      "select staff_id,status,customer_id,total_cents,subtotal_cents,appointment_id from attendances where id=$1 and unit_id=$2 for update", [attendanceId, ctx.unitId]);
    if (!a) throw new DomainError("not_found", "Atendimento não encontrado.");
    assertRun(ctx, a.staff_id);
    if (a.status === "concluido") throw new DomainError("already_done", "Este atendimento já foi concluído.");
    if (a.status !== "iniciado") throw new DomainError("bad_status", "Este atendimento não pode ser concluído.");
    const [items] = await q<{ n: number }>("select count(*) as n from attendance_items where attendance_id=$1", [attendanceId]);
    if (items.n === 0) throw new DomainError("no_services", "Inclua pelo menos um serviço antes de concluir.");
    await q("update attendances set status='concluido', finished_at=now(), updated_at=now() where id=$1", [attendanceId]);
    // ao concluir, o horário real termina agora: libera o restante da janela reservada
    await q("update appointments set status='concluido', ends_at=greatest(least(ends_at, now()), starts_at + interval '1 minute'), updated_at=now(), updated_by=$2 where id=$1", [a.appointment_id, ctx.userId]);
    const [existing] = await q<{ id: string }>("select id from receivables where attendance_id=$1", [attendanceId]);
    let receivableId = existing?.id;
    if (!receivableId) {
      const run = await startAutomation(q, "A03", ctx.unitId, `att:${attendanceId}`, "ATENDIMENTO_CONCLUIDO");
      const [r] = await q<{ id: string }>(
        "insert into receivables(unit_id,attendance_id,customer_id,description,amount_due_cents,created_by) values ($1,$2,$3,$4,$5,$6) returning id",
        [ctx.unitId, attendanceId, a.customer_id, "Atendimento", a.total_cents, ctx.userId],
      );
      receivableId = r.id;
      if (run) await finishAutomation(q, "A03", ctx.unitId, `att:${attendanceId}`, "ATENDIMENTO_CONCLUIDO", { attendanceId }, { receivableId, amount: a.total_cents });
    }
    const paymentIds: string[] = [];
    for (const p of input.payments ?? []) {
      const res = await registerPaymentTx(q, ctx, { ...p, receivableId });
      paymentIds.push(res.id);
    }
    await audit(q, ctx, "ATENDIMENTO_CONCLUIDO", "attendance", attendanceId, null, { total: a.total_cents, receivable: receivableId, payments: paymentIds.length });
    return { receivableId, paymentIds };
  });
}

export async function cancelAttendance(db: Db, ctx: Ctx, attendanceId: string, reason: string) {
  const why = requireText(reason, "Motivo", 3);
  await db.tx(async (q) => {
    const [a] = await q<{ staff_id: string; status: string; appointment_id: string }>("select staff_id,status,appointment_id from attendances where id=$1 and unit_id=$2 for update", [attendanceId, ctx.unitId]);
    if (!a) throw new DomainError("not_found", "Atendimento não encontrado.");
    assertRun(ctx, a.staff_id);
    if (a.status !== "iniciado") throw new DomainError("bad_status", "Só é possível cancelar atendimentos em andamento.");
    await q("update attendances set status='cancelado', updated_at=now() where id=$1", [attendanceId]);
    await q("update appointments set status='cancelado', cancellation_reason=$2, cancelled_by=$3, cancelled_at=now(), updated_at=now() where id=$1", [a.appointment_id, why, ctx.userId]);
    await audit(q, ctx, "ATENDIMENTO_CANCELADO", "attendance", attendanceId, null, null, why);
  });
}

export interface AttendanceRow {
  id: string; appointment_id: string; status: string; started_at: Date; finished_at: Date | null; subtotal_cents: number; discount_cents: number; discount_reason: string | null; total_cents: number;
  customer_id: string; customer_name: string; staff_id: string; staff_name: string; chair_name: string; receivable_id: string | null;
  pay_status: string | null; registered_cents: number | null; confirmed_cents: number | null;
}

export async function listAttendances(db: Db, ctx: Ctx, opts: { from?: Date; to?: Date; status?: string; limit?: number; offset?: number } = {}) {
  need(ctx, "attendance.view_all", "attendance.view_own");
  const staffId = can(ctx, "attendance.view_all") ? null : ctx.staffId ?? "00000000-0000-0000-0000-000000000000";
  const rows = await db.query<AttendanceRow & { total: number }>(
    `select a.id, a.appointment_id, a.status, a.started_at, a.finished_at, a.subtotal_cents, a.discount_cents, a.discount_reason, a.total_cents,
       a.customer_id, c.name as customer_name, a.staff_id, s.name as staff_name, ch.name as chair_name,
       r.id as receivable_id, b.registered_cents, b.confirmed_cents,
       case when r.id is null then null when r.status='cancelado' then 'cancelado' when b.registered_cents >= r.amount_due_cents then 'recebido' when b.registered_cents > 0 then 'parcialmente_recebido' else 'pendente' end as pay_status,
       count(*) over() as total
     from attendances a join customers c on c.id=a.customer_id join staff s on s.id=a.staff_id join chairs ch on ch.id=a.chair_id
     left join receivables r on r.attendance_id=a.id left join receivable_balances b on b.receivable_id=r.id
     where a.unit_id=$1 and ($2::uuid is null or a.staff_id=$2) and ($3::timestamptz is null or a.started_at >= $3) and ($4::timestamptz is null or a.started_at < $4)
       and ($5::text is null or a.status=$5)
     order by a.started_at desc limit $6 offset $7`,
    [ctx.unitId, staffId, opts.from ?? null, opts.to ?? null, opts.status ?? null, opts.limit ?? 50, opts.offset ?? 0],
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

export async function getAttendance(db: Db, ctx: Ctx, id: string) {
  need(ctx, "attendance.view_all", "attendance.view_own");
  const { rows } = await listAttendancesById(db, ctx, id);
  const a = rows[0];
  if (!a) throw new DomainError("not_found", "Atendimento não encontrado.");
  if (!can(ctx, "attendance.view_all") && a.staff_id !== ctx.staffId) throw new ForbiddenError();
  const items = await db.query<{ id: string; service_id: string | null; name_snapshot: string; quantity: number; unit_price_cents: number; line_total_cents: number }>(
    "select id, service_id, name_snapshot, quantity, unit_price_cents, line_total_cents from attendance_items where attendance_id=$1 order by name_snapshot", [id]);
  const [appt] = await db.query<{ starts_at: Date; ends_at: Date; notes: string | null; customer_notes: string | null; customer_phone: string | null }>(
    "select ap.starts_at, ap.ends_at, ap.notes, c.notes as customer_notes, c.phone as customer_phone from appointments ap join customers c on c.id=ap.customer_id where ap.id=$1", [a.appointment_id]);
  return { attendance: a, items, appointment: appt };
}

async function listAttendancesById(db: Db, ctx: Ctx, id: string) {
  const rows = await db.query<AttendanceRow>(
    `select a.id, a.appointment_id, a.status, a.started_at, a.finished_at, a.subtotal_cents, a.discount_cents, a.discount_reason, a.total_cents,
       a.customer_id, c.name as customer_name, a.staff_id, s.name as staff_name, ch.name as chair_name,
       r.id as receivable_id, b.registered_cents, b.confirmed_cents,
       case when r.id is null then null when r.status='cancelado' then 'cancelado' when b.registered_cents >= r.amount_due_cents then 'recebido' when b.registered_cents > 0 then 'parcialmente_recebido' else 'pendente' end as pay_status
     from attendances a join customers c on c.id=a.customer_id join staff s on s.id=a.staff_id join chairs ch on ch.id=a.chair_id
     left join receivables r on r.attendance_id=a.id left join receivable_balances b on b.receivable_id=r.id
     where a.id=$1 and a.unit_id=$2`,
    [id, ctx.unitId],
  );
  return { rows };
}
