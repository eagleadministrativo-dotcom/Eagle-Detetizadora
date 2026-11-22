import type { Q } from "./db";
import { DomainError, ForbiddenError } from "./errors";
import type { Ctx, Permission } from "./permissions";

export const can = (ctx: Ctx, p: Permission) => ctx.perms.has(p);
export function need(ctx: Ctx, ...anyOf: Permission[]) {
  if (!anyOf.some((p) => ctx.perms.has(p))) throw new ForbiddenError();
}

export async function audit(
  q: Q,
  ctx: { userId?: string | null; unitId?: string | null },
  action: string,
  entity: string,
  entityId: string | null,
  before?: unknown,
  after?: unknown,
  note?: string,
) {
  await q(
    "insert into audit_logs(unit_id,user_id,action,entity,entity_id,before,after,note) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [ctx.unitId ?? null, ctx.userId ?? null, action, entity, entityId, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), note ?? null],
  );
}

export interface UnitSettings {
  unit_id: string;
  timezone: string;
  currency: string;
  business_hours: Record<string, [string, string][]>;
  retroactive_edit_days: number;
  discount_owner_only: boolean;
  discount_limit_bps: number | null;
  no_show_policy: "apenas_registrar" | "cobrar_taxa";
  no_show_fee_cents: number | null;
  tax_regime: string | null;
  customer_retention_months: number | null;
  notification_channels: string[];
  mfa_required: boolean;
}

export async function getSettings(q: Q, unitId: string): Promise<UnitSettings> {
  const [s] = await q<UnitSettings>("select * from unit_settings where unit_id = $1", [unitId]);
  if (!s) throw new DomainError("no_settings", "Unidade sem configurações.");
  return s;
}

export function requireText(v: unknown, label: string, min = 1): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length < min) throw new DomainError("invalid", min > 1 ? `${label}: informe pelo menos ${min} caracteres.` : `${label} é obrigatório.`);
  return s;
}

export function requirePositive(v: unknown, label: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) throw new DomainError("invalid", `${label} deve ser maior que zero.`);
  return v;
}

export function requireNonNegative(v: unknown, label: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new DomainError("invalid", `${label} inválido.`);
  return v;
}

export const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requireUuid(v: unknown, label: string): string {
  if (typeof v !== "string" || !uuidRe.test(v)) throw new DomainError("invalid", `${label} inválido.`);
  return v;
}

/** Registra execução de automação; devolve false se a mesma chave de idempotência já teve sucesso. */
export async function startAutomation(q: Q, id: string, unitId: string | null, key: string | null, trigger: string, input?: unknown): Promise<boolean> {
  if (key) {
    const [dup] = await q("select 1 from automation_runs where automation_id=$1 and idempotency_key=$2 and status='sucesso'", [id, key]);
    if (dup) {
      await q("insert into automation_runs(automation_id,unit_id,status,trigger_event,input) values ($1,$2,'ignorado',$3,$4)", [id, unitId, trigger, JSON.stringify(input ?? null)]);
      return false;
    }
  }
  return true;
}
export async function finishAutomation(q: Q, id: string, unitId: string | null, key: string | null, trigger: string, input: unknown, output: unknown) {
  await q(
    "insert into automation_runs(automation_id,unit_id,idempotency_key,status,trigger_event,input,output) values ($1,$2,$3,'sucesso',$4,$5,$6)",
    [id, unitId, key, trigger, JSON.stringify(input ?? null), JSON.stringify(output ?? null)],
  );
}

/** Impede lançamentos com data dentro de um período financeiro já fechado. */
export async function assertPeriodOpen(q: Q, unitId: string, ymd: string) {
  const [c] = await q<{ period_start: string; period_end: string }>(
    `select to_char(period_start,'YYYY-MM-DD') as period_start, to_char(period_end,'YYYY-MM-DD') as period_end from period_closures pc
     where pc.unit_id=$1 and pc.status='fechado' and $2::date between pc.period_start and pc.period_end
       and pc.version = (select max(version) from period_closures x where x.unit_id=pc.unit_id and x.period_start=pc.period_start) limit 1`,
    [unitId, ymd],
  );
  if (c) throw new DomainError("period_closed", `O período ${c.period_start.split("-").reverse().join("/")} a ${c.period_end.split("-").reverse().join("/")} está fechado. Para alterar, reabra o período.`);
}
