import type { Db, Q } from "../db";
import { audit, getSettings, need, requireNonNegative, requireText, requireUuid, type UnitSettings } from "../core";
import { DomainError } from "../errors";
import type { Ctx } from "../permissions";

// ---------- serviços ----------
export interface ServiceRow {
  id: string; name: string; description: string | null; category_id: string | null; category_name: string | null;
  duration_minutes: number; buffer_minutes: number; color: string | null; sort_order: number; is_active: boolean;
  price_cents: number | null; staff_ids: string[]; custom_fields: { label: string; value: string }[];
}

export async function priceAt(q: Q, serviceId: string, staffId: string | null, at: Date): Promise<number | null> {
  const [r] = await q<{ price_cents: number }>(
    `select price_cents from service_prices
     where service_id=$1 and valid_from <= $3 and (staff_id = $2 or staff_id is null)
     order by (staff_id is not null) desc, valid_from desc limit 1`,
    [serviceId, staffId, at],
  );
  return r ? r.price_cents : null;
}

export async function listServices(db: Db | Q, unitId: string, includeInactive = false): Promise<ServiceRow[]> {
  const q: Q = typeof db === "function" ? db : db.query;
  const rows = await q<ServiceRow>(
    `select s.id, s.name, s.description, s.category_id, c.name as category_name, s.duration_minutes, s.buffer_minutes, s.color, s.sort_order, s.is_active,
       (select p.price_cents from service_prices p where p.service_id = s.id and p.staff_id is null and p.valid_from <= now() order by p.valid_from desc limit 1) as price_cents,
       coalesce((select array_agg(ss.staff_id::text) from service_staff ss where ss.service_id = s.id), '{}') as staff_ids,
       coalesce((select jsonb_agg(jsonb_build_object('label', f.label, 'value', f.value) order by f.label) from service_custom_fields f where f.service_id = s.id), '[]'::jsonb) as custom_fields
     from services s left join service_categories c on c.id = s.category_id
     where s.unit_id = $1 and ($2 or s.is_active)
     order by c.sort_order nulls last, s.sort_order, s.name`,
    [unitId, includeInactive],
  );
  return rows;
}

export interface SaveServiceInput {
  id?: string; name: string; description?: string | null; categoryId?: string | null;
  durationMinutes: number; bufferMinutes?: number; color?: string | null; sortOrder?: number; isActive?: boolean;
  priceCents?: number | null; priceValidFrom?: Date; staffIds?: string[]; customFields?: { label: string; value: string }[];
}

export async function saveService(db: Db, ctx: Ctx, input: SaveServiceInput): Promise<string> {
  need(ctx, "admin.catalog");
  const name = requireText(input.name, "Nome do serviço");
  const duration = requireNonNegative(input.durationMinutes, "Duração");
  if (duration < 1) throw new DomainError("invalid", "A duração deve ser de pelo menos 1 minuto.");
  const buffer = requireNonNegative(input.bufferMinutes ?? 0, "Intervalo");
  if (input.priceCents != null) requireNonNegative(input.priceCents, "Preço");
  return db.tx(async (q) => {
    let id = input.id;
    let before: unknown = null;
    if (id) {
      requireUuid(id, "Serviço");
      const [old] = await q("select * from services where id=$1 and unit_id=$2 for update", [id, ctx.unitId]);
      if (!old) throw new DomainError("not_found", "Serviço não encontrado.");
      before = old;
      await q(
        "update services set name=$2, description=$3, category_id=$4, duration_minutes=$5, buffer_minutes=$6, color=$7, sort_order=coalesce($8, sort_order), is_active=$9 where id=$1",
        [id, name, input.description ?? null, input.categoryId || null, duration, buffer, input.color ?? null, input.sortOrder ?? null, input.isActive ?? true],
      );
    } else {
      const [r] = await q<{ id: string }>(
        "insert into services(unit_id,name,description,category_id,duration_minutes,buffer_minutes,color,sort_order,is_active) values ($1,$2,$3,$4,$5,$6,$7,coalesce($8,0),$9) returning id",
        [ctx.unitId, name, input.description ?? null, input.categoryId || null, duration, buffer, input.color ?? null, input.sortOrder ?? null, input.isActive ?? true],
      );
      id = r.id;
    }
    if (input.priceCents != null) {
      const current = await priceAt(q, id, null, new Date());
      if (current !== input.priceCents) {
        await q("insert into service_prices(service_id,price_cents,valid_from,created_by) values ($1,$2,$3,$4)", [
          id, input.priceCents, input.priceValidFrom ?? new Date(), ctx.userId,
        ]);
        await audit(q, ctx, "PRECO_ALTERADO", "service", id, { price_cents: current }, { price_cents: input.priceCents, valid_from: input.priceValidFrom ?? "agora" });
      }
    }
    if (input.staffIds) {
      await q("delete from service_staff where service_id=$1", [id]);
      for (const sid of input.staffIds) await q("insert into service_staff(service_id,staff_id) values ($1,$2) on conflict do nothing", [id, sid]);
    }
    if (input.customFields) {
      await q("delete from service_custom_fields where service_id=$1", [id]);
      for (const f of input.customFields) {
        const label = f.label.trim();
        if (label) await q("insert into service_custom_fields(service_id,label,value) values ($1,$2,$3)", [id, label, f.value.trim()]);
      }
    }
    await audit(q, ctx, input.id ? "SERVICO_EDITADO" : "SERVICO_CRIADO", "service", id, before, { name, duration, buffer, active: input.isActive ?? true });
    return id!;
  });
}

export async function setServicePrice(db: Db, ctx: Ctx, serviceId: string, priceCents: number, staffId: string | null, validFrom = new Date()) {
  need(ctx, "admin.catalog");
  requireNonNegative(priceCents, "Preço");
  await db.tx(async (q) => {
    const [svc] = await q("select 1 from services where id=$1 and unit_id=$2", [serviceId, ctx.unitId]);
    if (!svc) throw new DomainError("not_found", "Serviço não encontrado.");
    await q("insert into service_prices(service_id,staff_id,price_cents,valid_from,created_by) values ($1,$2,$3,$4,$5)", [serviceId, staffId, priceCents, validFrom, ctx.userId]);
    await audit(q, ctx, "PRECO_ALTERADO", "service", serviceId, null, { price_cents: priceCents, staff_id: staffId, valid_from: validFrom });
  });
}

export async function priceHistory(db: Db, ctx: Ctx, serviceId: string) {
  need(ctx, "admin.catalog", "reports.view");
  return db.query<{ price_cents: number; valid_from: Date; staff_name: string | null; created_by_name: string | null }>(
    `select p.price_cents, p.valid_from, st.name as staff_name, u.full_name as created_by_name
     from service_prices p join services s on s.id=p.service_id left join staff st on st.id=p.staff_id left join users u on u.id=p.created_by
     where p.service_id=$1 and s.unit_id=$2 order by p.valid_from desc`,
    [serviceId, ctx.unitId],
  );
}

// ---------- cadastros simples ----------
export async function saveCategory(db: Db, ctx: Ctx, input: { id?: string; name: string; sortOrder?: number; isActive?: boolean }) {
  need(ctx, "admin.catalog");
  const name = requireText(input.name, "Nome da categoria");
  await db.tx(async (q) => {
    if (input.id) await q("update service_categories set name=$2, sort_order=coalesce($3, sort_order), is_active=$4 where id=$1 and unit_id=$5", [input.id, name, input.sortOrder ?? null, input.isActive ?? true, ctx.unitId]);
    else await q("insert into service_categories(unit_id,name,sort_order,is_active) values ($1,$2,$3,$4)", [ctx.unitId, name, input.sortOrder ?? 0, input.isActive ?? true]);
    await audit(q, ctx, "CATEGORIA_SERVICO_SALVA", "service_category", input.id ?? null, null, { name });
  });
}

export interface PaymentMethodInput { id?: string; name: string; kind: string; feePercent?: number; feeFixedCents?: number; settlementDays?: number; accountId?: string | null; isActive?: boolean; sortOrder?: number }
export async function savePaymentMethod(db: Db, ctx: Ctx, input: PaymentMethodInput) {
  need(ctx, "admin.settings");
  const name = requireText(input.name, "Nome da forma de pagamento");
  if (!["dinheiro", "pix", "cartao_credito", "cartao_debito", "outro"].includes(input.kind)) throw new DomainError("invalid", "Tipo de pagamento inválido.");
  const bps = Math.round((input.feePercent ?? 0) * 100);
  if (bps < 0 || bps > 10000) throw new DomainError("invalid", "Taxa deve ficar entre 0% e 100%.");
  await db.tx(async (q) => {
    if (input.id) {
      const [old] = await q("select * from payment_methods where id=$1 and unit_id=$2", [input.id, ctx.unitId]);
      await q(
        "update payment_methods set name=$2, kind=$3, fee_bps=$4, fee_fixed_cents=$5, settlement_days=$6, account_id=$7, is_active=$8, sort_order=coalesce($9, sort_order) where id=$1 and unit_id=$10",
        [input.id, name, input.kind, bps, input.feeFixedCents ?? 0, input.settlementDays ?? 0, input.accountId || null, input.isActive ?? true, input.sortOrder ?? null, ctx.unitId],
      );
      await audit(q, ctx, "FORMA_PAGAMENTO_EDITADA", "payment_method", input.id, old, { name, bps, fixed: input.feeFixedCents ?? 0 });
    } else {
      const [r] = await q<{ id: string }>(
        "insert into payment_methods(unit_id,name,kind,fee_bps,fee_fixed_cents,settlement_days,account_id,is_active,sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,0)) returning id",
        [ctx.unitId, name, input.kind, bps, input.feeFixedCents ?? 0, input.settlementDays ?? 0, input.accountId || null, input.isActive ?? true, input.sortOrder ?? null],
      );
      await audit(q, ctx, "FORMA_PAGAMENTO_CRIADA", "payment_method", r.id, null, { name, bps });
    }
  });
}

export async function saveChair(db: Db, ctx: Ctx, input: { id?: string; name: string; isActive?: boolean }) {
  need(ctx, "admin.schedules");
  const name = requireText(input.name, "Nome da cadeira");
  await db.tx(async (q) => {
    if (input.id) {
      if (input.isActive === false) {
        const [f] = await q<{ n: number }>("select count(*) as n from appointments where chair_id=$1 and status in ('agendado','em_atendimento') and starts_at > now()", [input.id]);
        if (f.n > 0) throw new DomainError("has_future", `Há ${f.n} agendamento(s) futuro(s) nesta cadeira. Remaneje-os antes de desativar.`);
      }
      await q("update chairs set name=$2, is_active=$3 where id=$1 and unit_id=$4", [input.id, name, input.isActive ?? true, ctx.unitId]);
    } else await q("insert into chairs(unit_id,name,is_active) values ($1,$2,$3)", [ctx.unitId, name, input.isActive ?? true]);
    await audit(q, ctx, "CADEIRA_SALVA", "chair", input.id ?? null, null, { name, active: input.isActive ?? true });
  });
}

export interface StaffInput { id?: string; name: string; phone?: string | null; contractType?: string | null; color?: string; isActive?: boolean; userId?: string | null; schedules?: { day: number; start: string; end: string }[] }
export async function saveStaff(db: Db, ctx: Ctx, input: StaffInput) {
  need(ctx, "admin.catalog");
  const name = requireText(input.name, "Nome do profissional");
  if (input.contractType && !["clt", "pj", "autonomo", "proprietario"].includes(input.contractType)) throw new DomainError("invalid", "Vínculo inválido.");
  return db.tx(async (q) => {
    let id = input.id;
    if (id) {
      if (input.isActive === false) {
        const [f] = await q<{ n: number }>("select count(*) as n from appointments where staff_id=$1 and status in ('agendado','em_atendimento') and starts_at > now()", [id]);
        if (f.n > 0) throw new DomainError("has_future", `Há ${f.n} agendamento(s) futuro(s) deste profissional. Remaneje-os antes de desativar.`);
      }
      await q("update staff set name=$2, phone=$3, contract_type=$4, color=$5, is_active=$6, user_id=coalesce($7, user_id) where id=$1 and unit_id=$8", [
        id, name, input.phone ?? null, input.contractType || null, input.color ?? "#8B6B4A", input.isActive ?? true, input.userId || null, ctx.unitId,
      ]);
    } else {
      const [r] = await q<{ id: string }>("insert into staff(unit_id,name,phone,contract_type,color,is_active,user_id) values ($1,$2,$3,$4,$5,$6,$7) returning id", [
        ctx.unitId, name, input.phone ?? null, input.contractType || null, input.color ?? "#8B6B4A", input.isActive ?? true, input.userId || null,
      ]);
      id = r.id;
    }
    if (input.schedules) {
      await q("delete from staff_schedules where staff_id=$1", [id]);
      for (const s of input.schedules) {
        if (s.end <= s.start) throw new DomainError("invalid", "O horário final deve ser depois do inicial.");
        await q("insert into staff_schedules(staff_id,day_of_week,start_time,end_time) values ($1,$2,$3,$4)", [id, s.day, s.start, s.end]);
      }
    }
    await audit(q, ctx, input.id ? "PROFISSIONAL_EDITADO" : "PROFISSIONAL_CRIADO", "staff", id!, null, { name, contract: input.contractType ?? null });
    return id!;
  });
}

export async function saveFinancialCategory(db: Db, ctx: Ctx, input: { id?: string; name: string; kind: string; accountCode?: string | null; isActive?: boolean }) {
  need(ctx, "admin.settings");
  const name = requireText(input.name, "Nome da categoria");
  if (!["receita", "custo", "despesa", "imposto", "nao_operacional", "pro_labore", "distribuicao_lucros"].includes(input.kind)) throw new DomainError("invalid", "Tipo inválido.");
  await db.tx(async (q) => {
    if (input.id) {
      if (input.isActive === false) {
        const [u] = await q<{ n: number }>("select count(*) as n from payables where category_id=$1 and status='ativo'", [input.id]);
        if (u.n > 0) throw new DomainError("in_use", "Categoria com lançamentos: não pode ser desativada, apenas renomeada.");
      }
      await q("update financial_categories set name=$2, kind=$3, account_code=$4, is_active=$5 where id=$1 and unit_id=$6", [input.id, name, input.kind, input.accountCode ?? null, input.isActive ?? true, ctx.unitId]);
    } else await q("insert into financial_categories(unit_id,name,kind,account_code,is_active) values ($1,$2,$3,$4,$5)", [ctx.unitId, name, input.kind, input.accountCode ?? null, input.isActive ?? true]);
    await audit(q, ctx, "CATEGORIA_FINANCEIRA_SALVA", "financial_category", input.id ?? null, null, { name, kind: input.kind });
  });
}

export async function saveFinancialAccount(db: Db, ctx: Ctx, input: { id?: string; name: string; kind: string; openingBalanceCents?: number; isActive?: boolean }) {
  need(ctx, "admin.settings");
  const name = requireText(input.name, "Nome da conta");
  if (!["caixa", "banco", "virtual"].includes(input.kind)) throw new DomainError("invalid", "Tipo de conta inválido.");
  await db.tx(async (q) => {
    if (input.id) await q("update financial_accounts set name=$2, kind=$3, opening_balance_cents=$4, is_active=$5 where id=$1 and unit_id=$6", [input.id, name, input.kind, input.openingBalanceCents ?? 0, input.isActive ?? true, ctx.unitId]);
    else await q("insert into financial_accounts(unit_id,name,kind,opening_balance_cents,is_active) values ($1,$2,$3,$4,$5)", [ctx.unitId, name, input.kind, input.openingBalanceCents ?? 0, input.isActive ?? true]);
    await audit(q, ctx, "CONTA_FINANCEIRA_SALVA", "financial_account", input.id ?? null, null, { name, kind: input.kind, opening: input.openingBalanceCents ?? 0 });
  });
}

export type SettingsPatch = Partial<Omit<UnitSettings, "unit_id" | "currency" | "timezone">>;
export async function updateSettings(db: Db, ctx: Ctx, patch: SettingsPatch) {
  need(ctx, "admin.settings");
  await db.tx(async (q) => {
    const before = await getSettings(q, ctx.unitId);
    const next = { ...before, ...patch };
    if (next.discount_limit_bps != null && (next.discount_limit_bps < 0 || next.discount_limit_bps > 10000)) throw new DomainError("invalid", "Limite de desconto inválido.");
    if (next.retroactive_edit_days < 0) throw new DomainError("invalid", "Janela retroativa inválida.");
    await q(
      `update unit_settings set business_hours=$2, retroactive_edit_days=$3, discount_owner_only=$4, discount_limit_bps=$5, no_show_policy=$6, no_show_fee_cents=$7,
         tax_regime=$8, customer_retention_months=$9, notification_channels=$10, mfa_required=$11, updated_at=now(), updated_by=$12 where unit_id=$1`,
      [ctx.unitId, JSON.stringify(next.business_hours), next.retroactive_edit_days, next.discount_owner_only, next.discount_limit_bps, next.no_show_policy, next.no_show_fee_cents,
        next.tax_regime, next.customer_retention_months, JSON.stringify(next.notification_channels), next.mfa_required, ctx.userId],
    );
    await audit(q, ctx, "CONFIGURACAO_ALTERADA", "unit_settings", ctx.unitId, before, next);
  });
}

export async function listCatalog(db: Db, unitId: string) {
  const q = db.query;
  const [chairs, staff, methods, accounts, categories, finCats, svcCats] = await Promise.all([
    q<{ id: string; name: string; is_active: boolean }>("select id,name,is_active from chairs where unit_id=$1 order by name", [unitId]),
    q<{ id: string; name: string; phone: string | null; contract_type: string | null; color: string; is_active: boolean; user_id: string | null }>("select id,name,phone,contract_type,color,is_active,user_id from staff where unit_id=$1 order by name", [unitId]),
    q<{ id: string; name: string; kind: string; fee_bps: number; fee_fixed_cents: number; settlement_days: number; account_id: string | null; is_active: boolean; sort_order: number }>("select * from payment_methods where unit_id=$1 order by sort_order, name", [unitId]),
    q<{ id: string; name: string; kind: string; opening_balance_cents: number; is_active: boolean }>("select id,name,kind,opening_balance_cents,is_active from financial_accounts where unit_id=$1 order by name", [unitId]),
    q<{ id: string; name: string; kind: string; account_code: string | null; is_active: boolean }>("select id,name,kind,account_code,is_active from financial_categories where unit_id=$1 order by kind, sort_order, name", [unitId]),
    q<{ id: string; name: string; kind: string; account_code: string | null; is_active: boolean }>("select id,name,kind,account_code,is_active from financial_categories where unit_id=$1 and is_active order by kind, sort_order, name", [unitId]),
    q<{ id: string; name: string; sort_order: number; is_active: boolean }>("select id,name,sort_order,is_active from service_categories where unit_id=$1 order by sort_order, name", [unitId]),
  ]);
  const schedules = await q<{ staff_id: string; day_of_week: number; start_time: string; end_time: string }>(
    "select ss.staff_id, ss.day_of_week, to_char(ss.start_time,'HH24:MI') as start_time, to_char(ss.end_time,'HH24:MI') as end_time from staff_schedules ss join staff s on s.id=ss.staff_id where s.unit_id=$1 order by ss.day_of_week, ss.start_time",
    [unitId],
  );
  return { chairs, staff, methods, accounts, categories, finCats, svcCats, schedules };
}

export async function updateBusinessHours(db: Db, ctx: Ctx, hours: Record<string, [string, string][]>) {
  need(ctx, "admin.schedules", "admin.settings");
  for (const [d, wins] of Object.entries(hours)) {
    if (!/^[0-6]$/.test(d)) throw new DomainError("invalid", "Dia da semana inválido.");
    for (const [a, b] of wins) if (!/^\d{2}:\d{2}$/.test(a) || !/^\d{2}:\d{2}$/.test(b) || b <= a) throw new DomainError("invalid", "O horário final deve ser depois do inicial.");
  }
  await db.tx(async (q) => {
    const before = await getSettings(q, ctx.unitId);
    await q("update unit_settings set business_hours=$2, updated_at=now(), updated_by=$3 where unit_id=$1", [ctx.unitId, JSON.stringify(hours), ctx.userId]);
    await audit(q, ctx, "HORARIO_FUNCIONAMENTO_ALTERADO", "unit_settings", ctx.unitId, { business_hours: before.business_hours }, { business_hours: hours });
  });
}
