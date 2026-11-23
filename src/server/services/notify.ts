import type { Db, Q } from "../db";
import { can } from "../core";
import type { Ctx } from "../permissions";

/** Grupos de preferência. O aviso sempre entra na central; a preferência controla só o push no celular. */
export const NOTIFY_GROUPS = [
  { key: "tarefas", label: "Tarefas atribuídas a mim", prefixes: ["tarefa_"] },
  { key: "lembretes_tarefas", label: "Lembretes de prazo e atraso de tarefas", prefixes: ["prazo_"] },
  { key: "agenda", label: "Agenda (novos, cancelados, reagendados)", prefixes: ["novo_agendamento", "agendamento_", "lembrete_cliente"] },
  { key: "retornos", label: "Clientes para retornar", prefixes: ["retorno_"] },
  { key: "conquistas", label: "Conquistas e recordes", prefixes: ["recorde_"] },
  { key: "sistema", label: "Saúde do sistema (falhas de rotinas)", prefixes: ["sistema_"] },
  { key: "financeiro", label: "Financeiro, caixa e comissões", prefixes: [""] },
] as const;
export const groupOf = (kind: string) => NOTIFY_GROUPS.find((g) => g.prefixes.some((p) => kind.startsWith(p)))!.key;

export interface NotifyInput { unitId: string; userIds: string[]; kind: string; message: string; url: string; severity?: "info" | "atencao" | "critico"; ref?: [string, string]; dedupe: string }

/** Um aviso por destinatário. `dedupe` + usuário garante que o mesmo aviso não se repete. */
export async function notifyUsers(q: Q, n: NotifyInput): Promise<number> {
  let sent = 0;
  for (const uid of new Set(n.userIds)) {
    const r = await q(
      "insert into notifications(unit_id,user_id,kind,severity,message,url,ref_entity,ref_id,dedupe_key) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (dedupe_key) do nothing returning id",
      [n.unitId, uid, n.kind, n.severity ?? "info", n.message, n.url, n.ref?.[0] ?? null, n.ref?.[1] ?? null, `${n.dedupe}:${uid}`],
    );
    sent += r.length;
  }
  return sent;
}

const seesUnit = (ctx: Ctx) => can(ctx, "finance.view") || can(ctx, "dashboard.full");
const SCOPE = "n.unit_id=$1 and (n.user_id=$2 or (n.user_id is null and $3::boolean))";

export interface NotificationRow { id: string; kind: string; severity: string; message: string; url: string | null; created_at: Date; is_read: boolean; ref_entity: string | null; ref_id: string | null }

export async function listNotifications(db: Db, ctx: Ctx, opts: { unreadOnly?: boolean; limit?: number; offset?: number } = {}) {
  const rows = await db.query<NotificationRow & { total: number }>(
    `select n.id, n.kind, n.severity, n.message, n.url, n.created_at, n.ref_entity, n.ref_id, (r.user_id is not null) as is_read, count(*) over()::bigint as total
     from notifications n left join notification_reads r on r.notification_id=n.id and r.user_id=$2
     where ${SCOPE} and (not $4::boolean or r.user_id is null)
     order by n.created_at desc limit $5 offset $6`,
    [ctx.unitId, ctx.userId, seesUnit(ctx), opts.unreadOnly ?? false, opts.limit ?? 50, opts.offset ?? 0],
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

export async function unreadCount(db: Db, ctx: Ctx): Promise<number> {
  const [r] = await db.query<{ n: number }>(
    `select count(*)::bigint as n from notifications n where ${SCOPE} and not exists (select 1 from notification_reads r where r.notification_id=n.id and r.user_id=$2)`,
    [ctx.unitId, ctx.userId, seesUnit(ctx)],
  );
  return r.n;
}

export async function markRead(db: Db, ctx: Ctx, id?: string) {
  await db.query(
    `insert into notification_reads(notification_id,user_id) select n.id, $2::uuid from notifications n where ${SCOPE} and ($4::uuid is null or n.id=$4) on conflict do nothing`,
    [ctx.unitId, ctx.userId, seesUnit(ctx), id ?? null],
  );
}

/** Texto do push: sem valores em dinheiro nem motivos livres na tela bloqueada. */
export const safeBody = (message: string) => message.replace(/R\$\s?-?[\d.]+(,\d{1,2})?/g, "valor no app").replace(/\s*\([^)]*\)/g, "").slice(0, 180);
