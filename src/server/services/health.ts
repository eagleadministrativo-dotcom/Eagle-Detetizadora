import type { Db } from "../db";
import { need } from "../core";
import type { Ctx } from "../permissions";
import { notifyUsers } from "./notify";

/**
 * Saúde do sistema: cada rotina agendada fica registrada (início, fim, resultado). Se uma rotina falha, o proprietário
 * recebe um aviso (que também vira push no celular). Erros do servidor ficam em error_events, sem dados de clientes.
 */
const hasError = (v: unknown): string | null => {
  if (!v || typeof v !== "object") return null;
  if ("error" in v && typeof (v as { error: unknown }).error === "string") return (v as { error: string }).error;
  for (const x of Object.values(v)) { const e = hasError(x); if (e) return e; }
  return null;
};

export async function recordJob<T>(db: Db, job: string, fn: () => Promise<T>): Promise<T> {
  const [run] = await db.query<{ id: string }>("insert into job_runs(job) values ($1) returning id", [job]).catch(() => [{ id: "" }]);
  let result: T;
  try {
    result = await fn();
  } catch (e) {
    await finish(db, run.id, job, "erro", null, (e as Error).message);
    throw e;
  }
  const err = hasError(result);
  await finish(db, run.id, job, err ? "erro" : "ok", result, err);
  return result;
}

async function finish(db: Db, id: string, job: string, status: "ok" | "erro", summary: unknown, error: string | null) {
  if (!id) return;
  await db.query("update job_runs set finished_at=now(), status=$2, summary=$3, error=$4 where id=$1", [id, status, summary == null ? null : JSON.stringify(summary).slice(0, 8000), error?.slice(0, 2000) ?? null]).catch(() => {});
  if (status === "erro") await alertOwners(db, `Falha na rotina "${job}": ${(error ?? "erro desconhecido").slice(0, 120)}`, `sistema:${job}:${new Date().toISOString().slice(0, 13)}`).catch(() => {});
}

async function alertOwners(db: Db, message: string, dedupe: string) {
  const owners = await db.query<{ user_id: string; unit_id: string }>("select uu.user_id, uu.unit_id from user_units uu join users u on u.id=uu.user_id where uu.role='proprietario' and u.is_active");
  for (const unit of new Set(owners.map((o) => o.unit_id))) {
    await notifyUsers(db.query, { unitId: unit, userIds: owners.filter((o) => o.unit_id === unit).map((o) => o.user_id), kind: "sistema_rotina", severity: "critico", message, url: "/admin/saude", dedupe });
  }
}

/** Erro de servidor (chamado pelo onRequestError do Next). Nunca lança. */
export async function logError(db: Db, e: { message: string; stack?: string | null; path?: string | null; method?: string | null; digest?: string | null; kind?: string }) {
  await db.query("insert into error_events(kind,path,method,digest,message,stack) values ($1,$2,$3,$4,$5,$6)",
    [e.kind ?? "request", e.path?.split("?")[0].slice(0, 300) ?? null, e.method ?? null, e.digest ?? null, e.message.slice(0, 1000), e.stack?.slice(0, 4000) ?? null]).catch(() => {});
}

/**
 * Limite de tentativas por chave (ex.: "login:ip:1.2.3.4"). Janela fixa, guardada no banco para valer entre instâncias.
 * Retorna false quando a chave passou do limite dentro da janela.
 */
export async function rateLimit(db: Db, key: string, max: number, windowSec: number): Promise<boolean> {
  const [r] = await db.query<{ hits: number }>(
    `insert into rate_limits(key, window_start, hits) values ($1, now(), 1)
     on conflict (key) do update set
       hits = case when rate_limits.window_start < now() - make_interval(secs => $2) then 1 else rate_limits.hits + 1 end,
       window_start = case when rate_limits.window_start < now() - make_interval(secs => $2) then now() else rate_limits.window_start end
     returning hits`, [key.slice(0, 200), windowSec]);
  return r.hits <= max;
}

/** Limpeza: mantém 90 dias de rotinas e erros e descarta janelas de limite antigas. */
export async function pruneOps(db: Db) {
  const a = await db.query("delete from job_runs where started_at < now() - interval '90 days' returning 1");
  const b = await db.query("delete from error_events where at < now() - interval '90 days' returning 1");
  const c = await db.query("delete from rate_limits where window_start < now() - interval '1 day' returning 1");
  // rotina presa (instância caiu no meio): fecha como erro para não parecer que ainda roda
  await db.query("update job_runs set status='erro', finished_at=now(), error='Interrompida (sem término registrado)' where status='rodando' and started_at < now() - interval '30 minutes'");
  return { jobs: a.length, errors: b.length, limits: c.length };
}

export interface HealthReport {
  jobs: { job: string; last: Date | null; status: string | null; error: string | null; okRate: number | null; runs24h: number; ageMin: number }[];
  errors24h: number; recentErrors: { at: Date; path: string | null; message: string; digest: string | null }[];
  directChanges: { at: Date; table_name: string; op: string; row_id: string | null; app_name: string | null; db_user: string | null }[];
  directCount30d: number;
}

export async function healthReport(db: Db, ctx: Ctx): Promise<HealthReport> {
  need(ctx, "audit.view");
  const jobs = await db.query<HealthReport["jobs"][number]>(
    `select j.job, l.started_at as last, l.status, l.error, (extract(epoch from now() - l.started_at) / 60)::float as "ageMin",
       (select round(100.0 * count(*) filter (where status='ok') / nullif(count(*),0)) from job_runs x where x.job=j.job and x.started_at > now() - interval '7 days')::float as "okRate",
       (select count(*) from job_runs x where x.job=j.job and x.started_at > now() - interval '1 day')::bigint as "runs24h"
     from (select distinct job from job_runs) j
     cross join lateral (select started_at, status, error from job_runs x where x.job=j.job order by started_at desc limit 1) l order by j.job`);
  const [e] = await db.query<{ n: number }>("select count(*)::bigint as n from error_events where at > now() - interval '1 day'");
  const recentErrors = await db.query<HealthReport["recentErrors"][number]>("select at, path, message, digest from error_events order by at desc limit 15");
  const directChanges = await db.query<HealthReport["directChanges"][number]>("select at, table_name, op, row_id, app_name, db_user from row_changes where direct order by at desc limit 30");
  const [d] = await db.query<{ n: number }>("select count(*)::bigint as n from row_changes where direct and at > now() - interval '30 days'");
  return { jobs, errors24h: e.n, recentErrors, directChanges, directCount30d: d.n };
}
