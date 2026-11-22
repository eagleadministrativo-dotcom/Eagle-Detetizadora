import crypto from "node:crypto";
import { getDb } from "@/server/db";
import { runReminders } from "@/server/services/reminders";
import { flushPush } from "@/server/services/push";

export const dynamic = "force-dynamic";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** Lembretes de 30 min e envio de push. Chamado a cada poucos minutos por um agendador externo. */
export async function GET(req: Request) {
  const ok = authorized(req);
  if (ok === null) return new Response("CRON_SECRET não configurado", { status: 503 });
  if (!ok) return new Response("Não autorizado", { status: 401 });
  const db = await getDb();
  const reminders = await runReminders(db).catch((e) => ({ error: (e as Error).message }));
  const push = await flushPush(db).catch((e) => ({ error: (e as Error).message }));
  return Response.json({ ok: true, reminders, push });
}
