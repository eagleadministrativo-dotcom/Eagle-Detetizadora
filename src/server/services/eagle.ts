import type { Db, Q } from "../db";
import { audit, can, need, requireText, requireUuid } from "../core";
import { DomainError } from "../errors";
import type { Ctx } from "../permissions";

// ───────── Retornos (Garantia, Manutenção, Outros) ─────────
export type ReturnKind = "garantia" | "manutencao" | "outro";
export type ReturnStatus = "pendente" | "agendado" | "concluido" | "cancelado";

export interface ServiceReturn {
  id: string;
  customerId: string;
  originAppointmentId?: string;
  staffId?: string;
  kind: ReturnKind;
  dueDate: Date;
  status: ReturnStatus;
  appointmentId?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function listReturns(db: Db, ctx: Ctx, opts: { status?: ReturnStatus; limit?: number; offset?: number } = {}) {
  need(ctx, "returns.view_all");
  const rows = await db.query<ServiceReturn & { customer_name: string; total: number }>(
    `select r.id, r.customer_id as "customerId", r.origin_appointment_id as "originAppointmentId", r.staff_id as "staffId",
            r.kind, r.due_date as "dueDate", r.status, r.appointment_id as "appointmentId", r.notes,
            r.created_at as "createdAt", r.updated_at as "updatedAt", c.name as customer_name,
            count(*) over() as total
     from service_returns r
     join customers c on c.id = r.customer_id
     where r.unit_id = $1 and ($2::text is null or r.status = $2)
     order by r.due_date asc, r.created_at desc
     limit $3 offset $4`,
    [ctx.unitId, opts.status ?? null, opts.limit ?? 50, opts.offset ?? 0],
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

export interface SaveReturnInput {
  customerId: string;
  originAppointmentId?: string;
  kind: ReturnKind;
  dueDate: string;
  notes?: string;
}

export async function saveReturn(db: Db, ctx: Ctx, input: SaveReturnInput): Promise<string> {
  need(ctx, "returns.manage");
  const kind = ["garantia", "manutencao", "outro"].includes(input.kind) ? input.kind : "outro";
  const dueDate = new Date(input.dueDate);
  if (isNaN(dueDate.getTime())) throw new DomainError("invalid", "Data de vencimento inválida.");

  return db.tx(async (q) => {
    const [c] = await q("select id from customers where id=$1 and unit_id=$2", [requireUuid(input.customerId, "Cliente"), ctx.unitId]);
    if (!c) throw new DomainError("not_found", "Cliente não encontrado.");

    if (input.originAppointmentId) {
      const [a] = await q("select id from appointments where id=$1 and unit_id=$2", [requireUuid(input.originAppointmentId, "Atendimento"), ctx.unitId]);
      if (!a) throw new DomainError("not_found", "Atendimento de origem não encontrado.");
      const [dup] = await q("select id from service_returns where origin_appointment_id=$1 and kind=$2 and status<>'cancelado'", [input.originAppointmentId, kind]);
      if (dup) throw new DomainError("conflict", "Já existe um retorno deste tipo para este atendimento.");
    }

    const [r] = await q<{ id: string }>(
      "insert into service_returns(unit_id,customer_id,origin_appointment_id,kind,due_date,status,notes,created_by) values ($1,$2,$3,$4,$5,'pendente',$6,$7) returning id",
      [ctx.unitId, input.customerId, input.originAppointmentId ?? null, kind, dueDate.toISOString().split("T")[0], input.notes || null, ctx.userId],
    );
    await audit(q, ctx, "RETORNO_CRIADO", "service_return", r.id, null, { kind, dueDate: input.dueDate });
    return r.id;
  });
}

export async function updateReturnStatus(db: Db, ctx: Ctx, id: string, status: ReturnStatus) {
  need(ctx, "returns.manage");
  if (!["pendente", "agendado", "concluido", "cancelado"].includes(status)) throw new DomainError("invalid", "Status inválido.");

  return db.tx(async (q) => {
    const [r] = await q<{ status: string }>("select status from service_returns where id=$1 and unit_id=$2 for update", [requireUuid(id, "Retorno"), ctx.unitId]);
    if (!r) throw new DomainError("not_found", "Retorno não encontrado.");
    if (r.status === status) return;

    await q("update service_returns set status=$2, updated_at=now() where id=$1", [id, status]);
    await audit(q, ctx, "RETORNO_STATUS_ALTERADO", "service_return", id, { status: r.status }, { status });
  });
}

// ───────── Orçamentos ─────────
export type QuoteStatus = "rascunho" | "enviado" | "aprovado" | "recusado";

export interface Quote {
  id: string;
  number: number;
  customerId: string;
  serviceAddress?: string;
  issueDate: Date;
  validUntil?: Date;
  status: QuoteStatus;
  discountCents: number;
  paymentTerms?: string;
  conditions?: string;
  notes?: string;
  appointmentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuoteItem {
  id: string;
  quoteId: string;
  serviceId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  sortOrder: number;
}

export async function listQuotes(db: Db, ctx: Ctx, opts: { customerId?: string; limit?: number; offset?: number } = {}) {
  need(ctx, "quotes.view");
  const rows = await db.query<Quote & { customer_name: string; total_items_cents: number; total: number }>(
    `select q.id, q.number, q.customer_id as "customerId", q.service_address as "serviceAddress",
            q.issue_date as "issueDate", q.valid_until as "validUntil", q.status,
            q.discount_cents as "discountCents", q.payment_terms as "paymentTerms", q.conditions,
            q.notes, q.appointment_id as "appointmentId",
            q.created_at as "createdAt", q.updated_at as "updatedAt", c.name as customer_name,
            coalesce((select sum(quantity * unit_price_cents) from quote_items where quote_id=q.id), 0)::bigint as total_items_cents,
            count(*) over() as total
     from quotes q
     join customers c on c.id = q.customer_id
     where q.unit_id = $1 and ($2::uuid is null or q.customer_id = $2)
     order by q.issue_date desc
     limit $3 offset $4`,
    [ctx.unitId, opts.customerId ?? null, opts.limit ?? 50, opts.offset ?? 0],
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

export interface SaveQuoteInput {
  id?: string;
  customerId: string;
  serviceAddress?: string;
  issueDate?: string;
  validUntil?: string;
  discountCents?: number;
  paymentTerms?: string;
  conditions?: string;
  notes?: string;
  items: { serviceId?: string; description: string; quantity: number; unitPriceCents: number }[];
}

export async function saveQuote(db: Db, ctx: Ctx, input: SaveQuoteInput): Promise<string> {
  need(ctx, "quotes.manage");
  if (!input.items.length) throw new DomainError("invalid", "Orçamento deve ter pelo menos um item.");

  return db.tx(async (q) => {
    const [c] = await q("select id from customers where id=$1 and unit_id=$2", [requireUuid(input.customerId, "Cliente"), ctx.unitId]);
    if (!c) throw new DomainError("not_found", "Cliente não encontrado.");

    let quoteId = input.id;
    if (!quoteId) {
      const [n] = await q<{ nextNumber: number }>("select coalesce(max(number), 0) + 1 as \"nextNumber\" from quotes where unit_id=$1", [ctx.unitId]);
      const [r] = await q<{ id: string }>(
        "insert into quotes(unit_id,number,customer_id,service_address,issue_date,valid_until,discount_cents,payment_terms,conditions,notes,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id",
        [
          ctx.unitId, n.nextNumber, input.customerId, input.serviceAddress || null,
          input.issueDate || new Date().toISOString().split("T")[0],
          input.validUntil || null, input.discountCents || 0, input.paymentTerms || null,
          input.conditions || null, input.notes || null, ctx.userId,
        ],
      );
      quoteId = r.id;
    } else {
      await q(
        "update quotes set service_address=$2, valid_until=$3, discount_cents=$4, payment_terms=$5, conditions=$6, notes=$7, updated_at=now() where id=$1 and unit_id=$8",
        [quoteId, input.serviceAddress || null, input.validUntil || null, input.discountCents || 0, input.paymentTerms || null, input.conditions || null, input.notes || null, ctx.unitId],
      );
      await q("delete from quote_items where quote_id=$1", [quoteId]);
    }

    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i];
      await q(
        "insert into quote_items(quote_id,service_id,description,quantity,unit_price_cents,sort_order) values ($1,$2,$3,$4,$5,$6)",
        [quoteId, item.serviceId || null, requireText(item.description, "Descrição"), item.quantity || 1, item.unitPriceCents || 0, i],
      );
    }

    await audit(q, ctx, input.id ? "ORCAMENTO_EDITADO" : "ORCAMENTO_CRIADO", "quote", quoteId, null, { items: input.items.length });
    return quoteId;
  });
}

// ───────── Ordens de Serviço ─────────
export type OSStatus = "aberta" | "executada" | "cancelada";
export type PaymentStatus = "pendente" | "pago" | "parcial";

export interface ServiceOrder {
  id: string;
  number: number;
  appointmentId: string;
  quoteId?: string;
  status: OSStatus;
  pests?: string;
  productsUsed?: string;
  areas?: string;
  paymentMethod?: string;
  paymentStatus: PaymentStatus;
  notes?: string;
  customerConfirmed: boolean;
  technicianConfirmed: boolean;
  warrantyDays?: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function saveServiceOrder(db: Db, ctx: Ctx, appointmentId: string, input: Partial<ServiceOrder>): Promise<string> {
  need(ctx, "agenda.manage");

  return db.tx(async (q) => {
    const [a] = await q("select id from appointments where id=$1 and unit_id=$2", [requireUuid(appointmentId, "Atendimento"), ctx.unitId]);
    if (!a) throw new DomainError("not_found", "Atendimento não encontrado.");

    const [existing] = await q<{ id: string }>("select id from service_orders where appointment_id=$1", [appointmentId]);
    if (existing) throw new DomainError("conflict", "Já existe uma OS para este atendimento.");

    const [n] = await q<{ nextNumber: number }>("select coalesce(max(number), 0) + 1 as \"nextNumber\" from service_orders where unit_id=$1", [ctx.unitId]);
    const [r] = await q<{ id: string }>(
      "insert into service_orders(unit_id,number,appointment_id,quote_id,pests,products_used,areas,payment_method,warranty_days,notes,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id",
      [ctx.unitId, n.nextNumber, appointmentId, input.quoteId || null, input.pests || null, input.productsUsed || null, input.areas || null, input.paymentMethod || null, input.warrantyDays || null, input.notes || null, ctx.userId],
    );

    await audit(q, ctx, "OS_CRIADA", "service_order", r.id, null, { appointment: appointmentId });
    return r.id;
  });
}

// ───────── Financeiro ─────────
export interface FinanceEntry {
  id: string;
  kind: "receita" | "gasto";
  category: string;
  description: string;
  amountCents: number;
  entryDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

export async function listFinanceEntries(db: Db, ctx: Ctx, opts: { kind?: "receita" | "gasto"; fromDate?: Date; toDate?: Date; limit?: number; offset?: number } = {}) {
  need(ctx, "finance.view");
  const rows = await db.query<FinanceEntry & { total: number }>(
    `select f.id, f.kind, f.category, f.description, f.amount_cents as "amountCents", f.entry_date as "entryDate",
            f.created_at as "createdAt", f.updated_at as "updatedAt", count(*) over() as total
     from finance_entries f
     where f.unit_id = $1 and ($2::text is null or f.kind = $2) and ($3::date is null or f.entry_date >= $3) and ($4::date is null or f.entry_date <= $4)
     order by f.entry_date desc, f.created_at desc
     limit $5 offset $6`,
    [ctx.unitId, opts.kind ?? null, opts.fromDate?.toISOString().split("T")[0] ?? null, opts.toDate?.toISOString().split("T")[0] ?? null, opts.limit ?? 50, opts.offset ?? 0],
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

export interface SaveFinanceEntryInput {
  kind: "receita" | "gasto";
  category: string;
  description: string;
  amountCents: number;
  entryDate: string;
}

export async function saveFinanceEntry(db: Db, ctx: Ctx, input: SaveFinanceEntryInput): Promise<string> {
  need(ctx, "finance.manage");
  if (input.amountCents <= 0) throw new DomainError("invalid", "Valor deve ser maior que zero.");

  const [r] = await db.query<{ id: string }>(
    "insert into finance_entries(unit_id,kind,category,description,amount_cents,entry_date,created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    [ctx.unitId, input.kind, requireText(input.category, "Categoria"), requireText(input.description, "Descrição"), input.amountCents, input.entryDate, ctx.userId],
  );

  await audit(await db.query, ctx, "LANCAMENTO_CRIADO", "finance_entry", r.id, null, { kind: input.kind, amount: input.amountCents });
  return r.id;
}
