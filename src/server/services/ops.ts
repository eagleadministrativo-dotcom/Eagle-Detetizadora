import type { Db, Q } from "../db";
import { audit, can, finishAutomation, need, startAutomation } from "../core";
import { DomainError } from "../errors";
import { buildPerms, type Ctx } from "../permissions";
import { addDays, fmtYmd, monthEnd, todayYmd } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { alertDueDates, generateRecurringPayables } from "./finance";
import { computeDre, getCashFlow, goalsProgress } from "./reports";
import { dayEndUtc, dayStartUtc } from "@/lib/dates";

const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
export const systemCtx = (unitId: string): Ctx => ({ userId: SYSTEM_USER, unitId, role: "proprietario", perms: buildPerms("proprietario", []) });

async function notify(db: Db, unitId: string, kind: string, severity: string, message: string, dedupe: string, ref?: [string, string]) {
  const r = await db.query("insert into notifications(unit_id,kind,severity,message,ref_entity,ref_id,dedupe_key) values ($1,$2,$3,$4,$5,$6,$7) on conflict (dedupe_key) do nothing returning id", [unitId, kind, severity, message, ref?.[0] ?? null, ref?.[1] ?? null, dedupe]);
  return r.length;
}

/** Rotinas diárias (A07, A08, A10, A11, A12, A13, A14). Idempotente por dia; seguro chamar várias vezes. */
export async function runDailyJobs(db: Db, unitId: string, today = todayYmd()) {
  const key = `daily:${today}`;
  const first = await db.tx((q) => startAutomation(q, "DAILY", unitId, key, "ROTINA_DIARIA"));
  if (!first) return { skipped: true };
  const out: Record<string, unknown> = {};
  const ctx = systemCtx(unitId);
  try {
    out.A07 = await generateRecurringPayables(db, unitId, today);
    out.A08 = await alertDueDates(db, unitId, today);

    const flow = await getCashFlow(db, ctx, { start: today, end: today }, 30);
    out.A10 = { firstNegative: flow.firstNegative };
    if (flow.firstNegative) await notify(db, unitId, "caixa_negativo", "critico", `Risco de caixa negativo previsto para ${fmtYmd(flow.firstNegative)} (estimativa baseada em contas e cobranças em aberto).`, `cashneg:${flow.firstNegative}`);

    const goals = await goalsProgress(db, ctx);
    for (const g of goals.filter((x) => x.isActive)) {
      const week = `${today.slice(0, 4)}-${Math.floor((Number(today.slice(5, 7)) * 31 + Number(today.slice(8, 10))) / 7)}`;
      if (g.status === "atrasada") await notify(db, unitId, "meta_atrasada", "atencao", `Meta "${g.name}" abaixo do ritmo esperado (${g.pct?.toFixed(0)}% atingido, esperado ${g.expectedPct?.toFixed(0)}%).`, `goal:${g.id}:${week}`);
      if (g.status === "atingida") await notify(db, unitId, "meta_atingida", "info", `Meta "${g.name}" atingida.`, `goaldone:${g.id}`);
    }
    out.A11 = { goals: goals.length };

    if (today === monthEnd(today)) {
      for (const g of goals.filter((x) => x.isActive && x.kind === "reserva" && x.pct != null && x.pct < 100)) {
        await notify(db, unitId, "reserva_insuficiente", "atencao", `Reserva abaixo da meta "${g.name}": ${fmtBRL(g.current)} de ${fmtBRL(g.target)}.`, `reserve:${g.id}:${today.slice(0, 7)}`);
      }
    }
    if (new Date(Date.parse(`${today}T12:00:00Z`)).getUTCDay() === 0) {
      const cur = await computeDre(db.query, unitId, { start: addDays(today, -6), end: today });
      const prev = await computeDre(db.query, unitId, { start: addDays(today, -13), end: addDays(today, -7) });
      if (cur.contributionRatio != null && prev.contributionRatio != null && prev.contributionRatio - cur.contributionRatio > 0.05) {
        await notify(db, unitId, "queda_margem", "atencao", `Margem de contribuição caiu de ${(prev.contributionRatio * 100).toFixed(1)}% para ${(cur.contributionRatio * 100).toFixed(1)}% na última semana.`, `margin:${today}`);
      }
      out.A13 = { cur: cur.contributionRatio, prev: prev.contributionRatio };
    }

    const y = addDays(today, -1);
    const [s] = await db.query<{ n: number; rev: number }>("select count(*)::bigint as n, coalesce(sum(total_cents),0)::bigint as rev from attendances where unit_id=$1 and status='concluido' and finished_at >= $2 and finished_at < $3", [unitId, dayStartUtc(y), dayEndUtc(y)]);
    if (s.n > 0) await notify(db, unitId, "resumo_diario", "info", `Resumo de ${fmtYmd(y)}: ${s.n} atendimento(s), receita operacional de ${fmtBRL(s.rev)}.`, `summary:${y}`);
    out.A14 = { yesterday: y, attendances: s.n };

    await db.tx((q) => finishAutomation(q, "DAILY", unitId, key, "ROTINA_DIARIA", { today }, out));
    return { skipped: false, out };
  } catch (e) {
    await db.query("insert into automation_runs(automation_id,unit_id,status,trigger_event,error) values ('DAILY',$1,'erro','ROTINA_DIARIA',$2)", [unitId, (e as Error).message]);
    throw e;
  }
}

// ---------- notificações ----------
export async function listNotifications(db: Db, ctx: Ctx, limit = 50) {
  need(ctx, "finance.view", "dashboard.full");
  return db.query<{ id: string; kind: string; severity: string; message: string; is_read: boolean; created_at: Date; ref_entity: string | null; ref_id: string | null }>(
    "select id, kind, severity, message, is_read, created_at, ref_entity, ref_id from notifications where unit_id=$1 order by created_at desc limit $2", [ctx.unitId, limit]);
}
export async function markNotificationsRead(db: Db, ctx: Ctx, ids?: string[]) {
  need(ctx, "finance.view", "dashboard.full");
  await db.query("update notifications set is_read=true where unit_id=$1 and ($2::uuid[] is null or id = any($2::uuid[]))", [ctx.unitId, ids ?? null]);
}
export async function unreadCount(db: Db, ctx: Ctx) {
  if (!can(ctx, "finance.view") && !can(ctx, "dashboard.full")) return 0;
  const [r] = await db.query<{ n: number }>("select count(*)::bigint as n from notifications where unit_id=$1 and not is_read", [ctx.unitId]);
  return r.n;
}

// ---------- auditoria ----------
export async function listAudit(db: Db, ctx: Ctx, opts: { entity?: string; userId?: string; action?: string; limit?: number; offset?: number } = {}) {
  need(ctx, "audit.view");
  const rows = await db.query<{ id: number; created_at: Date; action: string; entity: string; entity_id: string | null; user_name: string | null; before: unknown; after: unknown; note: string | null; total: number }>(
    `select a.id, a.created_at, a.action, a.entity, a.entity_id, u.full_name as user_name, a.before, a.after, a.note, count(*) over() as total
     from audit_logs a left join users u on u.id=a.user_id where (a.unit_id=$1 or a.unit_id is null) and ($2::text is null or a.entity=$2) and ($3::uuid is null or a.user_id=$3) and ($4::text is null or a.action ilike $4)
     order by a.id desc limit $5 offset $6`,
    [ctx.unitId, opts.entity ?? null, opts.userId ?? null, opts.action ? `%${opts.action}%` : null, opts.limit ?? 50, opts.offset ?? 0],
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

// ---------- exportação ----------
const csvCell = (v: unknown) => {
  if (v == null) return "";
  let s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // evita injeção de fórmula em planilhas
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  return "﻿" + [cols.join(";"), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(";"))].join("\r\n");
};

export const DATASETS = ["atendimentos", "pagamentos", "contas_a_pagar", "contas_a_receber", "clientes", "auditoria"] as const;
export type Dataset = (typeof DATASETS)[number];

export async function exportDataset(db: Db, ctx: Ctx, name: Dataset): Promise<{ filename: string; csv: string }> {
  need(ctx, "data.export", "reports.export");
  const q = db.query;
  const u = ctx.unitId;
  let rows: Record<string, unknown>[] = [];
  if (name === "atendimentos") rows = await q("select a.id, a.finished_at as concluido_em, c.name as cliente, s.name as profissional, a.subtotal_cents/100.0 as subtotal, a.discount_cents/100.0 as desconto, a.total_cents/100.0 as total, a.status from attendances a join customers c on c.id=a.customer_id join staff s on s.id=a.staff_id where a.unit_id=$1 order by a.started_at", [u]);
  else if (name === "pagamentos") { need(ctx, "finance.view"); rows = await q("select p.id, p.paid_at as data, m.name as forma, p.kind as tipo, p.status, p.amount_cents/100.0 as valor, p.fee_cents/100.0 as taxa, p.reference as referencia, p.confirmation_evidence as evidencia from payments p join payment_methods m on m.id=p.method_id where p.unit_id=$1 order by p.paid_at", [u]); }
  else if (name === "contas_a_pagar") { need(ctx, "finance.view"); rows = await q("select p.id, p.description as descricao, c.name as categoria, p.amount_cents/100.0 as valor, b.paid_cents/100.0 as pago, p.due_date as vencimento, p.status from payables p join payable_balances b on b.payable_id=p.id join financial_categories c on c.id=p.category_id where p.unit_id=$1 order by p.due_date", [u]); }
  else if (name === "contas_a_receber") { need(ctx, "finance.view"); rows = await q("select r.id, r.description as descricao, r.amount_due_cents/100.0 as valor, b.registered_cents/100.0 as registrado, b.confirmed_cents/100.0 as confirmado, b.settled_cents/100.0 as liquidado, r.due_date as vencimento, r.status from receivables r join receivable_balances b on b.receivable_id=r.id where r.unit_id=$1 order by r.created_at", [u]); }
  else if (name === "clientes") { need(ctx, "customers.view", "data.export"); rows = await q("select id, name as nome, phone as telefone, email, notes as observacoes, is_active as ativo from customers where unit_id=$1 order by name", [u]); }
  else if (name === "auditoria") { need(ctx, "audit.view"); rows = await q("select id, created_at, action, entity, entity_id, user_id, note from audit_logs where unit_id=$1 or unit_id is null order by id", [u]); }
  else throw new DomainError("invalid", "Conjunto de dados inválido.");
  const db2 = db;
  await audit(db2.query, ctx, "DADOS_EXPORTADOS", "export", name, null, { rows: rows.length });
  return { filename: `marfim-${name}-${todayYmd()}.csv`, csv: toCsv(rows) };
}

/** Backup lógico completo da unidade em JSON (para migração/restauração manual). */
export async function exportBackup(db: Db, ctx: Ctx) {
  need(ctx, "data.export");
  const tables = ["organizations", "units", "unit_settings", "chairs", "staff", "staff_schedules", "schedule_blocks", "customers", "service_categories", "services", "service_staff", "service_prices", "service_custom_fields",
    "financial_accounts", "payment_methods", "financial_categories", "appointments", "appointment_services", "attendances", "attendance_items", "receivables", "cash_sessions", "payments", "cash_movements",
    "payables", "payable_payments", "capital_entries", "financial_goals", "period_closures", "audit_logs", "automation_runs", "notifications"];
  const data: Record<string, unknown[]> = {};
  for (const t of tables) data[t] = await db.query(`select * from ${t}`);
  data.users = await db.query("select id, email, full_name, is_active, created_at from users");
  data.user_units = await db.query("select * from user_units");
  await audit(db.query, ctx, "BACKUP_EXPORTADO", "export", "backup", null, { tables: tables.length });
  return { filename: `marfim-backup-${todayYmd()}.json`, json: JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data }, null, 2) };
}


const RESTORE_ORDER = ["organizations", "units", "unit_settings", "chairs", "staff", "staff_schedules", "schedule_blocks", "customers", "service_categories", "services", "service_staff", "service_prices",
  "service_custom_fields", "financial_accounts", "payment_methods", "financial_categories", "appointments", "appointment_services", "attendances", "attendance_items", "receivables", "cash_sessions",
  "payments", "cash_movements", "payables", "payable_payments", "capital_entries", "financial_goals", "period_closures", "audit_logs", "automation_runs", "notifications"];

/**
 * Restaura um backup lógico (exportBackup) em um banco VAZIO (somente com as migrações aplicadas).
 * Senhas e segredos não fazem parte do backup: todos os usuários voltam com acesso bloqueado, exceto o proprietário indicado, cuja senha é definida aqui.
 */
export async function restoreBackup(db: Db, backupJson: string, ownerEmail: string, ownerPassword: string) {
  const { hashPassword, checkPasswordStrength } = await import("../auth");
  checkPasswordStrength(ownerPassword);
  const backup = JSON.parse(backupJson) as { version: number; data: Record<string, Record<string, unknown>[]> };
  if (backup.version !== 1 || !backup.data) throw new DomainError("invalid", "Arquivo de backup inválido.");
  await db.tx(async (q) => {
    const [n] = await q<{ n: number }>("select (select count(*) from users) + (select count(*) from organizations) as n");
    if (n.n > 0) throw new DomainError("not_empty", "O banco de destino precisa estar vazio.");
    for (const t of ["organizations", "units", "unit_settings"]) await insertTable(q, t, backup.data[t]);
    await q(
      "insert into users(id,email,full_name,is_active,created_at,password_hash) select id,email,full_name,is_active,created_at,'!' from jsonb_to_recordset($1::jsonb) as x(id uuid,email text,full_name text,is_active boolean,created_at timestamptz)",
      [JSON.stringify(backup.data.users ?? [])],
    );
    await q("insert into user_units select * from jsonb_populate_recordset(null::user_units, $1::jsonb)", [JSON.stringify(backup.data.user_units ?? [])]);
    for (const t of RESTORE_ORDER.slice(3)) await insertTable(q, t, backup.data[t]);
    await q("select setval(pg_get_serial_sequence('audit_logs','id'), greatest((select coalesce(max(id),1) from audit_logs),1))");
    const r = await q("update users set password_hash=$2 where lower(email)=lower($1) and id in (select user_id from user_units where role='proprietario') returning id", [ownerEmail, hashPassword(ownerPassword)]);
    if (!r.length) throw new DomainError("no_owner", "Nenhum proprietário com esse e-mail no backup.");
  });
  return { tables: RESTORE_ORDER.length + 2 };
}

async function insertTable(q: Q, table: string, rows: Record<string, unknown>[] | undefined) {
  if (!rows?.length) return;
  await q(`insert into ${table} select * from jsonb_populate_recordset(null::${table}, $1::jsonb)`, [JSON.stringify(rows)]);
}
