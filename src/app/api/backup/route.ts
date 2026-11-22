import { getDb } from "@/server/db";
import { currentSession } from "@/server/session";
import { exportBackup } from "@/server/services/ops";
import { isDomainError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await currentSession();
  if (!s || !s.mfaVerified) return new Response("Não autenticado", { status: 401 });
  try {
    const out = await exportBackup(await getDb(), s.ctx);
    return new Response(out.json, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${out.filename}"`, "cache-control": "no-store" } });
  } catch (e) {
    if (isDomainError(e)) return new Response(e.message, { status: e.code === "forbidden" ? 403 : 400 });
    console.error("[backup]", e);
    return new Response("Erro ao gerar o backup", { status: 500 });
  }
}
