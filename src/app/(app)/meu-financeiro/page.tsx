import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { listEntries, listSettlements, totals } from "@/server/services/commissions";
import { staffGoals, staffSeries, staffStats, topServices } from "@/server/services/team";
import { PRESETS, resolvePeriod } from "@/lib/period";
import { addMonths, fmtYmd, monthStart, previousPeriod, todayYmd, daysBetween } from "@/lib/dates";
import { fmtBRL, fmtPct } from "@/lib/money";
import { BarChart, HBars, LineChart } from "@/components/charts";
import { Empty, Flash, PageHead, Pager, PeriodBar, Seg, Stat, money } from "@/components/ui";
import { Entries, StateBadge } from "@/components/commission-ui";

export const metadata = { title: "Meu Financeiro" };
type SP = { r?: string; de?: string; ate?: string; g?: string; k?: string; e?: string; q?: string; p?: string; ok?: string; erro?: string };

export default async function MyFinance({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("finance.own");
  if (!ctx.staffId) return <><PageHead title="Meu Financeiro" /><Empty title="Seu usuário não está vinculado a um profissional">Peça ao proprietário para vincular em Usuários.</Empty></>;
  const sid = ctx.staffId;
  const db = await getDb();
  const { preset, p } = resolvePeriod(sp);
  const len = daysBetween(p.start, p.end) + 1;
  const grain = sp.g === "semana" || sp.g === "mes" || sp.g === "dia" ? sp.g : len > 92 ? "mes" : len > 31 ? "semana" : "dia";
  // comparação semanal/mensal precisa de mais história do que o período escolhido
  const chartP = grain === "mes" ? { start: addMonths(monthStart(p.end), -11), end: p.end } : grain === "semana" ? { start: addMonths(p.end, -3), end: p.end } : p;
  const page = Math.max(1, Number(sp.p) || 1);
  const today = todayYmd();
  const [s, prev, t, series, top, sets, ent, goals] = await Promise.all([
    staffStats(db, ctx, p, sid), staffStats(db, ctx, previousPeriod(p), sid), totals(db, ctx, p, sid), staffSeries(db, ctx, chartP, grain, sid), topServices(db, ctx, p, sid), listSettlements(db, ctx, { staffId: sid, limit: 8 }),
    listEntries(db, ctx, { period: p, staffId: sid, kind: sp.k, state: sp.e, search: sp.q, limit: 20, offset: (page - 1) * 20 }), staffGoals(db, ctx, sid, today.slice(0, 7)),
  ]);
  const keep = { ...(sp.g ? { g: sp.g } : {}) };
  const base = new URLSearchParams({ de: p.start, ate: p.end, ...keep, ...(sp.k ? { k: sp.k } : {}), ...(sp.e ? { e: sp.e } : {}), ...(sp.q ? { q: sp.q } : {}) }).toString();
  const g = (v: string) => `/meu-financeiro?${new URLSearchParams({ de: p.start, ate: p.end, g: v }).toString()}`;
  const delta = (a: number, b: number) => (b ? `${a >= b ? "▲" : "▼"} ${fmtPct(Math.abs(((a - b) / b) * 100), 0)} vs período anterior` : undefined);
  const cum = series.map((x, i) => ({ date: x.date, v: series.slice(0, i + 1).reduce((a, y) => a + y.commission, 0) }));
  return (
    <>
      <PageHead title="Meu Financeiro" sub="Produção é o valor do que você atendeu. Comissão é o que você recebe." />
      <Flash ok={sp.ok} erro={sp.erro} />
      <PeriodBar base="/meu-financeiro" preset={preset} presets={PRESETS} p={p} keep={keep} />
      <div className="stats">
        <Stat label="Total a receber" value={money(t.due + t.adjustments + t.approvedOpen)} hint="Prontas e aprovadas, com ajustes" tone="hi" />
        <Stat label="Comissões geradas" value={money(t.generated)} tone="ol" />
        <Stat label="Pendentes" value={money(t.pending)} hint="Aguardam a conferência do recebimento" />
        <Stat label="Aprovadas" value={money(t.approvedOpen)} />
        <Stat label="Pagas" value={money(t.paid)} />
      </div>
      <div className="stats">
        <Stat label="Produção em serviços" value={money(s.services)} hint={delta(s.services, prev.services)} />
        <Stat label="Produtos vendidos" value={money(s.products)} hint={`${s.units} unidade(s)`} />
        <Stat label="Atendimentos" value={s.n} hint={delta(s.n, prev.n)} />
        <Stat label="Clientes atendidos" value={s.customers} />
        <Stat label="Ticket médio" value={money(s.ticket)} hint={s.ticket && prev.ticket ? delta(s.ticket, prev.ticket) : undefined} />
      </div>
      {goals.length ? <section className="card stack"><h2>Minhas metas do mês</h2>{goals.map((x) => <div key={x.id}><div className="sumrow"><span>{x.label}</span><span className="mono">{x.unit === "brl" ? fmtBRL(x.value) : x.value} de {x.unit === "brl" ? fmtBRL(x.target) : x.target} · {x.pct}%</span></div><div className="track2" role="progressbar" aria-valuenow={Math.min(100, x.pct)} aria-valuemin={0} aria-valuemax={100} aria-label={x.label}><span style={{ width: `${Math.min(100, x.pct)}%` }} /></div></div>)}</section> : null}
      <div className="grid asym">
        <section className="card stack">
          <div className="calbar"><h2>Evolução da produção</h2><Seg items={[{ href: g("dia"), label: "Dia", active: grain === "dia" }, { href: g("semana"), label: "Semana", active: grain === "semana" }, { href: g("mes"), label: "Mês", active: grain === "mes" }]} /></div>
          {series.length ? <><BarChart data={series.map((x) => ({ date: x.date, a: x.services, b: x.products || undefined }))} /><div className="legend"><span><i style={{ background: "var(--chart-1)" }} />Serviços</span><span><i style={{ background: "var(--chart-2)" }} />Produtos</span></div></> : <Empty title="Sem produção no período" />}
        </section>
        <section className="card stack"><h2>Serviços mais realizados</h2>{top.length ? <HBars rows={top.map((x) => ({ label: x.name, value: x.qty, text: `${x.qty}× · ${fmtBRL(x.cents)}` }))} /> : <Empty title="Sem serviços no período" />}</section>
      </div>
      <div className="grid asym">
        <section className="card stack"><h2>Comissões acumuladas</h2>{cum.length > 1 ? <LineChart data={cum} /> : <Empty title="Período curto para o gráfico" />}</section>
        <section className="card stack"><h2>Repasses</h2>{sets.length === 0 ? <Empty title="Nenhum repasse ainda" /> : sets.map((x) => <Link key={x.id} className="row" href={`/comissoes/${x.id}`}><span className="grow">{fmtYmd(x.period_start)} a {fmtYmd(x.period_end)}</span><StateBadge s={x.state} />{money(x.total_cents)}</Link>)}</section>
      </div>
      <section className="stack">
        <h2>Histórico</h2>
        <form className="filters" method="get"><input type="hidden" name="de" value={p.start} /><input type="hidden" name="ate" value={p.end} />
          <label>Serviço ou produto<input name="q" defaultValue={sp.q ?? ""} /></label>
          <label>Tipo<select name="k" defaultValue={sp.k ?? ""}><option value="">Todos</option><option value="servico">Serviço</option><option value="produto">Produto</option></select></label>
          <label>Situação<select name="e" defaultValue={sp.e ?? ""}><option value="">Todas</option><option value="pendente">Pendente</option><option value="exigivel">A receber</option><option value="aprovada">Aprovada</option><option value="paga">Paga</option><option value="cancelada">Cancelada</option></select></label>
          <button className="btn ghost" type="submit">Filtrar</button></form>
        <Entries rows={ent.rows} />
        {ent.total > 20 ? <Pager base={`/meu-financeiro?${base}`} page={page} total={ent.total} size={20} /> : null}
      </section>
    </>
  );
}
