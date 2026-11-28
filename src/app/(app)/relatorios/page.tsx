import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { entryTotals, orderBreakdowns, orderTotals, quoteTotals } from "@/server/services/eagle-stats";
import { listServiceOrders } from "@/server/services/eagle";
import { addMonths, fmtYmd, monthEnd, monthStart, todayYmd } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { Empty, PageHead, Stat, money } from "@/components/ui";
import { OSPaymentBadge } from "@/components/eagle-ui";

export const metadata = { title: "Relatórios" };
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Relatório do mês pelas ordens de serviço: faturamento por serviço, técnico e forma de pagamento; orçamentos; lista das OS. */
export default async function Reports({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("reports.view");
  const db = await getDb();
  const today = todayYmd();
  const m = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : today.slice(0, 7);
  const p = { start: monthStart(`${m}-01`), end: monthEnd(`${m}-01`) };
  const label = `${MONTHS[Number(m.slice(5)) - 1]} de ${m.slice(0, 4)}`;
  const [tot, br, quotes, entries, orders] = await Promise.all([
    orderTotals(db, ctx, p), orderBreakdowns(db, ctx, p), quoteTotals(db, ctx, p), entryTotals(db, ctx, p),
    listServiceOrders(db, ctx, { status: "executada", limit: 500 }).then((r) => r.rows.filter((o) => o.service_date && o.service_date >= p.start && o.service_date <= p.end)),
  ]);
  const fin = can(ctx, "finance.view");
  const table = (title: string, rows: { label: string; n: number; cents: number }[], unit: string) => (
    <section className="card stack">
      <h2>{title}</h2>
      {rows.length === 0 ? <Empty title="Sem dados no mês" /> : (
        <div className="tablewrap"><table>
          <thead><tr><th>{unit}</th><th className="n">Qtd.</th><th className="n">Valor</th><th className="n">%</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.label}><td>{r.label}</td><td className="n">{r.n}</td><td className="n">{money(r.cents)}</td><td className="n">{tot.billed ? `${Math.round((r.cents / tot.billed) * 100)}%` : "—"}</td></tr>)}</tbody>
        </table></div>
      )}
    </section>
  );
  return (
    <>
      <PageHead title="Relatórios" sub={`Ordens de serviço concluídas em ${label} (pela data do serviço).`}>
        <Link className="btn ghost" href={`/relatorios?m=${addMonths(p.start, -1).slice(0, 7)}`}>‹ Mês anterior</Link>
        {m !== today.slice(0, 7) ? <Link className="btn ghost" href="/relatorios">Mês atual</Link> : null}
        <Link className="btn ghost" href={`/relatorios?m=${addMonths(p.start, 1).slice(0, 7)}`}>Próximo mês ›</Link>
      </PageHead>
      <div className="grid cols-3">
        <Stat label="Faturamento" value={fmtBRL(tot.billed)} tone="ol" hint={`${tot.done} OS concluídas`} />
        <Stat label="Ticket médio" value={tot.ticket == null ? "—" : fmtBRL(tot.ticket)} />
        {fin ? <Stat label="Recebido / a receber" value={`${fmtBRL(tot.paid)} / ${fmtBRL(tot.unpaid)}`} /> : null}
        {quotes ? <Stat label="Orçamentos aprovados" value={`${quotes.approved} de ${quotes.sent}`} hint={quotes.conversion == null ? "Nenhum enviado no mês" : `Taxa de aprovação ${Math.round(quotes.conversion * 100)}% · ${fmtBRL(quotes.approvedCents)}`} /> : null}
        {entries ? <Stat label="Gastos lançados" value={fmtBRL(entries.expense)} /> : null}
        {entries && fin ? <Stat label="Resultado do mês" value={fmtBRL(tot.paid + entries.income - entries.expense)} tone={tot.paid + entries.income - entries.expense >= 0 ? "ol" : "hi"} hint="Recebido das OS + outras receitas − gastos" /> : null}
      </div>
      <div className="grid cols-2">
        {table("Por serviço", br.byService, "Serviço")}
        {table("Por técnico", br.byStaff, "Técnico")}
      </div>
      {table("Por forma de pagamento", br.byMethod, "Forma")}
      <section className="card stack">
        <h2>OS concluídas no mês</h2>
        {orders.length === 0 ? <Empty title="Nenhuma OS concluída no mês" /> : (
          <div className="tablewrap"><table>
            <thead><tr><th>OS</th><th>Data</th><th>Cliente</th><th>Serviços</th><th>Técnico</th><th className="n">Valor</th><th>Pagamento</th></tr></thead>
            <tbody>{orders.map((o) => <tr key={o.id}><td className="mono"><Link href={`/os/${o.id}`}>#{o.number}</Link></td><td className="nowrap">{o.service_date ? fmtYmd(o.service_date) : "—"}</td><td>{o.customer_name}</td><td>{o.services || "—"}</td><td>{o.staff_name ?? "—"}</td><td className="n">{money(o.total_cents)}</td><td><OSPaymentBadge s={o.payment_status} /></td></tr>)}</tbody>
          </table></div>
        )}
      </section>
      {can(ctx, "data.export") ? <p><small>Precisa da planilha? Em <Link href="/admin/dados">Dados e backup</Link> dá para exportar.</small></p> : null}
    </>
  );
}
