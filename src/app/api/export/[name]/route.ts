import { getDb } from "@/server/db";
import { currentSession } from "@/server/session";
import { DATASETS, exportDataset, type Dataset } from "@/server/services/ops";
import { isDomainError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const s = await currentSession();
  if (!s || !s.mfaVerified) return new Response("Não autenticado", { status: 401 });
  if (!(DATASETS as readonly string[]).includes(name)) return new Response("Conjunto de dados inválido", { status: 404 });
  try {
    const out = await exportDataset(await getDb(), s.ctx, name as Dataset);
    return new Response(out.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${out.filename}"`, "cache-control": "no-store" } });
  } catch (e) {
    if (isDomainError(e)) return new Response(e.message, { status: e.code === "forbidden" ? 403 : 400 });
    console.error("[export]", e);
    return new Response("Erro ao exportar", { status: 500 });
  }
}
