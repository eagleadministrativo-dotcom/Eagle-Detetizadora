import crypto from "node:crypto";
import { getDb } from "@/server/db";
import { runDailyJobs } from "@/server/services/ops";
import { flushPush } from "@/server/services/push";

export const dynamic = "force-dynamic";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** Rotinas diárias (A07, A08, A10, A11, A12, A13, A14). Protegida por CRON_SECRET; idempotente por dia. */
export async function GET(req: Request) {
  const ok = authorized(req);
  if (ok === null) return new Response("CRON_SECRET não configurado", { status: 503 });
  if (!ok) return new Response("Não autorizado", { status: 401 });
  const db = await getDb();
  const units = await db.query<{ id: string }>("select id from units");
  const results: Record<string, unknown> = {};
  for (const u of units) results[u.id] = await runDailyJobs(db, u.id).catch((e) => ({ error: (e as Error).message }));
  const push = await flushPush(db).catch((e) => ({ error: (e as Error).message }));
  return Response.json({ ok: true, results, push });
}
