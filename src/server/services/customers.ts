import type { Db } from "../db";
import { audit, can, need, requireText } from "../core";
import { DomainError } from "../errors";
import type { Ctx } from "../permissions";

export interface CustomerRow { id: string; name: string; phone: string | null; email: string | null; cpf: string | null; birthdate: string | null; notes: string | null; is_active: boolean; visits: number; last_visit: Date | null; total_spent_cents: number }

export async function listCustomers(db: Db, ctx: Ctx, opts: { search?: string; limit?: number; offset?: number; includeInactive?: boolean } = {}) {
  need(ctx, "customers.view");
  const sensitive = can(ctx, "customers.edit_sensitive") || can(ctx, "finance.view");
  const like = opts.search ? `%${opts.search.trim().toLowerCase()}%` : null;
  const rows = await db.query<CustomerRow & { total: number }>(
    `select c.id, c.name, c.phone,
       case when $5 then c.email end as email, case when $5 then c.cpf end as cpf, case when $5 then to_char(c.birthdate,'YYYY-MM-DD') end as birthdate,
       c.notes, c.is_active,
       (select count(*) from attendances a where a.customer_id=c.id and a.status='concluido')::bigint as visits,
       (select max(a.finished_at) from attendances a where a.customer_id=c.id and a.status='concluido') as last_visit,
       coalesce((select sum(a.total_cents) from attendances a where a.customer_id=c.id and a.status='concluido'),0)::bigint as total_spent_cents,
       count(*) over() as total
     from customers c
     where c.unit_id=$1 and ($2::text is null or lower(c.name) like $2 or c.phone like $2) and ($6 or c.is_active)
     order by lower(c.name) limit $3 offset $4`,
    [ctx.unitId, like, opts.limit ?? 50, opts.offset ?? 0, sensitive, opts.includeInactive ?? false],
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

export async function getCustomer(db: Db, ctx: Ctx, id: string) {
  need(ctx, "customers.view");
  const sensitive = can(ctx, "customers.edit_sensitive") || can(ctx, "finance.view");
  const [c] = await db.query<CustomerRow>(
    `select c.id,c.name,c.phone, case when $3 then c.email end as email, case when $3 then c.cpf end as cpf, case when $3 then to_char(c.birthdate,'YYYY-MM-DD') end as birthdate, c.notes, c.is_active,
       (select count(*) from attendances a where a.customer_id=c.id and a.status='concluido')::bigint as visits,
       (select max(a.finished_at) from attendances a where a.customer_id=c.id and a.status='concluido') as last_visit,
       coalesce((select sum(a.total_cents) from attendances a where a.customer_id=c.id and a.status='concluido'),0)::bigint as total_spent_cents
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

export interface SaveCustomerInput { id?: string; name: string; phone?: string | null; email?: string | null; cpf?: string | null; birthdate?: string | null; notes?: string | null; isActive?: boolean }

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
           updated_at=now(), updated_by=$10 where id=$1`,
        [input.id, name, phone, input.notes ?? null, input.isActive ?? (old.is_active as boolean), sensitive, input.email || null, input.cpf || null, input.birthdate || null, ctx.userId],
      );
      await audit(q, ctx, "CLIENTE_EDITADO", "customer", input.id, { name: old.name, phone: old.phone }, { name, phone });
      return input.id;
    }
    const [r] = await q<{ id: string }>(
      "insert into customers(unit_id,name,phone,email,cpf,birthdate,notes,updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
      [ctx.unitId, name, phone, sensitive ? input.email || null : null, sensitive ? input.cpf || null : null, sensitive ? input.birthdate || null : null, input.notes ?? null, ctx.userId],
    );
    await audit(q, ctx, "CLIENTE_CRIADO", "customer", r.id, null, { name });
    return r.id;
  });
}
