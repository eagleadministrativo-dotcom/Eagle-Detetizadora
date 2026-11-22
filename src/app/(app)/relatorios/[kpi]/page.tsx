import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { isDomainError } from "@/server/errors";
import { getDashboard, indicatorRecords } from "@/server/services/reports";
import { fmtBRL, fmtPct } from "@/lib/money";
import { fmtDate, fmtDateTime, fmtYmd, monthStart, todayYmd } from "@/lib/dates";
import { Badge, Empty, PageHead, Pager } from "@/components/ui";

export const metadata = { title: "Indicador" };
const SIZE = 100;
const EXTRA: Record<string, { title: string; def: string; formula: string; source: string; exclusions: string }> = {
  costs: { title: "Custos variáveis", def: "Contas lançadas em categorias de custo, por competência.", formula: "Σ valor das contas de categoria Custo", source: "payables", exclusions: "Contas canceladas." },
  expenses: { title: "Despesas operacionais", def: "Contas de categorias de despesa e pró-labore, por competência.", formula: "Σ valor das contas de despesa/pró-labore", source: "payables", exclusions: "Contas canceladas; distribuição de lucros." },
  taxes: { title: "Impostos", def: "Contas de categorias de imposto, por competência.", formula: "Σ valor das contas de imposto", source: "payables", exclusions: "Contas canceladas." },
  non_operating: { title: "Itens não operacionais", def: "Contas de categorias não operacionais, por competência.", formula: "Σ valor", source: "payables", exclusions: "Contas canceladas." },
};

export default async function KpiPage({ params, searchParams }: { params: Promise<{ kpi: string }>; searchParams: Promise<{ de?: string; ate?: string; s?: string; p?: string }> }) {
  const { kpi } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("reports.view", "dashboard.full", "dashboard.own");
  const db = await getDb();
  const today = todayYmd();
  const p = /^\d{4}-\d{2}-\d{2}$/.test(sp.de ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(sp.ate ?? "") ? { start: sp.de!, end: sp.ate! } : { start: monthStart(today), end: today };
  let rec;
  try {
    rec = await indicatorRecords(db, ctx, kpi, p, sp.s || null);
  } catch (e) {
    if (isDomainError(e) && (e.code === "not_found" || e.code === "forbidden")) notFound();
    throw e;
  }
  const dash = await getDashboard(db, ctx, p, sp.s || null).catch(() => null);
  const k = dash?.kpis.find((x) => x.key === kpi) ?? (kpi === "operating_result" ? dash?.kpis.find((x) => x.key === "operating_result") : undefined);
  const ex = EXTRA[kpi];
  const page = Math.max(1, Number(sp.p) || 1);
  const rows = rec.rows.slice((page - 1) * SIZE, page * SIZE);
  const fmtVal = k ? (k.unit === "brl" ? fmtBRL(k.value) : k.unit === "pct" ? fmtPct(k.value) : k.value?.toLocaleString("pt-BR") ?? "—") : null;
  const isFin = !["occupancy", "revenue_per_hour"].includes(kpi);
  return (
    <>
      <PageHead title={k?.label ?? ex?.title ?? "Indicador"} sub={`${fmtYmd(p.start)} a ${fmtYmd(p.end)}`}>
        {can(ctx, "reports.export") ? <Link className="btn ghost" href={`/api/export/${kpi === "revenue" || kpi === "attendances" || kpi === "ticket" ? "atendimentos" : kpi.startsWith("receipts") ? "pagamentos" : kpi === "payables_open" ? "contas_a_pagar" : kpi === "receivables_open" ? "contas_a_receber" : "atendimentos"}`}>Exportar CSV</Link> : null}
        <Link className="btn ghost" href="/relatorios">Voltar</Link>
      </PageHead>
      <section className="card stack">
        {fmtVal ? <div className="mono" style={{ fontFamily: "var(--serif)", fontSize: "2rem" }}>{fmtVal}</div> : null}
        <div className="tablewrap"><table><tbody>
          <tr><th>Definição</th><td>{k?.definition ?? ex?.def}</td></tr>
          <tr><th>Fórmula</th><td>{k?.formula ?? ex?.formula}</td></tr>
          <tr><th>Origem dos dados</th><td>{k?.source ?? ex?.source}</td></tr>
          <tr><th>Período</th><td>{fmtYmd(p.start)} a {fmtYmd(p.end)}</td></tr>
          <tr><th>Exclusões</th><td>{k?.exclusions ?? ex?.exclusions}</td></tr>
          <tr><th>Atualizado em</th><td>{fmtDateTime(dash?.updatedAt ?? new Date())}</td></tr>
          {k?.notReconciledCents ? <tr><th>Conciliação</th><td><Badge tone="warn">não conciliado</Badge> {fmtBRL(k.notReconciledCents)} registrados ainda sem conferência</td></tr> : null}
        </tbody></table></div>
        {k?.warning ? <div className="alert warn">{k.warning}</div> : null}
      </section>
      <section className="stack">
        <div className="row"><h2>Registros que compõem o resultado</h2><Badge>{rec.rows.length}</Badge>{rec.total != null && isFin ? <b className="mono">Soma: {fmtBRL(rec.total)}</b> : null}</div>
        {rows.length === 0 ? <Empty title="Nenhum registro no período">O indicador está zerado porque não há lançamentos que o componham.</Empty> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Data</th><th>Descrição</th><th>Detalhe</th>{isFin ? <th className="n">Valor</th> : null}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td className="nowrap">{r.date ? (typeof r.date === "string" && r.date.length === 10 ? fmtYmd(r.date) : fmtDate(r.date)) : "—"}</td><td>{r.href ? <Link href={r.href}>{r.title}</Link> : r.title}</td><td>{r.detail}</td>{isFin ? <td className="n">{r.cents == null ? "—" : fmtBRL(r.cents)}</td> : null}</tr>))}</tbody>
          </table></div>
        )}
        <Pager base={`/relatorios/${kpi}?de=${p.start}&ate=${p.end}`} page={page} total={rec.rows.length} size={SIZE} />
        {rec.rows.length >= 500 ? <small>Exibindo os 500 registros mais recentes; use a exportação para o conjunto completo.</small> : null}
      </section>
    </>
  );
}
