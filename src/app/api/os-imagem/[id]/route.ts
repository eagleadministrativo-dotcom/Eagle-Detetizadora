import { getDb } from "@/server/db";
import { currentSession } from "@/server/session";
import { isDomainError } from "@/server/errors";
import { getOrderImage } from "@/server/services/eagle";

export const dynamic = "force-dynamic";

/** Foto ou assinatura da OS, mostrada na tela e no documento. Só imagens (tipo conferido no envio), nunca outro conteúdo. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await currentSession();
  if (!s?.mfaVerified) return new Response("Não autorizado", { status: 401 });
  const { id } = await params;
  try {
    const f = await getOrderImage(await getDb(), s.ctx, id);
    if (!f) return new Response("Não encontrado", { status: 404 });
    return new Response(new Uint8Array(f.bytes), { headers: { "content-type": f.mime, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
  } catch (e) {
    if (isDomainError(e)) return new Response(e.message, { status: e.code === "forbidden" ? 403 : 404 });
    throw e;
  }
}
