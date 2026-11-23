import { getDb } from "@/server/db";
import { currentSession } from "@/server/session";
import { search } from "@/server/services/access";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const s = await currentSession();
  if (!s?.mfaVerified) return Response.json({ hits: [] }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 60);
  return Response.json({ hits: await search(await getDb(), s.ctx, q) }, { headers: { "cache-control": "no-store" } });
}
