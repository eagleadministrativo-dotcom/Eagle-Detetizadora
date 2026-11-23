import type { Db, Q } from "../db";
import { audit, can, need, requireText, requireUuid } from "../core";
import { DomainError, ForbiddenError } from "../errors";
import type { Ctx } from "../permissions";
import { addDays, todayYmd, toYmd } from "@/lib/dates";
import { nextReturn, parseRule, ruleLabel, type Rule } from "@/lib/recurrence";
import { emit } from "./events";
import { notifyUsers } from "./notify";

/**
 * Retornos. O prazo conta da data real do último atendimento CONCLUÍDO (nunca da criação de um agendamento).
 * Prioridade: regra do cliente > regra cliente+profissional > padrão da empresa (25 dias, configurável). Só uma regra vale.
 */
interface ReturnSettings { return_default_days: number; return_contact_gap_days: number; return_soon_days: number; return_notify: boolean }
const settings = async (q: Q, unitId: string) => (await q<ReturnSettings>("select return_default_days, return_contact_gap_days, return_soon_days, return_notify from unit_settings where unit_id=$1", [unitId]))[0];

export async function refreshReturn(q: Q, unitId: string, customerId: string) {
  const [last] = await q<{ id: string; staff_id: string; finished_at: Date; preferred_staff_id: string | null }>(
    `select a.id, a.staff_id, a.finished_at, c.preferred_staff_id from attendances a join customers c on c.id=a.customer_id
     where a.customer_id=$1 and a.unit_id=$2 and a.status='concluido' and a.finished_at is not null order by a.finished_at desc limit 1`, [customerId, unitId]);
  if (!last) { await q("delete from customer_return_status where customer_id=$1", [customerId]); return; }
  const staffId = last.preferred_staff_id ?? last.staff_id;
  const rules = await q<{ staff_id: string | null; rule: unknown; no_follow: boolean }>("select staff_id, rule, no_follow from customer_return_rules where customer_id=$1 and (staff_id is null or staff_id=$2)", [customerId, staffId]);
  const own = rules.find((r) => !r.staff_id) ?? rules.find((r) => r.staff_id);
  const st = await settings(q, unitId);
  const visit = toYmd(last.finished_at);
  const rule: Rule | null = own ? (own.no_follow ? null : parseRule(own.rule)) : { kind: "dias", n: st.return_default_days };
  const source = own?.no_follow ? "sem_acompanhamento" : own ? (own.staff_id ? "profissional" : "cliente") : "padrao";
  const due = rule ? nextReturn(rule, visit) : null;
  await q(
    `insert into customer_return_status(customer_id,unit_id,staff_id,last_attendance_id,last_visit,due_date,rule_source,rule_label) values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (customer_id) do update set staff_id=excluded.staff_id, last_visit=excluded.last_visit, due_date=excluded.due_date, rule_source=excluded.rule_source, rule_label=excluded.rule_label, updated_at=now(),
       snoozed_until=case when customer_return_status.last_attendance_id is distinct from excluded.last_attendance_id then null else customer_return_status.snoozed_until end,
       last_contact_at=case when customer_return_status.last_attendance_id is distinct from excluded.last_attendance_id then null else customer_return_status.last_contact_at end,
       last_contact_outcome=case when customer_return_status.last_attendance_id is distinct from excluded.last_attendance_id then null else customer_return_status.last_contact_outcome end,
       last_attendance_id=excluded.last_attendance_id`,
    [customerId, unitId, staffId, last.id, visit, due, source, rule ? ruleLabel(rule) : "Sem acompanhamento"]);
}

export const BUCKETS = { vencido: "Para convidar", proximo: "Próximos do retorno", contatado: "Contatados", agendado: "Com horário marcado", recusou: "Não contatar", sem_acompanhamento: "Sem acompanhamento", em_dia: "Em dia" } as const;
export type Bucket = keyof typeof BUCKETS;
export interface ReturnRow {
  customer_id: string; name: string; phone: string | null; contact_channel: string; last_visit: string; days: number; due_date: string | null; rule_label: string; rule_source: string;
  staff_id: string | null; staff_name: string | null; next_appointment: Date | null; last_contact_at: Date | null; last_contact_outcome: string | null; snoozed_until: string | null; bucket: Bucket; can_contact: boolean;
}

const BUCKET_SQL = `case
  when s.rule_source='sem_acompanhamento' then 'sem_acompanhamento'
  when c.contact_opt_out or c.contact_channel='nenhum' then 'recusou'
  when ap.starts_at is not null then 'agendado'
  when s.last_contact_outcome='recusou' then 'recusou'
  when s.snoozed_until > $2::date then 'contatado'
  when s.last_contact_at > now() - make_interval(days => st.return_contact_gap_days) then 'contatado'
  when s.due_date <= $2::date then 'vencido'
  when s.due_date <= $2::date + st.return_soon_days then 'proximo'
  else 'em_dia' end`;
const FROM = `from customer_return_status s join customers c on c.id=s.customer_id and c.is_active join unit_settings st on st.unit_id=s.unit_id left join staff f on f.id=s.staff_id
  left join lateral (select a.starts_at from appointments a where a.customer_id=s.customer_id and a.status in ('agendado','em_atendimento') and a.ends_at > now() order by a.starts_at limit 1) ap on true`;

function scope(ctx: Ctx, staffId?: string | null) {
  if (can(ctx, "returns.view_all")) return staffId ?? null;
  need(ctx, "returns.own");
  return ctx.staffId ?? "00000000-0000-0000-0000-000000000000";
}

export async function listReturns(db: Db, ctx: Ctx, o: { bucket?: Bucket; search?: string | null; staffId?: string | null; limit?: number; offset?: number } = {}) {
  const sid = scope(ctx, o.staffId);
  const rows = await db.query<ReturnRow & { total: number }>(
    `select *, count(*) over()::bigint as total from (select s.customer_id, c.name, c.phone, c.contact_channel, to_char(s.last_visit,'YYYY-MM-DD') as last_visit, ($2::date - s.last_visit)::int as days, to_char(s.due_date,'YYYY-MM-DD') as due_date, s.rule_label, s.rule_source,
        s.staff_id, f.name as staff_name, ap.starts_at as next_appointment, s.last_contact_at, s.last_contact_outcome, to_char(s.snoozed_until,'YYYY-MM-DD') as snoozed_until, ${BUCKET_SQL} as bucket,
        (not c.contact_opt_out and c.contact_channel <> 'nenhum') as can_contact
      ${FROM} where s.unit_id=$1 and ($3::uuid is null or s.staff_id=$3) and ($4::text is null or lower(c.name || ' ' || coalesce(c.phone,'')) like $4)) x
     where ($5::text is null or bucket=$5) order by due_date nulls last, name limit $6 offset $7`,
    [ctx.unitId, todayYmd(), sid, o.search ? `%${o.search.toLowerCase()}%` : null, o.bucket ?? null, o.limit ?? 50, o.offset ?? 0]);
  return { rows, total: rows[0]?.total ?? 0 };
}
export async function returnCounts(db: Db, ctx: Ctx, staffId?: string | null): Promise<Record<string, number>> {
  const rows = await db.query<{ bucket: string; n: number }>(`select bucket, count(*)::bigint as n from (select ${BUCKET_SQL} as bucket ${FROM} where s.unit_id=$1 and ($3::uuid is null or s.staff_id=$3)) x group by bucket`, [ctx.unitId, todayYmd(), scope(ctx, staffId)]);
  return Object.fromEntries(rows.map((r) => [r.bucket, r.n]));
}

async function assertCustomer(q: Q, ctx: Ctx, customerId: string) {
  const [s] = await q<{ staff_id: string | null; opt_out: boolean; channel: string; last_contact_at: Date | null; snoozed_until: string | null; gap: number }>(
    `select s.staff_id, c.contact_opt_out as opt_out, c.contact_channel as channel, s.last_contact_at, to_char(s.snoozed_until,'YYYY-MM-DD') as snoozed_until, st.return_contact_gap_days as gap from customer_return_status s join customers c on c.id=s.customer_id join unit_settings st on st.unit_id=s.unit_id where s.customer_id=$1 and s.unit_id=$2 for update of s`, [requireUuid(customerId, "Cliente"), ctx.unitId]);
  if (!s) throw new DomainError("not_found", "Cliente sem atendimento concluído.");
  if (!can(ctx, "returns.view_all") && s.staff_id !== ctx.staffId) throw new ForbiddenError("Este retorno é de outro profissional.");
  return s;
}

/** Registra um contato feito, sempre por ação explícita de quem contatou. Abrir o WhatsApp não registra nada. */
export async function registerContact(db: Db, ctx: Ctx, i: { customerId: string; outcome: "contatado" | "sem_resposta" | "recusou" | "agendou"; note?: string | null; optOut?: boolean; idempotencyKey: string }) {
  need(ctx, "returns.contact");
  const key = requireText(i.idempotencyKey, "Chave de idempotência", 8);
  if (!["contatado", "sem_resposta", "recusou", "agendou"].includes(i.outcome)) throw new DomainError("invalid", "Resultado inválido.");
  await db.tx(async (q) => {
    const [dup] = await q("select 1 from customer_contact_attempts where idempotency_key=$1", [key]);
    if (dup) return;
    const s = await assertCustomer(q, ctx, i.customerId);
    if (s.opt_out || s.channel === "nenhum") throw new DomainError("opt_out", "Este cliente pediu para não receber contato.");
    if (s.last_contact_at && s.last_contact_at.getTime() > Date.now() - s.gap * 86400000 && i.outcome !== "recusou" && i.outcome !== "agendou") throw new DomainError("too_soon", `Este cliente já foi contatado há menos de ${s.gap} dia(s).`);
    await q("insert into customer_contact_attempts(unit_id,customer_id,user_id,channel,outcome,note,idempotency_key) values ($1,$2,$3,$4,$5,$6,$7)", [ctx.unitId, i.customerId, ctx.userId, s.channel, i.outcome, i.note ?? null, key]);
    await q("update customer_return_status set last_contact_at=now(), last_contact_outcome=$2, updated_at=now() where customer_id=$1", [i.customerId, i.outcome]);
    if (i.optOut) await q("update customers set contact_opt_out=true, contact_opt_out_at=now(), updated_at=now(), updated_by=$2 where id=$1", [i.customerId, ctx.userId]);
    await audit(q, ctx, "RETORNO_CONTATO", "customer", i.customerId, null, { outcome: i.outcome, optOut: i.optOut ?? false });
    await emit(q, ctx, "return.contacted", "customer", i.customerId, { outcome: i.outcome }, `return.contacted:${key}`);
  });
}

export async function snoozeReturn(db: Db, ctx: Ctx, customerId: string, until: string) {
  need(ctx, "returns.contact");
  const today = todayYmd();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until <= today || until > addDays(today, 365)) throw new DomainError("invalid", "Escolha uma data futura (até 1 ano).");
  await db.tx(async (q) => {
    await assertCustomer(q, ctx, customerId);
    await q("update customer_return_status set snoozed_until=$2, updated_at=now() where customer_id=$1", [customerId, until]);
    await audit(q, ctx, "RETORNO_ADIADO", "customer", customerId, null, { until });
  });
}

export async function saveReturnRule(db: Db, ctx: Ctx, i: { customerId: string; staffId?: string | null; rule: Rule | null; noFollow?: boolean; clear?: boolean }) {
  need(ctx, "returns.rules", "returns.contact");
  await db.tx(async (q) => {
    const [c] = await q("select 1 from customers where id=$1 and unit_id=$2 for update", [requireUuid(i.customerId, "Cliente"), ctx.unitId]);
    if (!c) throw new DomainError("not_found", "Cliente não encontrado.");
    if (!can(ctx, "returns.rules")) await assertCustomer(q, ctx, i.customerId); // o barbeiro só ajusta clientes que são seus
    const before = await q("select staff_id, rule, no_follow from customer_return_rules where customer_id=$1", [i.customerId]);
    await q("delete from customer_return_rules where customer_id=$1 and staff_id is not distinct from $2::uuid", [i.customerId, i.staffId ?? null]);
    if (!i.clear) {
      const rule = i.noFollow ? null : parseRule(i.rule);
      if (!i.noFollow && !rule) throw new DomainError("invalid", "Frequência inválida.");
      await q("insert into customer_return_rules(unit_id,customer_id,staff_id,rule,no_follow,updated_by) values ($1,$2,$3,$4,$5,$6)", [ctx.unitId, i.customerId, i.staffId ?? null, rule ? JSON.stringify(rule) : null, i.noFollow ?? false, ctx.userId]);
    }
    await audit(q, ctx, "RETORNO_REGRA", "customer", i.customerId, before, i);
    await refreshReturn(q, ctx.unitId, i.customerId);
  });
}

export async function saveContactPrefs(db: Db, ctx: Ctx, i: { customerId: string; optOut: boolean; channel: string; preferredStaffId?: string | null }) {
  need(ctx, "customers.manage");
  if (!["whatsapp", "telefone", "email", "nenhum"].includes(i.channel)) throw new DomainError("invalid", "Canal inválido.");
  await db.tx(async (q) => {
    const [c] = await q<{ contact_opt_out: boolean; contact_channel: string }>("select contact_opt_out, contact_channel, preferred_staff_id from customers where id=$1 and unit_id=$2 for update", [requireUuid(i.customerId, "Cliente"), ctx.unitId]);
    if (!c) throw new DomainError("not_found", "Cliente não encontrado.");
    if (i.preferredStaffId) { const [s] = await q("select 1 from staff where id=$1 and unit_id=$2", [requireUuid(i.preferredStaffId, "Profissional"), ctx.unitId]); if (!s) throw new DomainError("not_found", "Profissional não encontrado."); }
    await q("update customers set contact_opt_out=$2, contact_opt_out_at=case when $2 then coalesce(contact_opt_out_at, now()) end, contact_channel=$3, preferred_staff_id=$4, updated_at=now(), updated_by=$5 where id=$1", [i.customerId, i.optOut, i.channel, i.preferredStaffId ?? null, ctx.userId]);
    await audit(q, ctx, "CLIENTE_PREFERENCIA_CONTATO", "customer", i.customerId, c, i);
    await refreshReturn(q, ctx.unitId, i.customerId);
  });
}

export async function returnDetails(db: Db, ctx: Ctx, customerId: string) {
  const rules = await db.query<{ staff_id: string | null; staff_name: string | null; rule: Rule | null; no_follow: boolean }>("select r.staff_id, s.name as staff_name, r.rule, r.no_follow from customer_return_rules r left join staff s on s.id=r.staff_id where r.customer_id=$1 and r.unit_id=$2", [customerId, ctx.unitId]);
  const contacts = await db.query<{ id: string; outcome: string; channel: string; note: string | null; created_at: Date; user_name: string }>("select a.id, a.outcome, a.channel, a.note, a.created_at, u.full_name as user_name from customer_contact_attempts a join users u on u.id=a.user_id where a.customer_id=$1 and a.unit_id=$2 order by a.created_at desc limit 20", [customerId, ctx.unitId]);
  const [prefs] = await db.query<{ contact_opt_out: boolean; contact_channel: string; preferred_staff_id: string | null }>("select contact_opt_out, contact_channel, preferred_staff_id from customers where id=$1 and unit_id=$2", [customerId, ctx.unitId]);
  const [status] = await db.query<{ due_date: string | null; rule_label: string; rule_source: string }>("select to_char(due_date,'YYYY-MM-DD') as due_date, rule_label, rule_source from customer_return_status where customer_id=$1 and unit_id=$2", [customerId, ctx.unitId]);
  return { rules, contacts, prefs, status };
}

export async function saveReturnSettings(db: Db, ctx: Ctx, i: { defaultDays: number; gapDays: number; soonDays: number; notify: boolean }) {
  need(ctx, "admin.settings");
  const ok = (v: number, a: number, b: number) => Number.isInteger(v) && v >= a && v <= b;
  if (!ok(i.defaultDays, 1, 365) || !ok(i.gapDays, 1, 365) || !ok(i.soonDays, 0, 60)) throw new DomainError("invalid", "Prazos inválidos.");
  await db.tx(async (q) => {
    const before = await settings(q, ctx.unitId);
    await q("update unit_settings set return_default_days=$2, return_contact_gap_days=$3, return_soon_days=$4, return_notify=$5, updated_at=now(), updated_by=$6 where unit_id=$1", [ctx.unitId, i.defaultDays, i.gapDays, i.soonDays, i.notify, ctx.userId]);
    await audit(q, ctx, "RETORNO_POLITICA", "unit_settings", ctx.unitId, before, i);
    if (before.return_default_days !== i.defaultDays) {
      for (const c of await q<{ customer_id: string }>("select customer_id from customer_return_status where unit_id=$1 and rule_source='padrao'", [ctx.unitId])) await refreshReturn(q, ctx.unitId, c.customer_id);
    }
  });
}

/** Rotina diária: completa quem falta, registra os vencidos e avisa cada profissional uma vez por dia. */
export async function runReturnJobs(db: Db, unitId: string, today = todayYmd()) {
  const missing = await db.query<{ id: string }>("select c.id from customers c where c.unit_id=$1 and exists (select 1 from attendances a where a.customer_id=c.id and a.status='concluido') and not exists (select 1 from customer_return_status s where s.customer_id=c.id) limit 2000", [unitId]);
  for (const c of missing) await db.tx((q) => refreshReturn(q, unitId, c.id));
  const due = await db.query<{ customer_id: string; staff_id: string | null; user_id: string | null; due_date: string; fresh: boolean }>(
    `select * from (select s.customer_id, s.staff_id, f.user_id, to_char(s.due_date,'YYYY-MM-DD') as due_date, (s.notified_due is distinct from s.due_date) as fresh, ${BUCKET_SQL} as bucket ${FROM} where s.unit_id=$1) x where bucket='vencido'`, [unitId, today]);
  const st = await settings(db.query, unitId);
  const fresh = due.filter((d) => d.fresh);
  await db.tx(async (q) => {
    for (const d of fresh) {
      await emit(q, { unitId }, "return.due", "customer", d.customer_id, { due: d.due_date }, `return.due:${d.customer_id}:${d.due_date}`);
      await q("update customer_return_status set notified_due=due_date where customer_id=$1", [d.customer_id]);
    }
    if (!st.return_notify) return;
    const per = new Map<string, number>();
    for (const d of fresh) if (d.user_id) per.set(d.user_id, (per.get(d.user_id) ?? 0) + 1);
    for (const [u, n] of per) await notifyUsers(q, { unitId, userIds: [u], kind: "retorno_vencido", message: n === 1 ? "1 cliente está na hora de voltar." : `${n} clientes estão na hora de voltar.`, url: "/retornos", dedupe: `return.day:${today}` });
  });
  return { backfilled: missing.length, due: due.length, notified: fresh.length };
}
