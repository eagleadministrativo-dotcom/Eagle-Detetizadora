import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { customerOptions } from "@/server/services/customers";
import { listServices } from "@/server/services/catalog";
import { appointmentsWithoutOrder } from "@/server/services/eagle";
import { todayYmd } from "@/lib/dates";
import { Empty, Flash, PageHead } from "@/components/ui";
import { OrderFieldsForm } from "@/components/order-form";
import { OrderCustomerPicker } from "@/components/order-customer-picker";
import { createStandaloneOrderAction } from "@/app/actions/eagle";

export const metadata = { title: "Nova ordem de serviço" };

export default async function NewOrder({ searchParams }: { searchParams: Promise<{ cust?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("agenda.manage");
  const db = await getDb();
  const [customers, services, appointments] = await Promise.all([customerOptions(db, ctx), listServices(db, ctx.unitId), appointmentsWithoutOrder(db, ctx)]);
  return (
    <>
      <PageHead title="Nova ordem de serviço" sub="Escolha o cliente: se ele tiver agendamento, a data e os serviços já vêm do agendamento.">
        <Link className="btn ghost" href="/os">Voltar</Link>
      </PageHead>
      <Flash erro={sp.erro} />
      {customers.length === 0 ? <Empty title="Nenhum cliente cadastrado">Cadastre o cliente antes. <Link href="/clientes/novo">Novo cliente</Link></Empty> : (
        <form action={createStandaloneOrderAction} className="card form">
          <OrderCustomerPicker customers={customers} appointments={appointments} initialCustomer={sp.cust} today={todayYmd()} />
          <small>Razão social, fantasia, CNPJ/CPF, endereço e CEP vêm da ficha do cliente.</small>
          <OrderFieldsForm services={services} />
          <div><button className="btn accent" type="submit">Criar OS</button></div>
        </form>
      )}
    </>
  );
}
