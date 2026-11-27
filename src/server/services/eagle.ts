import type { Db, Q } from "../db";
import { audit, can, need, requireText, requireUuid } from "../core";
import { DomainError, ForbiddenError } from "../errors";
import type { Ctx } from "../permissions";
import { addDays, todayYmd } from "@/lib/dates";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ymdOrThrow = (v: string | null | undefined, label: string) => {
  if (!v || !YMD.test(v)) throw new DomainError("invalid", `${label} inválida.`);
  return v;
};

// ───────── Retornos (Garantia, Manutenção, Outros) ─────────
export type ReturnKind = "garantia" | "manutencao" | "outro";
export type ReturnStatus = "pendente" | "agendado" | "concluido" | "cancelado";
export const RETURN_KIND_LABEL: Record<ReturnKind, string> = { garantia: "Garantia", manutencao: "Manutenção", outro: "Outro" };
export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = { pendente: "Pendente", agendado: "Agendado", concluido: "Concluído", cancelado: "Cancelado" };
const RETURN_KINDS = Object.keys(RETURN_KIND_LABEL) as ReturnKind[];
const RETURN_STATUSES = Object.keys(RETURN_STATUS_LABEL) as ReturnStatus[];

export interface ReturnRow {
  id: string; customer_id: string; customer_name: string; customer_phone: string | null; customer_address: string | null;
  staff_id: string | null; staff_name: string | null; kind: ReturnKind; due_date: string; status: ReturnStatus;
  appointment_id: string | null; origin_appointment_id: string | null; service_order_id: string | null; service_order_number: number | null;
  notes: string | null; created_at: Date; updated_at: Date;
}

const seesAllReturns = (ctx: Ctx) => can(ctx, "returns.view_all") || can(ctx, "returns.manage");
function needReturns(ctx: Ctx) {
  if (!seesAllReturns(ctx) && !can(ctx, "returns.own")) throw new ForbiddenError();
}

const RETURN_SELECT = `
  select r.id, r.customer_id, c.name as customer_name, c.phone as customer_phone, c.address as customer_address,
         r.staff_id, st.name as staff_name, r.kind, to_char(r.due_date,'YYYY-MM-DD') as due_date, r.status,
         r.appointment_id, r.origin_appointment_id, so.id as service_order_id, so.number as service_order_number,
         r.notes, r.created_at, r.updated_at
  from service_returns r
  join customers c on c.id = r.customer_id
  left join staff st on st.id = r.staff_id
  left join service_orders so on so.appointment_id = r.origin_appointment_id`;

export async function listReturns(db: Db, ctx: Ctx, opts: { status?: string; limit?: number; offset?: number } = {}) {
  needReturns(ctx);
  const status = opts.status === "abertos" || !opts.status ? null : RETURN_STATUSES.includes(opts.status as ReturnStatus) ? opts.status : null;
  const open = !opts.status || opts.status === "abertos";
  const rows = await db.query<ReturnRow & { total: number }>(
    `${RETURN_SELECT}
     where r.unit_id = $1
       and ($2::text is null or r.status = $2)
       and (not $3 or r.status in ('pendente','agendado'))
       and ($4::uuid is null or r.staff_id = $4)
     order by case when r.status in ('pendente','agendado') then 0 else 1 end, r.due_date asc, r.created_at desc
     limit $5 offset $6`.replace("select r.id", "select count(*) over() as total, r.id"),
    [ctx.unitId, status, open, seesAllReturns(ctx) ? null : ctx.staffId ?? "00000000-0000-0000-0000-000000000000", opts.limit ?? 50, opts.offset ?? 0],
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

export async function getReturn(db: Db, ctx: Ctx, id: string): Promise<ReturnRow | null> {
  needReturns(ctx);
  const [r] = await db.query<ReturnRow>(`${RETURN_SELECT} where r.id = $1 and r.unit_id = $2`, [requireUuid(id, "Retorno"), ctx.unitId]);
  if (!r) return null;
  if (!seesAllReturns(ctx) && r.staff_id !== ctx.staffId) throw new ForbiddenError();
  return r;
}

export interface SaveReturnInput { customerId: string; kind: string; dueDate: string; staffId?: string | null; notes?: string | null; originAppointmentId?: string | null }

async function insertReturn(q: Q, ctx: Ctx, i: SaveReturnInput): Promise<string> {
  const kind = RETURN_KINDS.includes(i.kind as ReturnKind) ? (i.kind as ReturnKind) : "outro";
  const dueDate = ymdOrThrow(i.dueDate, "Data do retorno");
  const [c] = await q("select 1 from customers where id=$1 and unit_id=$2", [requireUuid(i.customerId, "Cliente"), ctx.unitId]);
  if (!c) throw new DomainError("not_found", "Cliente não encontrado.");
  if (i.staffId) {
    const [s] = await q("select 1 from staff where id=$1 and unit_id=$2", [requireUuid(i.staffId, "Técnico"), ctx.unitId]);
    if (!s) throw new DomainError("not_found", "Técnico não encontrado.");
  }
  if (i.originAppointmentId) {
    const [dup] = await q("select 1 from service_returns where origin_appointment_id=$1 and kind=$2 and status<>'cancelado'", [requireUuid(i.originAppointmentId, "Agendamento"), kind]);
    if (dup) throw new DomainError("conflict", "Já existe um retorno deste tipo para este serviço.");
  }
  const [r] = await q<{ id: string }>(
    "insert into service_returns(unit_id,customer_id,origin_appointment_id,staff_id,kind,due_date,notes,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
    [ctx.unitId, i.customerId, i.originAppointmentId || null, i.staffId || null, kind, dueDate, i.notes?.trim() || null, ctx.userId],
  );
  await audit(q, ctx, "RETORNO_CRIADO", "service_return", r.id, null, { kind, dueDate });
  return r.id;
}

export async function saveReturn(db: Db, ctx: Ctx, input: SaveReturnInput): Promise<string> {
  need(ctx, "returns.manage");
  return db.tx((q) => insertReturn(q, ctx, input));
}

export async function updateReturn(db: Db, ctx: Ctx, id: string, patch: { status?: string; dueDate?: string; staffId?: string | null; notes?: string | null; appointmentId?: string | null }) {
  await db.tx(async (q) => {
    const [r] = await q<{ status: ReturnStatus; staff_id: string | null; due_date: string }>(
      "select status, staff_id, to_char(due_date,'YYYY-MM-DD') as due_date from service_returns where id=$1 and unit_id=$2 for update", [requireUuid(id, "Retorno"), ctx.unitId]);
    if (!r) throw new DomainError("not_found", "Retorno não encontrado.");
    const manager = can(ctx, "returns.manage");
    if (!manager && !(can(ctx, "returns.contact") && r.staff_id && r.staff_id === ctx.staffId)) throw new ForbiddenError();
    if (!manager && (patch.staffId !== undefined || patch.dueDate !== undefined)) throw new ForbiddenError("Só quem gerencia os retornos muda data e técnico.");
    if (patch.status && !RETURN_STATUSES.includes(patch.status as ReturnStatus)) throw new DomainError("invalid", "Situação inválida.");
    if (patch.staffId) {
      const [s] = await q("select 1 from staff where id=$1 and unit_id=$2", [requireUuid(patch.staffId, "Técnico"), ctx.unitId]);
      if (!s) throw new DomainError("not_found", "Técnico não encontrado.");
    }
    if (patch.appointmentId) {
      const [a] = await q("select 1 from appointments where id=$1 and unit_id=$2", [requireUuid(patch.appointmentId, "Agendamento"), ctx.unitId]);
      if (!a) throw new DomainError("not_found", "Agendamento não encontrado.");
    }
    await q(
      `update service_returns set status=coalesce($2,status), due_date=coalesce($3::date,due_date),
         staff_id=case when $4 then $5::uuid else staff_id end, notes=case when $6 then $7 else notes end,
         appointment_id=coalesce($8::uuid, appointment_id), updated_at=now() where id=$1`,
      [id, patch.status ?? null, patch.dueDate ? ymdOrThrow(patch.dueDate, "Data do retorno") : null,
        patch.staffId !== undefined, patch.staffId || null, patch.notes !== undefined, patch.notes?.trim() || null, patch.appointmentId || null],
    );
    await audit(q, ctx, "RETORNO_ALTERADO", "service_return", id, { status: r.status, staff_id: r.staff_id, due_date: r.due_date }, patch);
  });
}

// ───────── Orçamentos ─────────
export type QuoteStatus = "rascunho" | "enviado" | "aprovado" | "recusado";
export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = { rascunho: "Rascunho", enviado: "Enviado", aprovado: "Aprovado", recusado: "Recusado" };
const QUOTE_STATUSES = Object.keys(QUOTE_STATUS_LABEL) as QuoteStatus[];

export interface QuoteRow {
  id: string; number: number; customer_id: string; customer_name: string; customer_phone: string | null; customer_email: string | null;
  service_address: string | null; issue_date: string; valid_until: string | null; status: QuoteStatus; discount_cents: number;
  payment_terms: string | null; conditions: string | null; notes: string | null; appointment_id: string | null;
  items_cents: number; total_cents: number; created_by_name: string | null;
}
export interface QuoteItemRow { id: string; service_id: string | null; description: string; quantity: number; unit_price_cents: number; total_cents: number }

const QUOTE_SELECT = `
  select q.id, q.number, q.customer_id, c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
         coalesce(q.service_address, c.address) as service_address, to_char(q.issue_date,'YYYY-MM-DD') as issue_date,
         to_char(q.valid_until,'YYYY-MM-DD') as valid_until, q.status, q.discount_cents, q.payment_terms, q.conditions, q.notes, q.appointment_id,
         coalesce(t.items, 0)::bigint as items_cents, greatest(coalesce(t.items, 0) - q.discount_cents, 0)::bigint as total_cents, u.full_name as created_by_name
  from quotes q
  join customers c on c.id = q.customer_id
  left join users u on u.id = q.created_by
  left join lateral (select round(sum(i.quantity * i.unit_price_cents)) as items from quote_items i where i.quote_id = q.id) t on true`;

const needQuotesView = (ctx: Ctx) => need(ctx, "quotes.view", "quotes.manage");

export async function listQuotes(db: Db, ctx: Ctx, opts: { status?: string; limit?: number; offset?: number } = {}) {
  needQuotesView(ctx);
  const status = QUOTE_STATUSES.includes(opts.status as QuoteStatus) ? opts.status : null;
  const rows = await db.query<QuoteRow & { total: number }>(
    `${QUOTE_SELECT} where q.unit_id = $1 and ($2::text is null or q.status = $2) order by q.number desc limit $3 offset $4`.replace("select q.id", "select count(*) over() as total, q.id"),
    [ctx.unitId, status, opts.limit ?? 50, opts.offset ?? 0],
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

export async function getQuote(db: Db, ctx: Ctx, id: string): Promise<{ quote: QuoteRow; items: QuoteItemRow[] } | null> {
  needQuotesView(ctx);
  const [quote] = await db.query<QuoteRow>(`${QUOTE_SELECT} where q.id = $1 and q.unit_id = $2`, [requireUuid(id, "Orçamento"), ctx.unitId]);
  if (!quote) return null;
  const items = await db.query<QuoteItemRow>(
    "select id, service_id, description, quantity::float as quantity, unit_price_cents, round(quantity * unit_price_cents)::bigint as total_cents from quote_items where quote_id=$1 order by sort_order",
    [id],
  );
  return { quote, items };
}

export interface SaveQuoteInput {
  id?: string | null; customerId: string; serviceAddress?: string | null; validUntil?: string | null; discountCents?: number;
  paymentTerms?: string | null; conditions?: string | null; notes?: string | null;
  items: { serviceId?: string | null; description?: string | null; quantity?: number | null; unitPriceCents?: number | null }[];
}

export async function saveQuote(db: Db, ctx: Ctx, input: SaveQuoteInput): Promise<string> {
  need(ctx, "quotes.manage");
  const discount = Math.max(0, Math.round(input.discountCents ?? 0));
  if (input.validUntil) ymdOrThrow(input.validUntil, "Validade");
  return db.tx(async (q) => {
    const [c] = await q("select 1 from customers where id=$1 and unit_id=$2", [requireUuid(input.customerId, "Cliente"), ctx.unitId]);
    if (!c) throw new DomainError("not_found", "Cliente não encontrado.");
    // item com serviço escolhido e sem descrição/preço usa o nome e o preço atual do serviço
    const items: { serviceId: string | null; description: string; quantity: number; unitPriceCents: number }[] = [];
    for (const it of input.items) {
      const desc = it.description?.trim() ?? "";
      if (!it.serviceId && !desc) continue;
      let description = desc;
      let price = it.unitPriceCents ?? null;
      if (it.serviceId) {
        const [s] = await q<{ name: string; price_cents: number | null }>(
          `select s.name, (select p.price_cents from service_prices p where p.service_id=s.id and p.staff_id is null and p.valid_from <= now() order by p.valid_from desc limit 1) as price_cents
           from services s where s.id=$1 and s.unit_id=$2`, [requireUuid(it.serviceId, "Serviço"), ctx.unitId]);
        if (!s) throw new DomainError("not_found", "Serviço não encontrado.");
        description ||= s.name;
        price ??= s.price_cents;
      }
      const quantity = it.quantity && it.quantity > 0 ? it.quantity : 1;
      if (price == null || price < 0) throw new DomainError("invalid", `Informe o valor de "${description}".`);
      items.push({ serviceId: it.serviceId || null, description: requireText(description, "Descrição do item"), quantity, unitPriceCents: price });
    }
    if (!items.length) throw new DomainError("invalid", "O orçamento precisa de pelo menos um item.");

    let id = input.id || null;
    if (id) {
      const [cur] = await q<{ status: QuoteStatus }>("select status from quotes where id=$1 and unit_id=$2 for update", [requireUuid(id, "Orçamento"), ctx.unitId]);
      if (!cur) throw new DomainError("not_found", "Orçamento não encontrado.");
      if (cur.status === "aprovado" || cur.status === "recusado") throw new DomainError("locked", "Orçamento aprovado ou recusado não pode ser editado. Volte para rascunho antes.");
      await q("update quotes set customer_id=$2, service_address=$3, valid_until=$4, discount_cents=$5, payment_terms=$6, conditions=$7, notes=$8, updated_at=now() where id=$1",
        [id, input.customerId, input.serviceAddress?.trim() || null, input.validUntil || null, discount, input.paymentTerms?.trim() || null, input.conditions?.trim() || null, input.notes?.trim() || null]);
      await q("delete from quote_items where quote_id=$1", [id]);
    } else {
      // número sequencial por unidade, sem corrida entre dois orçamentos simultâneos
      await q("select pg_advisory_xact_lock(hashtext('quotes:' || $1::text))", [ctx.unitId]);
      const [n] = await q<{ n: number }>("select coalesce(max(number), 0) + 1 as n from quotes where unit_id=$1", [ctx.unitId]);
      const [r] = await q<{ id: string }>(
        "insert into quotes(unit_id,number,customer_id,service_address,valid_until,discount_cents,payment_terms,conditions,notes,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",
        [ctx.unitId, n.n, input.customerId, input.serviceAddress?.trim() || null, input.validUntil || null, discount, input.paymentTerms?.trim() || null, input.conditions?.trim() || null, input.notes?.trim() || null, ctx.userId]);
      id = r.id;
    }
    for (const [i, it] of items.entries()) {
      await q("insert into quote_items(quote_id,service_id,description,quantity,unit_price_cents,sort_order) values ($1,$2,$3,$4,$5,$6)",
        [id, it.serviceId, it.description, it.quantity, it.unitPriceCents, i]);
    }
    await audit(q, ctx, input.id ? "ORCAMENTO_EDITADO" : "ORCAMENTO_CRIADO", "quote", id, null, { itens: items.length, desconto: discount });
    return id!;
  });
}

export async function setQuoteStatus(db: Db, ctx: Ctx, id: string, status: string) {
  need(ctx, "quotes.manage");
  if (!QUOTE_STATUSES.includes(status as QuoteStatus)) throw new DomainError("invalid", "Situação inválida.");
  await db.tx(async (q) => {
    const [cur] = await q<{ status: QuoteStatus }>("select status from quotes where id=$1 and unit_id=$2 for update", [requireUuid(id, "Orçamento"), ctx.unitId]);
    if (!cur) throw new DomainError("not_found", "Orçamento não encontrado.");
    if (cur.status === status) return;
    await q("update quotes set status=$2, updated_at=now() where id=$1", [id, status]);
    await audit(q, ctx, "ORCAMENTO_SITUACAO", "quote", id, { status: cur.status }, { status });
  });
}

// ───────── Ordens de Serviço ─────────
export type OSStatus = "aberta" | "executada" | "cancelada";
export type OSPayment = "pendente" | "pago" | "parcial";
export const OS_STATUS_LABEL: Record<OSStatus, string> = { aberta: "Aberta", executada: "Executada", cancelada: "Cancelada" };
export const OS_PAYMENT_LABEL: Record<OSPayment, string> = { pendente: "Pendente", pago: "Pago", parcial: "Parcial" };

export interface ServiceOrderRow {
  id: string; number: number; appointment_id: string; quote_id: string | null; quote_number: number | null; status: OSStatus;
  pests: string | null; products_used: string | null; areas: string | null; payment_method: string | null; payment_status: OSPayment;
  notes: string | null; customer_confirmed: boolean; technician_confirmed: boolean; warranty_days: number | null;
  customer_id: string; customer_name: string; customer_phone: string | null; service_address: string | null;
  staff_id: string; staff_name: string; starts_at: Date; services: string; total_cents: number; created_at: Date; updated_at: Date;
}

const OS_SELECT = `
  select so.id, so.number, so.appointment_id, so.quote_id, qt.number as quote_number, so.status, so.pests, so.products_used, so.areas,
         so.payment_method, so.payment_status, so.notes, so.customer_confirmed, so.technician_confirmed, so.warranty_days,
         a.customer_id, c.name as customer_name, c.phone as customer_phone, coalesce(a.service_address, c.address) as service_address,
         a.staff_id, st.name as staff_name, a.starts_at,
         coalesce((select string_agg(ai.name_snapshot, ' + ') from appointment_services ai where ai.appointment_id=a.id), '') as services,
         coalesce((select sum(ai.price_cents) from appointment_services ai where ai.appointment_id=a.id), 0)::bigint as total_cents,
         so.created_at, so.updated_at
  from service_orders so
  join appointments a on a.id = so.appointment_id
  join customers c on c.id = a.customer_id
  join staff st on st.id = a.staff_id
  left join quotes qt on qt.id = so.quote_id`;

const seesAllOrders = (ctx: Ctx) => can(ctx, "agenda.manage") || can(ctx, "agenda.view_all");
function needOrders(ctx: Ctx) {
  if (!seesAllOrders(ctx) && !(can(ctx, "agenda.manage_own") || can(ctx, "agenda.view_own"))) throw new ForbiddenError();
}
const canEditOrder = (ctx: Ctx, staffId: string) => can(ctx, "agenda.manage") || (can(ctx, "agenda.manage_own") && ctx.staffId === staffId);

export async function listServiceOrders(db: Db, ctx: Ctx, opts: { status?: string; limit?: number; offset?: number } = {}) {
  needOrders(ctx);
  const status = (Object.keys(OS_STATUS_LABEL) as string[]).includes(opts.status ?? "") ? opts.status : null;
  const rows = await db.query<ServiceOrderRow & { total: number }>(
    `${OS_SELECT} where so.unit_id = $1 and ($2::text is null or so.status = $2) and ($3::uuid is null or a.staff_id = $3)
     order by case so.status when 'aberta' then 0 else 1 end, a.starts_at desc limit $4 offset $5`.replace("select so.id", "select count(*) over() as total, so.id"),
    [ctx.unitId, status, seesAllOrders(ctx) ? null : ctx.staffId ?? "00000000-0000-0000-0000-000000000000", opts.limit ?? 50, opts.offset ?? 0],
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

export async function getServiceOrder(db: Db, ctx: Ctx, id: string): Promise<ServiceOrderRow | null> {
  needOrders(ctx);
  const [r] = await db.query<ServiceOrderRow>(`${OS_SELECT} where so.id = $1 and so.unit_id = $2`, [requireUuid(id, "Ordem de serviço"), ctx.unitId]);
  if (!r) return null;
  if (!seesAllOrders(ctx) && r.staff_id !== ctx.staffId) throw new ForbiddenError();
  return r;
}

export async function orderOfAppointment(db: Db, unitId: string, appointmentId: string): Promise<{ id: string; number: number; status: OSStatus } | null> {
  const [r] = await db.query<{ id: string; number: number; status: OSStatus }>("select id, number, status from service_orders where appointment_id=$1 and unit_id=$2", [appointmentId, unitId]);
  return r ?? null;
}

/** Abre a OS do agendamento (uma por agendamento). A garantia sugerida é a maior entre os serviços agendados. */
export async function createServiceOrder(db: Db, ctx: Ctx, appointmentId: string, opts: { quoteId?: string | null } = {}): Promise<string> {
  return db.tx(async (q) => {
    const [a] = await q<{ staff_id: string; status: string }>("select staff_id, status from appointments where id=$1 and unit_id=$2 for update", [requireUuid(appointmentId, "Agendamento"), ctx.unitId]);
    if (!a) throw new DomainError("not_found", "Agendamento não encontrado.");
    if (!canEditOrder(ctx, a.staff_id)) throw new ForbiddenError();
    if (a.status === "cancelado") throw new DomainError("invalid", "Agendamento cancelado não gera ordem de serviço.");
    const [existing] = await q<{ id: string }>("select id from service_orders where appointment_id=$1", [appointmentId]);
    if (existing) return existing.id;
    if (opts.quoteId) {
      const [qt] = await q("select 1 from quotes where id=$1 and unit_id=$2", [requireUuid(opts.quoteId, "Orçamento"), ctx.unitId]);
      if (!qt) throw new DomainError("not_found", "Orçamento não encontrado.");
    }
    const [w] = await q<{ days: number | null }>(
      "select max(s.warranty_days) as days from appointment_services ai join services s on s.id = ai.service_id where ai.appointment_id=$1", [appointmentId]);
    await q("select pg_advisory_xact_lock(hashtext('service_orders:' || $1::text))", [ctx.unitId]);
    const [n] = await q<{ n: number }>("select coalesce(max(number), 0) + 1 as n from service_orders where unit_id=$1", [ctx.unitId]);
    const [r] = await q<{ id: string }>(
      "insert into service_orders(unit_id,number,appointment_id,quote_id,warranty_days,created_by) values ($1,$2,$3,$4,$5,$6) returning id",
      [ctx.unitId, n.n, appointmentId, opts.quoteId || null, w?.days || null, ctx.userId]);
    await audit(q, ctx, "OS_CRIADA", "service_order", r.id, null, { agendamento: appointmentId, numero: n.n });
    return r.id;
  });
}

export interface UpdateOrderInput {
  pests?: string | null; productsUsed?: string | null; areas?: string | null; paymentMethod?: string | null; paymentStatus?: string;
  notes?: string | null; customerConfirmed?: boolean; technicianConfirmed?: boolean; warrantyDays?: number | null;
}

export async function updateServiceOrder(db: Db, ctx: Ctx, id: string, i: UpdateOrderInput) {
  if (i.paymentStatus && !(Object.keys(OS_PAYMENT_LABEL) as string[]).includes(i.paymentStatus)) throw new DomainError("invalid", "Situação do pagamento inválida.");
  if (i.warrantyDays != null && (!Number.isInteger(i.warrantyDays) || i.warrantyDays < 0 || i.warrantyDays > 1095)) throw new DomainError("invalid", "Garantia deve ficar entre 0 e 1095 dias.");
  await db.tx(async (q) => {
    const [o] = await q<{ status: OSStatus; staff_id: string }>(
      "select so.status, a.staff_id from service_orders so join appointments a on a.id=so.appointment_id where so.id=$1 and so.unit_id=$2 for update of so", [requireUuid(id, "Ordem de serviço"), ctx.unitId]);
    if (!o) throw new DomainError("not_found", "Ordem de serviço não encontrada.");
    if (!canEditOrder(ctx, o.staff_id)) throw new ForbiddenError();
    if (o.status !== "aberta") throw new DomainError("locked", "Só a OS aberta pode ser alterada.");
    const t = (v: string | null | undefined) => v?.trim() || null;
    await q(
      `update service_orders set pests=$2, products_used=$3, areas=$4, payment_method=$5, payment_status=coalesce($6, payment_status), notes=$7,
         customer_confirmed=$8, technician_confirmed=$9, warranty_days=$10, updated_at=now() where id=$1`,
      [id, t(i.pests), t(i.productsUsed), t(i.areas), t(i.paymentMethod), i.paymentStatus ?? null, t(i.notes), !!i.customerConfirmed, !!i.technicianConfirmed, i.warrantyDays ?? null]);
    await audit(q, ctx, "OS_EDITADA", "service_order", id, null, { pagamento: i.paymentStatus, garantia: i.warrantyDays });
  });
}

/** Conclui a OS. Com garantia, cria o retorno de garantia para o mesmo técnico, vencendo ao fim do prazo. Devolve o id do retorno criado. */
export async function executeServiceOrder(db: Db, ctx: Ctx, id: string): Promise<string | null> {
  return db.tx(async (q) => {
    const [o] = await q<{ status: OSStatus; staff_id: string; customer_id: string; appointment_id: string; warranty_days: number | null; technician_confirmed: boolean }>(
      `select so.status, a.staff_id, a.customer_id, so.appointment_id, so.warranty_days, so.technician_confirmed
       from service_orders so join appointments a on a.id=so.appointment_id where so.id=$1 and so.unit_id=$2 for update of so`, [requireUuid(id, "Ordem de serviço"), ctx.unitId]);
    if (!o) throw new DomainError("not_found", "Ordem de serviço não encontrada.");
    if (!canEditOrder(ctx, o.staff_id)) throw new ForbiddenError();
    if (o.status !== "aberta") throw new DomainError("locked", "Esta OS já foi encerrada.");
    if (!o.technician_confirmed) throw new DomainError("invalid", "Marque a confirmação do técnico antes de concluir a OS.");
    await q("update service_orders set status='executada', updated_at=now() where id=$1", [id]);
    await audit(q, ctx, "OS_EXECUTADA", "service_order", id);
    if (!o.warranty_days) return null;
    const [dup] = await q("select 1 from service_returns where origin_appointment_id=$1 and kind='garantia' and status<>'cancelado'", [o.appointment_id]);
    if (dup) return null;
    return insertReturn(q, ctx, { customerId: o.customer_id, kind: "garantia", dueDate: addDays(todayYmd(), o.warranty_days), staffId: o.staff_id, originAppointmentId: o.appointment_id, notes: "Criado automaticamente ao concluir a ordem de serviço." });
  });
}

export async function cancelServiceOrder(db: Db, ctx: Ctx, id: string, reason: string) {
  const why = requireText(reason, "Motivo");
  await db.tx(async (q) => {
    const [o] = await q<{ status: OSStatus; staff_id: string; notes: string | null }>(
      "select so.status, a.staff_id, so.notes from service_orders so join appointments a on a.id=so.appointment_id where so.id=$1 and so.unit_id=$2 for update of so", [requireUuid(id, "Ordem de serviço"), ctx.unitId]);
    if (!o) throw new DomainError("not_found", "Ordem de serviço não encontrada.");
    if (!can(ctx, "agenda.manage")) throw new ForbiddenError("Só quem gerencia a agenda cancela uma OS.");
    if (o.status !== "aberta") throw new DomainError("locked", "Esta OS já foi encerrada.");
    await q("update service_orders set status='cancelada', notes=concat_ws(E'\\n', notes, $2::text), updated_at=now() where id=$1", [id, `Cancelada: ${why}`]);
    await audit(q, ctx, "OS_CANCELADA", "service_order", id, null, { motivo: why });
  });
}

// ───────── Financeiro: lançamentos manuais ─────────
export interface FinanceEntryRow { id: string; kind: "receita" | "gasto"; category: string; description: string; amount_cents: number; entry_date: string; created_by_name: string | null }

export async function listFinanceEntries(db: Db, ctx: Ctx, period: { start: string; end: string }) {
  need(ctx, "finance.view");
  ymdOrThrow(period.start, "Data inicial");
  ymdOrThrow(period.end, "Data final");
  const rows = await db.query<FinanceEntryRow>(
    `select f.id, f.kind, f.category, f.description, f.amount_cents, to_char(f.entry_date,'YYYY-MM-DD') as entry_date, u.full_name as created_by_name
     from finance_entries f left join users u on u.id=f.created_by
     where f.unit_id=$1 and f.entry_date between $2 and $3 order by f.entry_date desc, f.created_at desc`,
    [ctx.unitId, period.start, period.end],
  );
  const income = rows.filter((r) => r.kind === "receita").reduce((a, r) => a + r.amount_cents, 0);
  const expense = rows.filter((r) => r.kind === "gasto").reduce((a, r) => a + r.amount_cents, 0);
  const byCategory = new Map<string, { kind: string; cents: number }>();
  for (const r of rows) {
    const k = `${r.kind}:${r.category}`;
    byCategory.set(k, { kind: r.kind, cents: (byCategory.get(k)?.cents ?? 0) + r.amount_cents });
  }
  return {
    rows, income, expense, balance: income - expense,
    categories: [...byCategory.entries()].map(([k, v]) => ({ kind: v.kind, category: k.slice(k.indexOf(":") + 1), cents: v.cents })).sort((a, b) => b.cents - a.cents),
  };
}

export interface SaveFinanceEntryInput { kind: string; category: string; description: string; amountCents: number | null; entryDate: string }

export async function saveFinanceEntry(db: Db, ctx: Ctx, i: SaveFinanceEntryInput): Promise<string> {
  need(ctx, "finance.manage");
  if (i.kind !== "receita" && i.kind !== "gasto") throw new DomainError("invalid", "Escolha receita ou gasto.");
  if (!i.amountCents || i.amountCents <= 0) throw new DomainError("invalid", "Informe um valor maior que zero.");
  const date = ymdOrThrow(i.entryDate, "Data");
  return db.tx(async (q) => {
    const [r] = await q<{ id: string }>(
      "insert into finance_entries(unit_id,kind,category,description,amount_cents,entry_date,created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [ctx.unitId, i.kind, requireText(i.category, "Categoria"), requireText(i.description, "Descrição"), i.amountCents, date, ctx.userId]);
    await audit(q, ctx, "LANCAMENTO_CRIADO", "finance_entry", r.id, null, { tipo: i.kind, valor: i.amountCents, data: date });
    return r.id;
  });
}

export async function deleteFinanceEntry(db: Db, ctx: Ctx, id: string) {
  need(ctx, "finance.manage");
  await db.tx(async (q) => {
    const [r] = await q<FinanceEntryRow>("delete from finance_entries where id=$1 and unit_id=$2 returning kind, category, description, amount_cents, to_char(entry_date,'YYYY-MM-DD') as entry_date", [requireUuid(id, "Lançamento"), ctx.unitId]);
    if (!r) throw new DomainError("not_found", "Lançamento não encontrado.");
    await audit(q, ctx, "LANCAMENTO_EXCLUIDO", "finance_entry", id, r, null);
  });
}
