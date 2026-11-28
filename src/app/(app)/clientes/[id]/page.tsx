import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { isDomainError } from "@/server/errors";
import { getCustomer } from "@/server/services/customers";
import { fmtDate } from "@/lib/dates";
import { Badge, Empty, Field, Flash, PageHead, money } from "@/components/ui";
import { returnDetails } from "@/server/services/returns";
import { listCatalog } from "@/server/services/catalog";
import { fmtDateTime, fmtYmd, todayYmd } from "@/lib/dates";
import { contactPrefsAction } from "@/app/actions/returns";
import { saveCustomerAction } from "@/app/actions/customers";
import { listQuotes, listServiceOrders, RETURN_KIND_LABEL, RETURN_STATUS_LABEL } from "@/server/services/eagle";
import { listCustomerFiles } from "@/server/services/files";
import { OSStatusBadge, QuoteStatusBadge } from "@/components/eagle-ui";
import { ConfirmAction } from "@/components/ui";
import { addCustomerFileAction, deleteCustomerFileAction } from "@/app/actions/eagle";
import { customerHistory, PAYMENT_KIND_LABEL } from "@/server/services/history";

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
  const showHistory = can(ctx, "customers.history");
  const db = await getDb();
  const ret = await returnDetails(db, ctx, id);
  const serviceReturns = await db.query<{ id: string; kind: keyof typeof RETURN_KIND_LABEL; due_date: string; status: keyof typeof RETURN_STATUS_LABEL; number: number | null }>(
    `select r.id, r.kind, to_char(r.due_date,'YYYY-MM-DD') as due_date, r.status, so.number from service_returns r left join service_orders so on so.id=r.service_order_id
     where r.customer_id=$1 and r.unit_id=$2 order by case when r.status in ('pendente','agendado') then 0 else 1 end, r.due_date desc limit 30`, [id, ctx.unitId]);
  const staffList = (await listCatalog(db, ctx.unitId)).staff.filter((s) => s.is_active);
  const edit = can(ctx, "customers.manage");
  const sensitive = can(ctx, "customers.edit_sensitive");
  const seesOrders = can(ctx, "agenda.manage") || can(ctx, "agenda.view_all");
  const seesQuotes = can(ctx, "quotes.view") || can(ctx, "quotes.manage");
  const [orders, quotes, files, past] = await Promise.all([
    seesOrders ? listServiceOrders(db, ctx, { customerId: id, limit: 100 }).then((r) => r.rows) : Promise.resolve(null),
    seesQuotes ? listQuotes(db, ctx, { customerId: id, limit: 100 }).then((r) => r.rows) : Promise.resolve(null),
    listCustomerFiles(db, ctx, id),
    showHistory ? customerHistory(db, ctx, id) : Promise.resolve([]),
  ]);
  const pastTotal = past.reduce((a, h) => a + (h.amount_cents ?? 0), 0);
  return (
    <>
      <PageHead title={c.name} sub={showHistory ? <>{c.visits} visita(s) · total gasto {money(c.total_spent_cents)}</> : undefined}>
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
              <Field label="Contato"><input name="contactName" defaultValue={c.contact_name ?? ""} readOnly={!edit} placeholder="Quem atende (ex.: Rose, síndico)" /></Field>
            </div>
            <div className="fields">
              <Field label="Razão social"><input name="legalName" defaultValue={c.legal_name ?? ""} readOnly={!edit} /></Field>
              <Field label="Nome fantasia"><input name="tradeName" defaultValue={c.trade_name ?? ""} readOnly={!edit} /></Field>
            </div>
            <div className="fields">
              <Field label="Endereço completo"><input name="address" defaultValue={c.address ?? ""} readOnly={!edit} placeholder="Rua, número, bairro, cidade/UF" /></Field>
              <Field label="CEP"><input name="cep" defaultValue={c.cep ?? ""} readOnly={!edit} inputMode="numeric" /></Field>
            </div>
            {sensitive ? (
              <div className="fields">
                <Field label="E-mail"><input name="email" type="email" defaultValue={c.email ?? ""} /></Field>
                <Field label="CNPJ/CPF"><input name="cpf" defaultValue={c.cpf ?? ""} /></Field>
                <Field label="Nascimento"><input name="birthdate" type="date" defaultValue={c.birthdate ?? ""} /></Field>
              </div>
            ) : null}
            <Field label="Observações"><textarea name="notes" defaultValue={c.notes ?? ""} readOnly={!edit} /></Field>
            {can(ctx, "customers.deactivate") ? <label className="check"><input type="checkbox" name="isActive" defaultChecked={c.is_active} />Cliente ativo</label> : <input type="hidden" name="isActive" value={c.is_active ? "true" : ""} />}
            {edit ? <div><button className="btn accent" type="submit">Salvar</button></div> : null}
          </form>
        </section>
        <section className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}><h2>Retornos</h2>{can(ctx, "returns.manage") ? <Link className="btn small" href={`/retornos/novo?cust=${c.id}`}>+ Novo retorno</Link> : null}</div>
          {serviceReturns.length === 0 ? <small className="muted">Nenhum retorno. Ao concluir uma OS com garantia ou laudo, o retorno entra aqui sozinho.</small> : (
            <div className="stack">
              {serviceReturns.map((r) => (
                <div key={r.id} className="row" style={{ justifyContent: "space-between" }}>
                  <span><Link href={`/retornos/${r.id}`}>{RETURN_KIND_LABEL[r.kind]} em {fmtYmd(r.due_date)}</Link>{r.number ? <small> · OS nº {r.number}</small> : null}</span>
                  <Badge tone={r.status === "concluido" ? "ok" : r.status === "cancelado" ? "" : r.due_date < todayYmd() ? "bad" : "warn"}>{RETURN_STATUS_LABEL[r.status]}</Badge>
                </div>
              ))}
            </div>
          )}
          {edit && ret.prefs ? (
            <form action={contactPrefsAction} className="form">
              <input type="hidden" name="customerId" value={c.id} /><input type="hidden" name="back" value={`/clientes/${c.id}`} />
              <div className="fields">
                <Field label="Canal autorizado"><select name="channel" defaultValue={ret.prefs.contact_channel}><option value="whatsapp">WhatsApp</option><option value="telefone">Telefone</option><option value="email">E-mail</option><option value="nenhum">Nenhum</option></select></Field>
                <Field label="Profissional preferido"><select name="preferredStaffId" defaultValue={ret.prefs.preferred_staff_id ?? ""}><option value="">Sem preferência</option>{staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              </div>
              <label className="switch">Não quer receber mensagens<input type="checkbox" role="switch" name="optOut" defaultChecked={ret.prefs.contact_opt_out} /></label>
              <div><button className="btn small" type="submit">Salvar contato</button></div>
            </form>
          ) : null}
          {ret.contacts.length ? <><h3>Contatos</h3>{ret.contacts.map((k) => <small key={k.id}>{fmtDateTime(k.created_at)} · {k.user_name} · {k.outcome.replace("_", " ")}{k.note ? `: ${k.note}` : ""}</small>)}</> : null}
        </section>
        {orders ? (
          <section className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}><h2>Ordens de serviço</h2>{can(ctx, "agenda.manage") ? <Link className="btn small" href={`/os/nova?cust=${c.id}`}>+ Nova OS</Link> : null}</div>
            {orders.length === 0 ? <Empty title="Nenhuma ordem de serviço" /> : (
              <div className="tablewrap"><table>
                <thead><tr><th>Nº</th><th>Data</th><th>Serviços</th><th className="n">Valor</th><th>Situação</th></tr></thead>
                <tbody>{orders.map((o) => <tr key={o.id}><td className="mono"><Link href={`/os/${o.id}`}>#{o.number}</Link></td><td className="nowrap">{o.service_date ? fmtYmd(o.service_date) : "—"}</td><td>{o.services || "—"}</td><td className="n">{money(o.total_cents)}</td><td><OSStatusBadge s={o.status} /> <Link href={`/documento/os/${o.id}`}>documento</Link></td></tr>)}</tbody>
              </table></div>
            )}
          </section>
        ) : null}
        {quotes ? (
          <section className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}><h2>Orçamentos</h2>{can(ctx, "quotes.manage") ? <Link className="btn small" href={`/orcamentos/novo?cust=${c.id}`}>+ Novo orçamento</Link> : null}</div>
            {quotes.length === 0 ? <Empty title="Nenhum orçamento" /> : (
              <div className="tablewrap"><table>
                <thead><tr><th>Nº</th><th>Data</th><th className="n">Valor</th><th>Situação</th></tr></thead>
                <tbody>{quotes.map((q) => <tr key={q.id}><td className="mono"><Link href={`/orcamentos/${q.id}`}>#{q.number}</Link></td><td className="nowrap">{fmtYmd(q.issue_date)}</td><td className="n">{money(q.doc_value_cents)}</td><td><QuoteStatusBadge s={q.status} /> <Link href={`/documento/orcamento/${q.id}`}>documento</Link></td></tr>)}</tbody>
              </table></div>
            )}
          </section>
        ) : null}
        <section className="card stack">
          <h2>Arquivos</h2>
          {files.length === 0 ? <small>Nenhum arquivo. Os arquivos importados de OS e orçamentos ficam guardados aqui.</small> : (
            <div className="stack">
              {files.map((f) => (
                <div key={f.id} className="row" style={{ justifyContent: "space-between" }}>
                  <span><a href={`/api/arquivo/cliente/${f.id}`}>{f.name}</a> <Badge>{f.kind === "os" ? "OS" : f.kind === "orcamento" ? "orçamento" : "outro"}</Badge><br /><small>{fmtDateTime(f.created_at)} · {(f.size_bytes / 1024).toFixed(0)} KB{f.created_by_name ? ` · ${f.created_by_name}` : ""}</small></span>
                  {edit ? (
                    <ConfirmAction label="Excluir" action={deleteCustomerFileAction} submit="Excluir arquivo" warn="O arquivo sai da ficha. A OS ou o orçamento continuam.">
                      <input type="hidden" name="id" value={f.id} /><input type="hidden" name="customerId" value={c.id} />
                    </ConfirmAction>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {edit ? (
            <form action={addCustomerFileAction} className="form">
              <input type="hidden" name="customerId" value={c.id} />
              <div className="fields">
                <Field label="Anexar arquivo (até 5 MB)"><input type="file" name="file" accept=".pdf,.docx,.doc,.xlsx,.png,.jpg,.jpeg,.webp,.txt" required /></Field>
                <Field label="Tipo de arquivo"><select name="kind" defaultValue="outro"><option value="os">Ordem de serviço</option><option value="orcamento">Orçamento</option><option value="outro">Outro (laudo, foto, contrato…)</option></select></Field>
              </div>
              <div><button className="btn small" type="submit">Anexar</button></div>
            </form>
          ) : null}
        </section>
        {past.length ? (
          <section className="card stack" style={{ gridColumn: "1 / -1" }}>
            <h2>Histórico de serviços</h2>
            <small className="muted">{past.length} serviço(s) prestado(s) · {money(pastTotal)} · vindo das planilhas de vendas</small>
            <div className="tablewrap"><table>
              <thead><tr><th>Data</th><th>Serviço</th><th className="n">Valor</th><th>Pagamento</th><th>Detalhes</th></tr></thead>
              <tbody>{past.map((h) => (
                <tr key={h.id}>
                  <td className="nowrap">{fmtYmd(h.service_date)}</td>
                  <td>{h.description || "—"}{h.service_address ? <><br /><small>{h.service_address}</small></> : null}</td>
                  <td className="n nowrap">{h.amount_cents != null ? money(h.amount_cents) : <small>{h.amount_note || "—"}</small>}</td>
                  <td>{h.payment_kind ? PAYMENT_KIND_LABEL[h.payment_kind] ?? h.payment_kind : "—"}{h.payment_detail ? <><br /><small>{h.payment_detail}</small></> : null}</td>
                  <td><small>{[h.customer_status, h.report && `Laudo: ${h.report}`, h.warranty && `Garantia: ${h.warranty}`, h.return_note && `Retorno: ${h.return_note}`, h.seller && `Vendedora: ${h.seller}`, h.notes, h.follow_up].filter(Boolean).join(" · ") || "—"}</small></td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
        ) : null}
        {showHistory && history.length ? <section className="card stack">
          <h2>Atendimentos antigos</h2>
          {history.length === 0 ? <Empty title="Sem atendimentos concluídos" /> : (
            <div className="tablewrap"><table>
              <thead><tr><th>Data</th><th>Serviços</th><th>Profissional</th><th className="n">Valor</th></tr></thead>
              <tbody>{history.map((h) => <tr key={h.id}><td className="nowrap"><Link href={`/atendimentos/${h.id}`}>{fmtDate(h.finished_at)}</Link></td><td>{h.services}</td><td>{h.staff_name}</td><td className="n">{money(h.total_cents)}</td></tr>)}</tbody>
            </table></div>
          )}
        </section> : null}
      </div>
    </>
  );
}
