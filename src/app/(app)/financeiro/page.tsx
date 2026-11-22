import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { getDashboard } from "@/server/services/reports";
import { listPayables } from "@/server/services/finance";
import { findOpenSession } from "@/server/services/cash";
import { addDays, fmtDateTime, fmtYmd, monthStart, todayYmd } from "@/lib/dates";
import { Badge, Empty, Flash, KpiCard, PageHead, money } from "@/components/ui";

export const metadata = { title: "Financeiro" };

export default async function FinanceHome({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("finance.view", "cash.manage");
  const db = await getDb();
  if (!can(ctx, "finance.view")) {
    return (<><PageHead title="Financeiro" /><div className="card"><p>Use o <Link href="/financeiro/caixa">Caixa</Link> para abrir, movimentar e fechar o caixa.</p></div></>);
  }
  const today = todayYmd();
  const p = { start: monthStart(today), end: today };
  const dash = await getDashboard(db, ctx, p);
  const open = await findOpenSession(db.query, ctx.unitId);
  const upcoming = await listPayables(db, ctx, { filter: "abertas", to: addDays(today, 7), limit: 8 });
  const keys = ["revenue", "receipts_confirmed", "operating_result", "cash_balance", "receivables_open", "payables_open"];
  const kpis = dash.kpis.filter((k) => keys.includes(k.key));
  const qs = `de=${p.start}&ate=${p.end}`;
  return (
    <>
      <PageHead title="Financeiro" sub={`Mês atual · ${fmtYmd(p.start)} a ${fmtYmd(p.end)}`} />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="row">
        {open ? <Badge tone="ok">Caixa aberto desde {fmtDateTime(open.opened_at)}</Badge> : <Badge>Caixa fechado</Badge>}
        <Link className="btn small ghost" href="/financeiro/caixa">Ir ao caixa</Link>
      </div>
      {dash.alerts.length ? <div className="stack">{dash.alerts.map((a, i) => <div className={`alert ${a.severity}`} key={i}>{a.href ? <Link href={a.href}>{a.message}</Link> : a.message}</div>)}</div> : null}
      <section className="kpis">{kpis.map((k) => <KpiCard key={k.key} k={k} href={`/relatorios/${k.key}?${qs}`} />)}</section>
      <div className="grid cols-2">
        <section className="card stack">
          <h2>Vencendo nos próximos 7 dias</h2>
          {upcoming.rows.length === 0 ? <Empty title="Nenhuma conta a vencer" /> : (
            <div className="tablewrap"><table><tbody>
              {upcoming.rows.map((r) => <tr key={r.id}><td className="nowrap">{fmtYmd(r.due_date)}{r.overdue ? <> <Badge tone="bad">vencida</Badge></> : null}</td><td><Link href={`/financeiro/pagar/${r.id}`}>{r.description}</Link></td><td className="n">{money(r.amount_cents - r.paid_cents)}</td></tr>)}
            </tbody></table></div>
          )}
          <Link className="btn ghost small" href="/financeiro/pagar">Todas as contas a pagar</Link>
        </section>
        <section className="card stack">
          <h2>Atalhos</h2>
          <div className="stack">
            <Link href="/financeiro/conciliacao">Conciliação de pagamentos</Link>
            <Link href="/financeiro/receber">Contas a receber</Link>
            <Link href="/financeiro/dre">DRE gerencial</Link>
            <Link href="/financeiro/fluxo">Fluxo de caixa e projeção</Link>
            <Link href="/financeiro/metas">Metas e reservas</Link>
            <Link href="/financeiro/fechamento">Fechamento mensal</Link>
          </div>
        </section>
      </div>
    </>
  );
}
