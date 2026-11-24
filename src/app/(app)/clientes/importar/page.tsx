import Link from "next/link";
import { requirePerm } from "@/server/session";
import { Flash, PageHead } from "@/components/ui";
import { CustomerImport } from "@/components/customer-import";
import { importCustomersAction } from "@/app/actions/customers";

export const metadata = { title: "Importar clientes" };

export default async function ImportCustomers({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const sp = await searchParams;
  await requirePerm("customers.manage");
  return (
    <>
      <PageHead title="Importar clientes" sub="Traga os contatos do celular ou o arquivo de outro sistema. Telefones que já estão cadastrados são ignorados.">
        <Link className="btn ghost" href="/clientes/novo">Cadastrar um cliente</Link>
      </PageHead>
      <Flash erro={sp.erro} />
      <CustomerImport action={importCustomersAction} />
    </>
  );
}
