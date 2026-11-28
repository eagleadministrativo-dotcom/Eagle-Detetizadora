import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { customerOptions } from "@/server/services/customers";
import { listServices } from "@/server/services/catalog";
import { quoteDefaults } from "@/server/services/eagle";
import { Empty, Flash, PageHead } from "@/components/ui";
import { QuoteForm } from "@/components/quote-form";
import { agendaForPicker, listDocOptions } from "@/server/services/doc-options";

export const metadata = { title: "Novo orçamento" };

export default async function NewQuote({ searchParams }: { searchParams: Promise<{ cust?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("quotes.manage");
  const db = await getDb();
  const [customers, services, defaults, options, agenda] = await Promise.all([
    customerOptions(db, ctx), listServices(db, ctx.unitId), quoteDefaults(db, ctx.unitId), listDocOptions(db, ctx.unitId), agendaForPicker(db, ctx)]);
  return (
    <>
      <PageHead title="Novo orçamento" sub="Monte a proposta; depois é só imprimir ou enviar e marcar a resposta do cliente.">
        <Link className="btn ghost" href="/orcamentos">Voltar</Link>
      </PageHead>
      <Flash erro={sp.erro} />
      {customers.length === 0
        ? <Empty title="Nenhum cliente cadastrado">Cadastre o cliente antes de montar o orçamento. <Link href="/clientes/novo">Novo cliente</Link></Empty>
        : <QuoteForm customers={customers} services={services} customerId={sp.cust} defaults={defaults} options={options} agenda={agenda} />}
    </>
  );
}
