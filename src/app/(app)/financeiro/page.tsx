import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listFinanceEntries } from "@/server/services/eagle";
import { fmtYmd, monthEnd, monthStart, todayYmd, addMonths } from "@/lib/dates";
import { Badge, ConfirmAction, Empty, Field, Flash, PageHead, Stat, money } from "@/components/ui";
import { deleteFinanceEntryAction, saveFinanceEntryAction } from "@/app/actions/eagle";

export const metadata = { title: "Financeiro" };
const CATS = { receita: ["Serviços avulsos", "Contrato de manutenção", "Venda de produtos", "Outras receitas"], gasto: ["Produtos e insumos", "Combustível", "Veículo", "Equipamentos e EPIs", "Salários", "Impostos", "Aluguel", "Marketing", "Outras despesas"] };
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export default async function Finance({ searchParams }: { searchParams: Promise<{ m?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("finance.view");
  const today = todayYmd();
  const m = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : today.slice(0, 7);
  const start = monthStart(`${m}-01`);
  const end = monthEnd(`${m}-01`);
  const { rows, income, expense, balance, categories } = await listFinanceEntries(await getDb(), ctx, { start, end });
  const manage = can(ctx, "finance.manage");
  const label = `${MONTHS[Number(m.slice(5)) - 1]} de ${m.slice(0, 4)}`;
  const prev = addMonths(start, -1).slice(0, 7);
  const next = addMonths(start, 1).slice(0, 7);
  const links: [string, string, boolean][] = [
    ["/financeiro/caixa", "Caixa do dia", can(ctx, "cash.manage") || can(ctx, "finance.view")],
    ["/financeiro/receber", "Contas a receber", true],
    ["/financeiro/pagar", "Contas a pagar", true],
    ["/financeiro/conciliacao", "Conciliação", true],
    ["/financeiro/fluxo", "Fluxo de caixa", true],
    ["/financeiro/dre", "DRE (resultado)", true],
    ["/financeiro/fechamento", "Fechamento do mês", true],
    ["/financeiro/metas", "Metas", true],
    ["/relatorios", "Indicadores e relatórios", can(ctx, "reports.view")],
  ];

  return (
    <>
      <PageHead title="Financeiro" sub={`Resumo de ${label}: lançamentos avulsos e atalhos para caixa, contas, DRE e fechamento.`}>
        <Link className="btn ghost" href={`/financeiro?m=${prev}`}>‹ Mês anterior</Link>
        {m !== today.slice(0, 7) ? <Link className="btn ghost" href="/financeiro">Mês atual</Link> : null}
        <Link className="btn ghost" href={`/financeiro?m=${next}`}>Próximo mês ›</Link>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid cols-3">
        <Stat label="Receitas lançadas" value={money(income)} />
        <Stat label="Gastos lançados" value={money(expense)} />
        <Stat label="Saldo dos lançamentos" value={money(balance)} tone={balance >= 0 ? "ol" : "hi"} hint="Só os lançamentos desta tela. Atendimentos e contas estão no DRE." />
      </div>
      <section className="card stack">
        <h2>Atalhos</h2>
        <div className="row">{links.filter(([, , ok]) => ok).map(([href, text]) => <Link key={href} className="btn ghost" href={href}>{text}</Link>)}</div>
      </section>
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
