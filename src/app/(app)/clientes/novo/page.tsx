import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { saveCustomerAction } from "@/app/actions/customers";
import { Field, Flash, PageHead } from "@/components/ui";

export const metadata = { title: "Novo cliente" };

export default async function NewCustomer({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("customers.manage");
  const sensitive = can(ctx, "customers.edit_sensitive");
  return (
    <>
      <PageHead title="Novo cliente" sub="Cadastre apenas o necessário para o atendimento." />
      <Flash erro={sp.erro} />
      <form action={saveCustomerAction} className="card form">
        <div className="fields">
          <Field label="Nome"><input name="name" required /></Field>
          <Field label="Telefone"><input name="phone" inputMode="tel" placeholder="41 99999-0000" /></Field>
        </div>
        {sensitive ? (
          <div className="fields">
            <Field label="E-mail (opcional)"><input name="email" type="email" /></Field>
            <Field label="CPF (opcional)"><input name="cpf" inputMode="numeric" /></Field>
            <Field label="Nascimento (opcional)"><input name="birthdate" type="date" /></Field>
          </div>
        ) : null}
        <Field label="Observações (preferências, alergias, cuidados)"><textarea name="notes" /></Field>
        <small>Dados pessoais são coletados só para atender o cliente e podem ser corrigidos ou removidos a pedido dele (LGPD).</small>
        <div><button className="btn accent" type="submit">Cadastrar</button></div>
      </form>
    </>
  );
}
