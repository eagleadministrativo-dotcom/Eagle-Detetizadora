import Link from "next/link";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { addDays, monthEnd, monthStart, todayYmd, addMonths } from "@/lib/dates";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Relatórios" };

export default async function Reports() {
  const { ctx } = await requirePerm("reports.view");
  const today = todayYmd();
  const mes = `de=${monthStart(today)}&ate=${today}`;
  const ant = `de=${monthStart(addMonths(today, -1))}&ate=${monthEnd(addMonths(today, -1))}`;
  const items = [
    { k: "revenue", t: "Receita operacional", d: "Atendimentos concluídos, com cliente, profissional e valor." },
    { k: "attendances", t: "Atendimentos concluídos", d: "Lista completa do período." },
    { k: "ticket", t: "Ticket médio", d: "Receita elegível ÷ atendimentos elegíveis." },
    { k: "occupancy", t: "Ocupação", d: "Agendamentos considerados no cálculo de ocupação." },
    ...(can(ctx, "finance.view") ? [
      { k: "receipts_registered", t: "Pagamentos registrados", d: "Tudo o que os operadores lançaram, com situação." },
      { k: "receipts_confirmed", t: "Recebimentos confirmados", d: "Pagamentos conferidos manualmente." },
      { k: "receipts_settled", t: "Recebimentos conciliados", d: "Pagamentos com liquidação registrada." },
      { k: "operating_result", t: "Custos e despesas do período", d: "Lançamentos que compõem o resultado operacional." },
      { k: "receivables_open", t: "Contas a receber em aberto", d: "Saldos pendentes por cobrança." },
      { k: "payables_open", t: "Contas a pagar em aberto", d: "Saldos pendentes por conta." },
      { k: "cash_balance", t: "Saldo por conta", d: "Composição do saldo das contas." },
    ] : []),
  ];
  return (
    <>
      <PageHead title="Indicadores e relatórios" sub="Todo indicador mostra definição, fórmula, origem, período, exclusões e os registros que produziram o número." />
      <div className="grid cols-3">
        {items.map((i) => (
          <section key={i.k} className="card stack">
            <h3>{i.t}</h3><p className="muted">{i.d}</p>
            <div className="row"><Link className="btn small ghost" href={`/relatorios/${i.k}?${mes}`}>Mês atual</Link><Link className="btn small ghost" href={`/relatorios/${i.k}?${ant}`}>Mês anterior</Link><Link className="btn small ghost" href={`/relatorios/${i.k}?de=${addDays(today, -6)}&ate=${today}`}>7 dias</Link></div>
          </section>
        ))}
      </div>
      {can(ctx, "finance.view") ? <div className="card"><p>Demonstrativos: <Link href="/financeiro/dre">DRE gerencial</Link> · <Link href="/financeiro/fluxo">Fluxo de caixa</Link> · <Link href="/financeiro/fechamento">Fechamento mensal</Link></p></div> : null}
    </>
  );
}
