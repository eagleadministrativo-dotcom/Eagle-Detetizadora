import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requireSession } from "@/server/session";
import { getSettings } from "@/server/core";
import { getQuote } from "@/server/services/eagle";
import { QuoteDocument, type DocSettings } from "@/components/documents";
import { PrintButton } from "@/components/client";

export const metadata = { title: "Orçamento" };

export default async function QuoteDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireSession();
  const db = await getDb();
  const data = await getQuote(db, ctx, id).catch(() => null);
  if (!data) notFound();
  const s = (await getSettings(db.query, ctx.unitId)) as unknown as DocSettings;
  return (
    <main className="docpage">
      <div className="toolbar">
        <Link className="btn ghost" href={`/orcamentos/${id}`}>← Voltar ao orçamento</Link>
        <span className="grow" />
        <a className="btn ghost" href={`/api/documento/orcamento/${id}`}>Baixar Word</a>
        <PrintButton label="Imprimir / salvar PDF" />
      </div>
      <QuoteDocument q={data.quote} s={s} items={data.items} />
    </main>
  );
}
