import type { Db } from "../db";
import { audit, can, need, requireText, requireUuid } from "../core";
import { DomainError } from "../errors";
import type { Ctx } from "../permissions";
import { cleanRow, normalizePhone, MAX_IMPORT_ROWS, type ImportRow } from "@/lib/contact-import";

export interface CustomerRow { id: string; name: string; phone: string | null; email: string | null; cpf: string | null; birthdate: string | null; notes: string | null; is_active: boolean; visits: number; sheet_visits?: number; last_visit: Date | null; first_visit?: Date | null; total_spent_cents: number; legal_name?: string | null; trade_name?: string | null; address?: string | null; cep?: string | null; contact_name?: string | null }

const ACC_FROM = "áàâãäéèêëíìîïóòôõöúùûüçñ";
const ACC_TO = "aaaaaeeeeiiiiooooouuuucn";
/** Tira acentos e caixa, igual ao que o banco faz na busca. */
export const searchKey = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const NORM = (expr: string) => `translate(lower(${expr}), '${ACC_FROM}', '${ACC_TO}')`;
const SEARCH_TEXT = NORM("c.name || ' ' || coalesce(c.trade_name,'') || ' ' || coalesce(c.legal_name,'') || ' ' || coalesce(c.contact_name,'') || ' ' || coalesce(c.address,'')");

// visitas e total gasto: ordens de serviço concluídas, atendimentos antigos e o histórico das planilhas de vendas
const OS_VALUE = "coalesce(so.value_cents, (select sum(ai.price_cents) from appointment_services ai where ai.appointment_id=so.appointment_id), 0)";
const OS_DAY = "coalesce(so.service_date::timestamptz + interval '12 hours', so.executed_at)";
const VISIT_COLS = `
       ((select count(*) from attendances a where a.customer_id=c.id and a.status='concluido') + (select count(*) from service_orders so where so.customer_id=c.id and so.status='executada')
        + (select count(*) from service_history h where h.customer_id=c.id))::bigint as visits,
       (select count(*) from service_history h where h.customer_id=c.id)::bigint as sheet_visits,
       greatest((select max(a.finished_at) from attendances a where a.customer_id=c.id and a.status='concluido'),
                (select max(${OS_DAY}) from service_orders so where so.customer_id=c.id and so.status='executada'),
                (select max(h.service_date)::timestamptz + interval '12 hours' from service_history h where h.customer_id=c.id)) as last_visit,
       least((select min(a.finished_at) from attendances a where a.customer_id=c.id and a.status='concluido'),
             (select min(${OS_DAY}) from service_orders so where so.customer_id=c.id and so.status='executada'),
             (select min(h.service_date)::timestamptz + interval '12 hours' from service_history h where h.customer_id=c.id)) as first_visit,
       (coalesce((select sum(a.total_cents) from attendances a where a.customer_id=c.id and a.status='concluido'),0)
        + coalesce((select sum(${OS_VALUE}) from service_orders so where so.customer_id=c.id and so.status='executada'),0)
        + coalesce((select sum(h.amount_cents) from service_history h where h.customer_id=c.id),0))::bigint as total_spent_cents`;

export async function listCustomers(db: Db, ctx: Ctx, opts: { search?: string; limit?: number; offset?: number; includeInactive?: boolean } = {}) {
  need(ctx, "customers.view");
  const sensitive = can(ctx, "customers.edit_sensitive") || can(ctx, "finance.view");
  const term = opts.search ? searchKey(opts.search) : "";
  const like = term ? `%${term}%` : null;
  const digits = term.replace(/\D/g, "");
  const likeDigits = digits.length >= 3 ? `%${digits}%` : null;
  const rows = await db.query<CustomerRow & { total: number }>(
    `select c.id, c.name, c.phone,
       case when $5 then c.email end as email, case when $5 then c.cpf end as cpf, case when $5 then to_char(c.birthdate,'YYYY-MM-DD') end as birthdate,
       c.notes, c.is_active, c.trade_name, c.contact_name,${VISIT_COLS},
       count(*) over() as total
     from customers c
     where c.unit_id=$1 and ($6 or c.is_active)
       and ($2::text is null or ${SEARCH_TEXT} like $2
            or ($7::text is not null and regexp_replace(coalesce(c.phone,''), '[^0-9]', '', 'g') like $7)
            or ($5 and $7::text is not null and regexp_replace(coalesce(c.cpf,''), '[^0-9]', '', 'g') like $7))
     order by lower(c.name) limit $3 offset $4`,
    [ctx.unitId, like, opts.limit ?? 50, opts.offset ?? 0, sensitive, opts.includeInactive ?? false, likeDigits],
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

export interface CustomerOption { id: string; name: string; phone: string | null; trade_name: string | null; contact_name: string | null; address: string | null; notes: string | null }

/** Lista leve para os campos de cliente com busca (OS, orçamento, agenda, retorno). */
export async function customerOptions(db: Db, ctx: Ctx): Promise<CustomerOption[]> {
  need(ctx, "customers.view");
  return db.query<CustomerOption>("select id, name, phone, trade_name, contact_name, address, notes from customers where unit_id=$1 and is_active order by lower(name) limit 5000", [ctx.unitId]);
}

export async function getCustomer(db: Db, ctx: Ctx, id: string) {
  need(ctx, "customers.view");
  const sensitive = can(ctx, "customers.edit_sensitive") || can(ctx, "finance.view");
  const [c] = await db.query<CustomerRow>(
    `select c.id,c.name,c.phone, case when $3 then c.email end as email, case when $3 then c.cpf end as cpf, case when $3 then to_char(c.birthdate,'YYYY-MM-DD') end as birthdate, c.notes, c.is_active,
       c.legal_name, c.trade_name, c.address, c.cep, c.contact_name,${VISIT_COLS}
     from customers c where c.id=$1 and c.unit_id=$2`,
    [id, ctx.unitId, sensitive],
  );
  if (!c) throw new DomainError("not_found", "Cliente não encontrado.");
  const history = await db.query<{ id: string; finished_at: Date; total_cents: number; staff_name: string; services: string }>(
    `select a.id, a.finished_at, a.total_cents, s.name as staff_name,
       coalesce((select string_agg(i.name_snapshot,' + ') from attendance_items i where i.attendance_id=a.id),'') as services
     from attendances a join staff s on s.id=a.staff_id where a.customer_id=$1 and a.unit_id=$2 and a.status='concluido' order by a.finished_at desc limit 20`,
    [id, ctx.unitId],
  );
  return { customer: c, history };
}

export async function updateCustomerNotes(db: Db, ctx: Ctx, id: string, notes: string | null) {
  need(ctx, "customers.manage");
  const text = (notes ?? "").trim().slice(0, 4000) || null;
  await db.tx(async (q) => {
    const [old] = await q<{ notes: string | null }>("select notes from customers where id=$1 and unit_id=$2 for update", [requireUuid(id, "Cliente"), ctx.unitId]);
    if (!old) throw new DomainError("not_found", "Cliente não encontrado.");
    await q("update customers set notes=$3, updated_at=now(), updated_by=$4 where id=$1 and unit_id=$2", [id, ctx.unitId, text, ctx.userId]);
    await audit(q, ctx, "CLIENTE_EDITADO", "customer", id, { notes: old.notes }, { notes: text });
  });
}

export interface SaveCustomerInput { id?: string; name: string; phone?: string | null; email?: string | null; cpf?: string | null; birthdate?: string | null; notes?: string | null; isActive?: boolean; legalName?: string | null; tradeName?: string | null; address?: string | null; cep?: string | null; contactName?: string | null }

export async function saveCustomer(db: Db, ctx: Ctx, input: SaveCustomerInput): Promise<string> {
  need(ctx, "customers.manage");
  const name = requireText(input.name, "Nome do cliente");
  const phone = input.phone?.replace(/[^\d+]/g, "") || null;
  if (phone && phone.replace(/\D/g, "").length < 10) throw new DomainError("invalid", "Telefone inválido (informe DDD + número).");
  const sensitive = can(ctx, "customers.edit_sensitive");
  return db.tx(async (q) => {
    if (input.id) {
      const [old] = await q<Record<string, unknown>>("select * from customers where id=$1 and unit_id=$2 for update", [input.id, ctx.unitId]);
      if (!old) throw new DomainError("not_found", "Cliente não encontrado.");
      if (input.isActive === false && old.is_active && !can(ctx, "customers.deactivate")) throw new DomainError("forbidden", "Sem permissão para desativar clientes.");
      await q(
        `update customers set name=$2, phone=$3, notes=$4, is_active=$5,
           email = case when $6 then $7 else email end, cpf = case when $6 then $8 else cpf end, birthdate = case when $6 then $9::date else birthdate end,
           legal_name=$11, trade_name=$12, address=$13, cep=$14, contact_name=$15, updated_at=now(), updated_by=$10 where id=$1`,
        [input.id, name, phone, input.notes ?? null, input.isActive ?? (old.is_active as boolean), sensitive, input.email || null, input.cpf || null, input.birthdate || null, ctx.userId,
          input.legalName?.trim() || null, input.tradeName?.trim() || null, input.address?.trim() || null, input.cep?.trim() || null, input.contactName?.trim() || null],
      );
      await audit(q, ctx, "CLIENTE_EDITADO", "customer", input.id, { name: old.name, phone: old.phone }, { name, phone });
      return input.id;
    }
    // mesmo cliente enviado de novo em seguida (clique duplo, rede lenta): devolve o cadastro que acabou de ser criado
    await q("select pg_advisory_xact_lock(hashtext('customer-new:' || $1::text))", [ctx.unitId]);
    const [recent] = await q<{ id: string }>(
      `select id from customers where unit_id=$1 and lower(name)=lower($2) and coalesce(phone,'')=coalesce($3,'') and created_at > now() - interval '2 minutes'
       order by created_at desc limit 1`, [ctx.unitId, name, phone]);
    if (recent) return recent.id;
    const [r] = await q<{ id: string }>(
      "insert into customers(unit_id,name,phone,email,cpf,birthdate,notes,updated_by,legal_name,trade_name,address,cep,contact_name) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id",
      [ctx.unitId, name, phone, sensitive ? input.email || null : null, sensitive ? input.cpf || null : null, sensitive ? input.birthdate || null : null, input.notes ?? null, ctx.userId,
        input.legalName?.trim() || null, input.tradeName?.trim() || null, input.address?.trim() || null, input.cep?.trim() || null, input.contactName?.trim() || null],
    );
    await audit(q, ctx, "CLIENTE_CRIADO", "customer", r.id, null, { name });
    return r.id;
  });
}

export interface ImportResult { created: number; duplicates: number; invalid: number }

const phoneKey = (p: string | null) => normalizePhone(p) ?? "";

/** Importa clientes em lote (contatos do celular ou arquivo de outro sistema). Pula telefones que já existem; revalida tudo no servidor. */
export async function importCustomers(db: Db, ctx: Ctx, input: Partial<ImportRow>[]): Promise<ImportResult> {
  need(ctx, "customers.manage");
  if (!Array.isArray(input)) throw new DomainError("invalid", "Lista de contatos inválida.");
  if (input.length > MAX_IMPORT_ROWS) throw new DomainError("invalid", `Importe no máximo ${MAX_IMPORT_ROWS} contatos por vez.`);
  const sensitive = can(ctx, "customers.edit_sensitive");
  const clean: ImportRow[] = [];
  let invalid = 0;
  for (const raw of input) {
    const r = raw && typeof raw === "object" ? cleanRow(raw) : null;
    if (r) clean.push(r); else invalid++;
  }
  return db.tx(async (q) => {
    const existing = new Set((await q<{ phone: string | null }>("select phone from customers where unit_id=$1 and phone is not null", [ctx.unitId])).map((r) => phoneKey(r.phone)));
    const fresh: ImportRow[] = [];
    let duplicates = 0;
    for (const r of clean) {
      if (existing.has(r.phone)) { duplicates++; continue; }
      existing.add(r.phone);
      fresh.push(r);
    }
    for (let i = 0; i < fresh.length; i += 200) {
      const part = fresh.slice(i, i + 200);
      await q(
        `insert into customers(unit_id,name,phone,email,cpf,birthdate,notes,updated_by)
         select $1::uuid, t.name, t.phone, t.email, t.cpf, t.birthdate, t.notes, $8::uuid
         from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::date[], $7::text[]) as t(name, phone, email, cpf, birthdate, notes)`,
        [ctx.unitId, part.map((r) => r.name), part.map((r) => r.phone), part.map((r) => (sensitive ? r.email ?? null : null)), part.map((r) => (sensitive ? r.cpf ?? null : null)),
          part.map((r) => (sensitive ? r.birthdate ?? null : null)), part.map((r) => r.notes ?? null), ctx.userId],
      );
    }
    await audit(q, ctx, "CLIENTES_IMPORTADOS", "customer", null, null, { criados: fresh.length, repetidos: duplicates, invalidos: invalid });
    return { created: fresh.length, duplicates, invalid };
  });
}
