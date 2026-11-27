import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { listCustomers } from "@/server/services/customers";
import { Empty, Field, Flash, PageHead } from "@/components/ui";
import { OrderFieldsForm } from "@/components/order-form";
import { createStandaloneOrderAction } from "@/app/actions/eagle";

export const metadata = { title: "Nova ordem de serviço" };

export default async function NewOrder({ searchParams }: { searchParams: Promise<{ cust?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("agenda.manage");
  const customers = (await listCustomers(await getDb(), ctx, { limit: 1000 })).rows;
  return (
    <>
      <PageHead title="Nova ordem de serviço" sub="OS avulsa, sem agendamento. Para a visita agendada, abra a OS pelo agendamento.">
        <Link className="btn ghost" href="/os">Voltar</Link>
      </PageHead>
      <Flash erro={sp.erro} />
      {customers.length === 0 ? <Empty title="Nenhum cliente cadastrado">Cadastre o cliente antes. <Link href="/clientes/novo">Novo cliente</Link></Empty> : (
        <form action={createStandaloneOrderAction} className="card form">
          <Field label="Cliente">
            <select name="customerId" defaultValue={sp.cust ?? ""} required>
              <option value="">— escolher —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
            </select>
          </Field>
          <small>Razão social, fantasia, CNPJ/CPF, endereço e CEP vêm da ficha do cliente.</small>
          <OrderFieldsForm />
          <div><button className="btn accent" type="submit">Criar OS</button></div>
        </form>
      )}
    </>
  );
}
