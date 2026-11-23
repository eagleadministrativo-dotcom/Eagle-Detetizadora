import { getDb } from "@/server/db";
import { cronAuthorized } from "@/server/cron";
import { runReminders } from "@/server/services/reminders";
import { processEvents } from "@/server/services/events";
import { runTaskJobs } from "@/server/services/tasks";
import { flushPush } from "@/server/services/push";
import { recordJob } from "@/server/services/health";

export const dynamic = "force-dynamic";


/** Lembretes de 30 min e envio de push. Chamado a cada poucos minutos por um agendador externo. */
export async function GET(req: Request) {
  const ok = await cronAuthorized(req);
  if (ok === null) return new Response("CRON_SECRET não configurado", { status: 503 });
  if (!ok) return new Response("Não autorizado", { status: 401 });
  const db = await getDb();
  const out = await recordJob(db, "lembretes", async () => {
    const reminders = await runReminders(db).catch((e) => ({ error: (e as Error).message }));
    const events = await processEvents(db).catch((e) => ({ error: (e as Error).message }));
    const tasks: Record<string, unknown> = {};
    for (const u of await db.query<{ id: string }>("select id from units")) tasks[u.id] = await runTaskJobs(db, u.id).catch((e) => ({ error: (e as Error).message }));
    const push = await flushPush(db).catch((e) => ({ error: (e as Error).message }));
    return { reminders, events, tasks, push };
  });
  return Response.json({ ok: true, ...out });
}
