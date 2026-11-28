import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listFinanceEntries } from "@/server/services/eagle";
import { orderTotals, paidOrders, receivableOrders } from "@/server/services/eagle-stats";
import { docPhone } from "@/lib/doc-format";
import { fmtYmd, monthEnd, monthStart, todayYmd, addMonths } from "@/lib/dates";
import { Badge, ConfirmAction, Empty, Field, Flash, PageHead, Stat, money } from "@/components/ui";
import { deleteFinanceEntryAction, saveFinanceEntryAction, setOrderPaymentAction } from "@/app/actions/eagle";

export const metadata = { title: "Financeiro" };
const CATS = { receita: ["Contrato de manutenção", "Venda de produtos", "Outras receitas"], gasto: ["Produtos e insumos", "Combustível", "Veículo", "Equipamentos e EPIs", "Salários", "Impostos", "Aluguel", "Marketing", "Outras despesas"] };
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export default async function Finance({ searchParams }: { searchParams: Promise<{ m?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("finance.view");
  const today = todayYmd();
  const m = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : today.slice(0, 7);
  const start = monthStart(`${m}-01`);
  const end = monthEnd(`${m}-01`);
  const db = await getDb();
  const [{ rows, income, expense, categories }, os, receivable, paid] = await Promise.all([
    listFinanceEntries(db, ctx, { start, end }), orderTotals(db, ctx, { start, end }), receivableOrders(db, ctx), paidOrders(db, ctx, { start, end })]);
  const balance = os.paid + income - expense;
  const manage = can(ctx, "finance.manage");
  const label = `${MONTHS[Number(m.slice(5)) - 1]} de ${m.slice(0, 4)}`;
  const prev = addMonths(start, -1).slice(0, 7);
  const next = addMonths(start, 1).slice(0, 7);

  return (
    <>
      <PageHead title="Financeiro" sub={`Resumo de ${label}: ordens de serviço concluídas (faturado, recebido e a receber), receitas avulsas e gastos.`}>
        <Link className="btn ghost" href={`/financeiro?m=${prev}`}>‹ Mês anterior</Link>
        {m !== today.slice(0, 7) ? <Link className="btn ghost" href="/financeiro">Mês atual</Link> : null}
        <Link className="btn ghost" href={`/financeiro?m=${next}`}>Próximo mês ›</Link>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid cols-3">
        <Stat label="Faturado em OS" value={money(os.billed)} hint={`${os.done} OS concluída(s) no mês, pela data do serviço`} />
        <Stat label="Recebido das OS" value={money(os.paid)} tone="ol" hint="OS concluídas e marcadas como pagas" />
        <Stat label="A receber (todas as datas)" value={money(receivable.total)} tone={receivable.total ? "hi" : ""} hint={`${receivable.rows.length} OS concluída(s) sem pagamento`} />
        <Stat label="Outras receitas lançadas" value={money(income)} />
        <Stat label="Gastos lançados" value={money(expense)} />
        <Stat label="Saldo do mês" value={money(balance)} tone={balance >= 0 ? "ol" : "hi"} hint="Recebido das OS + outras receitas − gastos" />
      </div>
      <section className="card stack" id="receber">
        <h2>A receber: OS concluídas sem pagamento</h2>
        {receivable.rows.length === 0 ? <Empty title="Nada a receber">Todas as OS concluídas estão pagas.</Empty> : (
          <div className="tablewrap">
            <table>
              <thead><tr><th>OS</th><th>Cliente</th><th>Serviço em</th><th className="n">Valor</th><th>Situação</th>{manage ? <th /> : null}</tr></thead>
              <tbody>
                {receivable.rows.map((o) => (
                  <tr key={o.id}>
                    <td className="mono"><Link href={`/os/${o.id}`}>#{o.number}</Link></td>
                    <td><Link href={`/clientes/${o.customer_id}`}>{o.customer_name}</Link>{o.customer_phone ? <><br /><small>{docPhone(o.customer_phone)}</small></> : null}</td>
                    <td className="nowrap">{o.service_date ? fmtYmd(o.service_date) : "—"}{o.service_date && o.service_date < addMonths(today, -1) ? <><br /><Badge tone="bad">há mais de 1 mês</Badge></> : null}</td>
                    <td className="n">{money(o.total_cents)}</td>
                    <td><Badge tone={o.payment_status === "parcial" ? "info" : "warn"}>{o.payment_status === "parcial" ? "Parcial" : "Pendente"}</Badge></td>
                    {manage ? (
                      <td>
                        <form action={setOrderPaymentAction} className="row">
                          <input type="hidden" name="id" value={o.id} /><input type="hidden" name="back" value={`/financeiro?m=${m}#receber`} /><input type="hidden" name="status" value="pago" />
                          <select name="method" defaultValue={o.payment_method ?? ""} aria-label="Forma de pagamento">
                            <option value="">Forma…</option>{["Pix", "Dinheiro", "Boleto", "Cartão", "Transferência"].map((x) => <option key={x} value={x}>{x}</option>)}
                          </select>
                          <button className="btn small accent" type="submit">Recebido</button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {paid.length ? (
        <details className="card">
          <summary><b>Recebido em {label}</b> · {paid.length} OS · {money(os.paid)}</summary>
          <div className="tablewrap" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>OS</th><th>Cliente</th><th>Serviço em</th><th>Forma</th><th className="n">Valor</th></tr></thead>
              <tbody>{paid.map((o) => <tr key={o.id}><td className="mono"><Link href={`/os/${o.id}`}>#{o.number}</Link></td><td>{o.customer_name}</td><td className="nowrap">{o.service_date ? fmtYmd(o.service_date) : "—"}</td><td>{o.payment_method ?? "—"}</td><td className="n">{money(o.total_cents)}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      ) : null}
      <div className="grid asym">
        <section className="card stack">
          <h2>Lançamentos de {label}</h2>
          {rows.length === 0 ? <Empty title="Nenhum lançamento neste mês">{manage ? "Use o formulário ao lado para lançar receitas e gastos avulsos." : null}</Empty> : (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th className="n">Valor</th>{manage ? <th /> : null}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="nowrap">{fmtYmd(r.entry_date)}</td>
                      <td>{r.description}{r.created_by_name ? <><br /><small>por {r.created_by_name}</small></> : null}</td>
                      <td><Badge tone={r.kind === "receita" ? "ok" : "bad"}>{r.kind === "receita" ? "Receita" : "Gasto"}</Badge> <small>{r.category}</small></td>
                      <td className="n">{r.kind === "gasto" ? "− " : ""}{money(r.amount_cents)}</td>
                      {manage ? (
                        <td>
                          <ConfirmAction label="Excluir" action={deleteFinanceEntryAction} submit="Excluir lançamento" warn="A exclusão fica registrada na auditoria.">
                            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="m" value={m} />
                          </ConfirmAction>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {categories.length ? (
            <>
              <h3>Por categoria</h3>
              <div className="stack">{categories.map((c) => <div key={c.kind + c.category} className="row" style={{ justifyContent: "space-between" }}><span>{c.category} <small>· {c.kind}</small></span><b className="mono">{money(c.cents)}</b></div>)}</div>
            </>
          ) : null}
        </section>
        {manage ? (
          <section className="card form" id="novo">
            <h2>Novo lançamento</h2>
            <form action={saveFinanceEntryAction} className="form">
              <input type="hidden" name="m" value={m} />
              <small className="muted">As OS concluídas já entram sozinhas. Aqui vão gastos (produtos, combustível...) e receitas fora das OS.</small>
              <Field label="Tipo"><select name="kind" defaultValue="gasto"><option value="gasto">Gasto</option><option value="receita">Receita</option></select></Field>
              <Field label="Descrição"><input name="description" required placeholder="Ex.: Inseticida gel, 10 unidades" /></Field>
              <Field label="Categoria">
                <input name="category" list="fin-cats" required placeholder="Escolha ou digite" />
                <datalist id="fin-cats">{[...CATS.gasto, ...CATS.receita].map((c) => <option key={c} value={c} />)}</datalist>
              </Field>
              <div className="fields">
                <Field label="Valor (R$)"><input name="amount" inputMode="decimal" required placeholder="0,00" /></Field>
                <Field label="Data"><input type="date" name="entryDate" defaultValue={m === today.slice(0, 7) ? today : start} required /></Field>
              </div>
              <div><button className="btn accent" type="submit">Lançar</button></div>
            </form>
          </section>
        ) : null}
      </div>
    </>
  );
}
