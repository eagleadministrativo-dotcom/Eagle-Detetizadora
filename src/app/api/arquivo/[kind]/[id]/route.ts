import { getDb } from "@/server/db";
import { currentSession } from "@/server/session";
import { isDomainError } from "@/server/errors";
import { getAttachment } from "@/server/services/tasks";
import { getEvidence } from "@/server/services/commissions";

export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const s = await currentSession();
  if (!s?.mfaVerified) return new Response("Não autorizado", { status: 401 });
  const { kind, id } = await params;
  try {
    const db = await getDb();
    const f = kind === "tarefa" ? await getAttachment(db, s.ctx, id) : kind === "comprovante" ? await getEvidence(db, s.ctx, id) : null;
    if (!f) return new Response("Não encontrado", { status: 404 });
    // sempre como download: o conteúdo enviado por usuários nunca é renderizado na origem do sistema
    return new Response(new Uint8Array(f.bytes), { headers: { "content-type": f.mime, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
  } catch (e) {
    if (isDomainError(e)) return new Response(e.message, { status: e.code === "forbidden" ? 403 : 404 });
    throw e;
  }
}
