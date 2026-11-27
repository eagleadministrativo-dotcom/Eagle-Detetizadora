import { getDb } from "@/server/db";
import { currentSession } from "@/server/session";
import { getSettings } from "@/server/core";
import { isDomainError } from "@/server/errors";
import { getQuote, getServiceOrder } from "@/server/services/eagle";
import { orderDocx, quoteDocx } from "@/server/documents/docx";
import type { DocSettings } from "@/components/documents";
import { docFileName } from "@/lib/doc-format";

export const dynamic = "force-dynamic";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** OS e orçamento em Word (.docx), no modelo da Eagle. */
export async function GET(_req: Request, { params }: { params: Promise<{ tipo: string; id: string }> }) {
  const s = await currentSession();
  if (!s?.mfaVerified) return new Response("Não autorizado", { status: 401 });
  const { tipo, id } = await params;
  try {
    const db = await getDb();
    let bytes: Buffer, name: string;
    if (tipo === "os") {
      const o = await getServiceOrder(db, s.ctx, id);
      if (!o) return new Response("Não encontrado", { status: 404 });
      bytes = await orderDocx(o);
      name = docFileName("OS", o.number, o.trade_name || o.customer_name, "docx");
    } else if (tipo === "orcamento") {
      const data = await getQuote(db, s.ctx, id);
      if (!data) return new Response("Não encontrado", { status: 404 });
      bytes = await quoteDocx(data.quote, (await getSettings(db.query, s.ctx.unitId)) as unknown as DocSettings, data.items);
      name = docFileName("Orcamento", data.quote.number, data.quote.customer_name, "docx");
    } else return new Response("Não encontrado", { status: 404 });
    return new Response(new Uint8Array(bytes), {
      headers: { "content-type": DOCX, "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`, "cache-control": "private, no-store" },
    });
  } catch (e) {
    if (isDomainError(e)) return new Response(e.message, { status: e.code === "forbidden" ? 403 : 404 });
    throw e;
  }
}
