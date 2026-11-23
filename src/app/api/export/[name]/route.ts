import { getDb } from "@/server/db";
import { currentSession } from "@/server/session";
import { DATASETS, exportDataset, toCsv, type Dataset } from "@/server/services/ops";
import { listEntries, listSettlements } from "@/server/services/commissions";
import { audit, need } from "@/server/core";
import { resolvePeriod } from "@/lib/period";
import { DomainError } from "@/server/errors";
import { fmtDateTime } from "@/lib/dates";
import { isDomainError } from "@/server/errors";

export const dynamic = "force-dynamic";

/** Comissões: lançamentos do período (gestão) ou demonstrativo de um repasse (gestão ou o próprio profissional). */
async function commissions(req: Request, name: "comissoes" | "repasse", ctx: NonNullable<Awaited<ReturnType<typeof currentSession>>>["ctx"]) {
  const db = await getDb();
  const u = new URL(req.url).searchParams;
  let p = resolvePeriod({ de: u.get("de") ?? undefined, ate: u.get("ate") ?? undefined }).p, staffId: string | null = null, settlementId: string | null = null;
  if (name === "comissoes") need(ctx, "commissions.view_all");
  else {
    const id = u.get("id") ?? "";
    const [s] = /^[0-9a-f-]{36}$/.test(id) ? await listSettlements(db, ctx, { id }) : [];
    if (!s) throw new DomainError("not_found", "Repasse não encontrado.");
    p = { start: s.period_start, end: s.period_end }; staffId = s.staff_id; settlementId = id;
  }
  const { rows } = await listEntries(db, ctx, { period: p, staffId, settlementId, limit: 5000 });
  const v = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  await audit(db.query, ctx, "DADOS_EXPORTADOS", "export", name, null, { rows: rows.length });
  return { filename: `marfim-${name}-${p.start}-a-${p.end}.csv`, csv: toCsv(rows.map((e) => ({ data: fmtDateTime(e.reference_at), profissional: e.staff_name, tipo: e.kind, item: e.description, valor: v(e.gross_cents), desconto: v(e.discount_cents), base: e.base, valor_base: v(e.base_cents), percentual: v(e.pct_bps), comissao: v(e.amount_cents), ajuste: v(e.adj_cents), situacao: e.state }))) };
}

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const s = await currentSession();
  if (!s || !s.mfaVerified) return new Response("Não autenticado", { status: 401 });
  const special = name === "comissoes" || name === "repasse";
  if (!special && !(DATASETS as readonly string[]).includes(name)) return new Response("Conjunto de dados inválido", { status: 404 });
  try {
    const out = special ? await commissions(_req, name, s.ctx) : await exportDataset(await getDb(), s.ctx, name as Dataset);
    return new Response(out.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${out.filename}"`, "cache-control": "no-store" } });
  } catch (e) {
    if (isDomainError(e)) return new Response(e.message, { status: e.code === "forbidden" ? 403 : 400 });
    console.error("[export]", e);
    return new Response("Erro ao exportar", { status: 500 });
  }
}
