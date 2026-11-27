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
import { ruleLabel } from "@/lib/recurrence";
import { fmtDateTime, fmtYmd } from "@/lib/dates";
import { FrequencyFields } from "@/components/client";
import { contactPrefsAction, returnRuleAction } from "@/app/actions/returns";
import { saveCustomerAction } from "@/app/actions/customers";
import { listQuotes, listServiceOrders } from "@/server/services/eagle";
import { listCustomerFiles } from "@/server/services/files";
import { OSStatusBadge, QuoteStatusBadge } from "@/components/eagle-ui";
import { ConfirmAction } from "@/components/ui";
import { addCustomerFileAction, deleteCustomerFileAction } from "@/app/actions/eagle";

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
  const staffList = (await listCatalog(db, ctx.unitId)).staff.filter((s) => s.is_active);
  const canRules = can(ctx, "returns.rules") || can(ctx, "returns.contact");
  const edit = can(ctx, "customers.manage");
  const sensitive = can(ctx, "customers.edit_sensitive");
  const seesOrders = can(ctx, "agenda.manage") || can(ctx, "agenda.view_all");
  const seesQuotes = can(ctx, "quotes.view") || can(ctx, "quotes.manage");
  const [orders, quotes, files] = await Promise.all([
    seesOrders ? listServiceOrders(db, ctx, { customerId: id, limit: 100 }).then((r) => r.rows) : Promise.resolve(null),
    seesQuotes ? listQuotes(db, ctx, { customerId: id, limit: 100 }).then((r) => r.rows) : Promise.resolve(null),
    listCustomerFiles(db, ctx, id),
  ]);
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
          <h2>Retorno e contato</h2>
          {ret.status ? <p>{ret.status.rule_label}{ret.status.due_date ? <> · próximo retorno em <b>{fmtYmd(ret.status.due_date)}</b></> : null} <small>({({ cliente: "regra do cliente", profissional: "regra com o profissional", padrao: "padrão da empresa", sem_acompanhamento: "sem acompanhamento" } as Record<string, string>)[ret.status.rule_source]})</small></p> : <p className="muted">Sem atendimento concluído: ainda não há retorno a calcular.</p>}
          {ret.rules.map((r) => <small key={r.staff_id ?? "g"}>{r.staff_id ? `Com ${r.staff_name}` : "Regra do cliente"}: {r.no_follow ? "sem acompanhamento" : r.rule ? ruleLabel(r.rule) : "—"}</small>)}
          {canRules ? (
            <details className="confirm neutral"><summary>Definir frequência</summary>
              <form action={returnRuleAction} className="form">
                <input type="hidden" name="customerId" value={c.id} /><input type="hidden" name="back" value={`/clientes/${c.id}`} />
                <FrequencyFields none="Usar o padrão da empresa" />
                <Field label="Vale para"><select name="staffId" defaultValue=""><option value="">O cliente, com qualquer profissional</option>{staffList.map((s) => <option key={s.id} value={s.id}>Só com {s.name}</option>)}</select></Field>
                <label className="check"><input type="checkbox" name="noFollow" />Não acompanhar o retorno deste cliente</label>
                <small>A regra do cliente vale acima da regra com o profissional, que vale acima do padrão.</small>
                <div><button className="btn small" type="submit">Salvar frequência</button></div>
              </form>
            </details>
          ) : null}
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
                <Field label="É"><select name="kind" defaultValue="outro"><option value="os">Ordem de serviço</option><option value="orcamento">Orçamento</option><option value="outro">Outro (laudo, foto, contrato…)</option></select></Field>
              </div>
              <div><button className="btn small" type="submit">Anexar</button></div>
            </form>
          ) : null}
        </section>
        {showHistory ? <section className="card stack">
          <h2>Últimos atendimentos</h2>
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
