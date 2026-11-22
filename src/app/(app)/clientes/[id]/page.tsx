import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { isDomainError } from "@/server/errors";
import { getCustomer } from "@/server/services/customers";
import { fmtDate } from "@/lib/dates";
import { Badge, Empty, Field, Flash, PageHead, money } from "@/components/ui";
import { saveCustomerAction } from "@/app/actions/customers";

export const metadata = { title: "Cliente" };

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("customers.view");
  let data;
  try {
    data = await getCustomer(await getDb(), ctx, id);
  } catch (e) {
    if (isDomainError(e) && e.code === "not_found") notFound();
    throw e;
  }
  const { customer: c, history } = data;
  const edit = can(ctx, "customers.manage");
  const sensitive = can(ctx, "customers.edit_sensitive");
  return (
    <>
      <PageHead title={c.name} sub={<>{c.visits} visita(s) · total gasto {money(c.total_spent_cents)}</>}>
        {!c.is_active ? <Badge>inativo</Badge> : null}
        <Link className="btn ghost" href="/clientes">Voltar</Link>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid cols-2">
        <section className="card">
          <h2>Dados</h2>
          <form action={saveCustomerAction} className="form" style={{ marginTop: 10 }}>
            <input type="hidden" name="id" value={c.id} />
            <div className="fields">
              <Field label="Nome"><input name="name" defaultValue={c.name} required readOnly={!edit} /></Field>
              <Field label="Telefone"><input name="phone" defaultValue={c.phone ?? ""} readOnly={!edit} /></Field>
            </div>
            {sensitive ? (
              <div className="fields">
                <Field label="E-mail"><input name="email" type="email" defaultValue={c.email ?? ""} /></Field>
                <Field label="CPF"><input name="cpf" defaultValue={c.cpf ?? ""} /></Field>
                <Field label="Nascimento"><input name="birthdate" type="date" defaultValue={c.birthdate ?? ""} /></Field>
              </div>
            ) : null}
            <Field label="Observações"><textarea name="notes" defaultValue={c.notes ?? ""} readOnly={!edit} /></Field>
            {can(ctx, "customers.deactivate") ? <label className="check"><input type="checkbox" name="isActive" defaultChecked={c.is_active} />Cliente ativo</label> : <input type="hidden" name="isActive" value={c.is_active ? "true" : ""} />}
            {edit ? <div><button className="btn accent" type="submit">Salvar</button></div> : null}
          </form>
        </section>
        <section className="card stack">
          <h2>Últimos atendimentos</h2>
          {history.length === 0 ? <Empty title="Sem atendimentos concluídos" /> : (
            <div className="tablewrap"><table>
              <thead><tr><th>Data</th><th>Serviços</th><th>Profissional</th><th className="n">Valor</th></tr></thead>
              <tbody>{history.map((h) => <tr key={h.id}><td className="nowrap"><Link href={`/atendimentos/${h.id}`}>{fmtDate(h.finished_at)}</Link></td><td>{h.services}</td><td>{h.staff_name}</td><td className="n">{money(h.total_cents)}</td></tr>)}</tbody>
            </table></div>
          )}
        </section>
      </div>
    </>
  );
}
