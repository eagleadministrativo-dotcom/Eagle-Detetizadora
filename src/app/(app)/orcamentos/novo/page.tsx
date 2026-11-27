import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { listCustomers } from "@/server/services/customers";
import { listServices } from "@/server/services/catalog";
import { quoteDefaults } from "@/server/services/eagle";
import { Empty, Flash, PageHead } from "@/components/ui";
import { QuoteForm } from "@/components/quote-form";

export const metadata = { title: "Novo orçamento" };

export default async function NewQuote({ searchParams }: { searchParams: Promise<{ cust?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("quotes.manage");
  const db = await getDb();
  const [customers, services, defaults] = await Promise.all([listCustomers(db, ctx, { limit: 1000 }), listServices(db, ctx.unitId), quoteDefaults(db, ctx.unitId)]);
  return (
    <>
      <PageHead title="Novo orçamento" sub="Monte a proposta; depois é só imprimir ou enviar e marcar a resposta do cliente.">
        <Link className="btn ghost" href="/orcamentos">Voltar</Link>
      </PageHead>
      <Flash erro={sp.erro} />
      {customers.rows.length === 0
        ? <Empty title="Nenhum cliente cadastrado">Cadastre o cliente antes de montar o orçamento. <Link href="/clientes/novo">Novo cliente</Link></Empty>
        : <QuoteForm customers={customers.rows} services={services} customerId={sp.cust} defaults={defaults} />}
    </>
  );
}
