import type { Db } from "../db";
import { DomainError } from "../errors";
import { groupOf, safeBody } from "./notify";

/** Notificações push (Web Push / VAPID). Sem as chaves VAPID configuradas, tudo aqui fica desligado e inofensivo. */
export interface PushSubscriptionInput { endpoint: string; keys: { p256dh: string; auth: string } }
export interface PushPayload { title: string; body: string; url: string; tag: string; severity: string }
export type PushSender = (sub: { endpoint: string; p256dh: string; auth: string }, payload: PushPayload) => Promise<void>;

export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || null;
export const pushConfigured = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

export function validateSubscription(sub: unknown): PushSubscriptionInput {
  const s = sub as Partial<PushSubscriptionInput> | null;
  const ok = s && typeof s.endpoint === "string" && s.endpoint.startsWith("https://") && s.endpoint.length < 1000
    && s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string" && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;
  if (!ok) throw new DomainError("invalid", "Inscrição de notificações inválida.");
  return s as PushSubscriptionInput;
}

export async function saveSubscription(db: Db, userId: string, sub: PushSubscriptionInput, userAgent?: string | null) {
  await db.query(
    `insert into push_subscriptions(user_id,endpoint,p256dh,auth,user_agent) values ($1,$2,$3,$4,$5)
     on conflict (endpoint) do update set user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth, user_agent=excluded.user_agent`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent?.slice(0, 300) ?? null],
  );
}

export async function removeSubscription(db: Db, userId: string, endpoint: string) {
  await db.query("delete from push_subscriptions where user_id=$1 and endpoint=$2", [userId, endpoint]);
}

export async function countSubscriptions(db: Db, userId: string) {
  const [r] = await db.query<{ n: number }>("select count(*)::bigint as n from push_subscriptions where user_id=$1", [userId]);
  return r.n;
}

async function defaultSender(): Promise<PushSender> {
  const mod = (await import("web-push")) as unknown as { default?: typeof import("web-push") } & typeof import("web-push");
  const webpush = mod.default ?? mod; // interoperabilidade ESM/CommonJS no bundle de produção
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contato@marfim.local", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  return async (sub, payload) => {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 12, urgency: payload.severity === "critico" ? "high" : "normal" });
  };
}

const TITLES: Record<string, string> = { critico: "MARFIM · Alerta crítico", atencao: "MARFIM · Atenção", info: "MARFIM" };

/**
 * Envia por push os avisos ainda não enviados (últimas 48 h). Cada aviso é "reivindicado" de forma atômica
 * (pushed_at), então chamadas concorrentes não duplicam o envio. Destinatários: proprietário e gerente da
 * unidade (ou só o usuário indicado, se o aviso for pessoal). Inscrições expiradas (404/410) são removidas.
 */
export async function flushPush(db: Db, send?: PushSender): Promise<{ notifications: number; sent: number; removed: number }> {
  if (!send && !pushConfigured()) return { notifications: 0, sent: 0, removed: 0 };
  const claimed = await db.query<{ id: string; unit_id: string; user_id: string | null; severity: string; message: string; kind: string; url: string | null }>(
    "update notifications set pushed_at=now() where pushed_at is null and created_at > now() - interval '48 hours' returning id, unit_id, user_id, severity, message, kind, url",
  );
  if (!claimed.length) return { notifications: 0, sent: 0, removed: 0 };
  let sender: PushSender;
  try {
    sender = send ?? (await defaultSender());
  } catch (e) {
    // não perde os avisos: devolve para a fila e tenta de novo na próxima chamada
    await db.query("update notifications set pushed_at=null where id = any($1::uuid[])", [claimed.map((n) => n.id)]);
    throw e;
  }
  let sent = 0;
  let removed = 0;
  for (const n of claimed) {
    const subs = await db.query<{ endpoint: string; p256dh: string; auth: string; user_id: string; notify: Record<string, boolean> | null }>(
      `select distinct on (s.endpoint) s.endpoint, s.p256dh, s.auth, s.user_id, (select p.notify from user_preferences p where p.user_id=s.user_id) as notify from push_subscriptions s
         join users u on u.id=s.user_id and u.is_active
         join user_units uu on uu.user_id=s.user_id and uu.unit_id=$1
        where s.user_id=$2::uuid or ($2::uuid is null and (uu.role='proprietario' or (uu.role='gerente' and not exists (select 1 from permission_overrides o where o.user_id=s.user_id and o.unit_id=$1 and o.permission in ('finance.view','dashboard.full') and not o.granted))))`,
      [n.unit_id, n.user_id],
    );
    const payload: PushPayload = { title: TITLES[n.severity] ?? "MARFIM", body: safeBody(n.message), url: n.url ?? "/notificacoes", tag: n.id, severity: n.severity };
    const log = (userId: string | null, status: string, error?: string) => db.query("insert into notification_deliveries(notification_id,user_id,status,error) values ($1,$2,$3,$4)", [n.id, userId, status, error ?? null]);
    if (!subs.length) await log(n.user_id, "sem_dispositivo");
    for (const sub of subs) {
      if (sub.notify?.[groupOf(n.kind)] === false) { await log(sub.user_id, "silenciado"); continue; }
      try {
        await sender(sub, payload);
        sent++;
        await log(sub.user_id, "enviado");
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.query("delete from push_subscriptions where endpoint=$1", [sub.endpoint]);
          removed++;
          await log(sub.user_id, "expirado", String(status));
        } else { await log(sub.user_id, "falha", String(status ?? (e as Error).message).slice(0, 200)); console.error("[push] falha ao enviar", status ?? (e as Error).message); }
      }
    }
  }
  return { notifications: claimed.length, sent, removed };
}
