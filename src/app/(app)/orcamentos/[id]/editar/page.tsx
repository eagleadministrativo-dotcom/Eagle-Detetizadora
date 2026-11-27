import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { listCustomers } from "@/server/services/customers";
import { listServices } from "@/server/services/catalog";
import { getQuote, quoteDefaults } from "@/server/services/eagle";
import { Flash, PageHead } from "@/components/ui";
import { QuoteForm } from "@/components/quote-form";

export const metadata = { title: "Editar orçamento" };

export default async function EditQuote({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams as { erro?: string; ok?: string };
  const { ctx } = await requirePerm("quotes.manage");
  const db = await getDb();
  const data = await getQuote(db, ctx, id).catch(() => null);
  if (!data) notFound();
  if (data.quote.status === "aprovado" || data.quote.status === "recusado") redirect(`/orcamentos/${id}?erro=${encodeURIComponent("Volte o orçamento para rascunho antes de editar.")}`);
  const [customers, services, defaults] = await Promise.all([listCustomers(db, ctx, { limit: 1000 }), listServices(db, ctx.unitId), quoteDefaults(db, ctx.unitId)]);
  return (
    <>
      <PageHead title={`Orçamento nº ${data.quote.number}`} sub="Editando itens e condições.">
        <Link className="btn ghost" href={`/orcamentos/${id}`}>Voltar</Link>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <QuoteForm customers={customers.rows} services={services} quote={data.quote} items={data.items} defaults={defaults} />
    </>
  );
}
