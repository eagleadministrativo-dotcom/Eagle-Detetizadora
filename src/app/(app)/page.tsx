import Link from "next/link";
import { getDb } from "@/server/db";
import { requireSession } from "@/server/session";
import { can } from "@/server/core";
import { getDashboard } from "@/server/services/reports";
import { listAppointments } from "@/server/services/agenda";
import { listCatalog } from "@/server/services/catalog";
import { addDays, dayEndUtc, dayStartUtc, fmtTime, fmtYmd, monthEnd, monthStart, addMonths, todayYmd } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { ApptBadge, Badge, Empty, Flash, KpiCard, PageHead, Seg } from "@/components/ui";
import { BarChart, HBars, Heatmap, LineChart } from "@/components/charts";

export const metadata = { title: "Visão geral" };

type SP = { de?: string; ate?: string; r?: string; s?: string; ok?: string; erro?: string };

function resolvePeriod(sp: SP) {
  const today = todayYmd();
  const preset = sp.r ?? "mes";
  if (sp.de && sp.ate && /^\d{4}-\d{2}-\d{2}$/.test(sp.de) && /^\d{4}-\d{2}-\d{2}$/.test(sp.ate) && sp.de <= sp.ate) return { preset: "custom", p: { start: sp.de, end: sp.ate } };
  if (preset === "hoje") return { preset, p: { start: today, end: today } };
  if (preset === "7d") return { preset, p: { start: addDays(today, -6), end: today } };
  if (preset === "mes-ant") { const m = addMonths(today, -1); return { preset, p: { start: monthStart(m), end: monthEnd(m) } }; }
  return { preset: "mes", p: { start: monthStart(today), end: today } };
}

export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const s = await requireSession();
  const db = await getDb();
  const { ctx } = s;
  if (!can(ctx, "dashboard.full") && !can(ctx, "dashboard.own")) {
    return <PageHead title="Bem-vindo" sub="Use o menu para acessar suas áreas." />;
  }
  const full = can(ctx, "dashboard.full");
  const { preset, p } = resolvePeriod(sp);
  const catalog = full ? await listCatalog(db, ctx.unitId) : null;
  const staffId = full && sp.s ? sp.s : null;
  const dash = await getDashboard(db, ctx, p, staffId);
  const qs = new URLSearchParams({ de: p.start, ate: p.end, ...(staffId ? { s: staffId } : {}) }).toString();
  const base = (r: string) => `/?r=${r}${staffId ? `&s=${staffId}` : ""}`;

  const today = todayYmd();
  const mine = await listAppointments(db, ctx, { from: dayStartUtc(today), to: dayEndUtc(today) }).catch(() => []);
  const nextUp = mine.filter((a) => a.status === "agendado" || a.status === "em_atendimento");

  const heroKeys = full ? ["revenue", "operating_result", "cash_balance"] : ["revenue"];
  const heroes = heroKeys.map((key) => dash.kpis.find((k) => k.key === key)).filter((k): k is NonNullable<typeof k> => !!k);
  const rest = dash.kpis.filter((k) => !heroes.includes(k));

  return (
    <>
      <PageHead eyebrow={full ? "Painel do proprietário" : "Agenda pessoal"} title={full ? "Visão geral" : "Meu dia"} sub={`${fmtYmd(p.start)} a ${fmtYmd(p.end)} · atualizado às ${fmtTime(dash.updatedAt)}`}>
        {full ? (
          <>
            <Seg items={[
              { href: base("hoje"), label: "Hoje", active: preset === "hoje" }, { href: base("7d"), label: "7 dias", active: preset === "7d" },
              { href: base("mes"), label: "Mês atual", active: preset === "mes" }, { href: base("mes-ant"), label: "Mês anterior", active: preset === "mes-ant" },
            ]} />
          </>
        ) : (
          <Seg items={[{ href: "/?r=hoje", label: "Hoje", active: preset === "hoje" }, { href: "/?r=7d", label: "7 dias", active: preset === "7d" }, { href: "/?r=mes", label: "Mês", active: preset === "mes" }]} />
        )}
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />

      {full ? (
        <form className="filters card flat" method="get">
          <label>De<input type="date" name="de" defaultValue={p.start} /></label>
          <label>Até<input type="date" name="ate" defaultValue={p.end} /></label>
          <label>Profissional
            <select name="s" defaultValue={staffId ?? ""}>
              <option value="">Todos</option>
              {catalog?.staff.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <button className="btn ghost" type="submit">Aplicar intervalo</button>
        </form>
      ) : null}

      {dash.alerts.length ? (
        <div className="stack">
          {dash.alerts.map((a, i) => (
            <div className={`alert ${a.severity}`} key={i}>{a.href ? <Link href={a.href}>{a.message}</Link> : a.message}</div>
          ))}
        </div>
      ) : null}

      {!full ? (
        <section className="card stack">
          <h2>Próximos atendimentos de hoje</h2>
          {nextUp.length === 0 ? <Empty title="Nada agendado para hoje">Sem atendimentos pendentes. Use &quot;Agenda&quot; para marcar horários.</Empty> : (
            <div className="daylist">
              {nextUp.map((a) => (
                <Link key={a.id} className="item" href={`/agenda/${a.id}`}>
                  <span className="t">{fmtTime(a.starts_at)}</span>
                  <span><b>{a.customer_name}</b><br /><small>{a.services}</small></span>
                  <ApptBadge s={a.status} />
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {heroes.length ? (
        <section className="heroes" aria-label="Indicadores principais">
          {heroes.map((k, i) => <KpiCard key={k.key} k={k} hero={(["olive", "wine", "stone"] as const)[i]} href={`/relatorios/${k.key}?${qs}`} />)}
        </section>
      ) : null}
      <section className="kpis" aria-label="Indicadores">
        {rest.map((k) => <KpiCard key={k.key} k={k} href={`/relatorios/${k.key}?${qs}`} />)}
      </section>

      {dash.accounts.length ? (
        <section className="card">
          <h2>Saldo por conta</h2>
          <div className="row" style={{ marginTop: 8, gap: 18 }}>
            {dash.accounts.map((a) => <div key={a.id}><small>{a.name}</small><div className="mono" style={{ fontFamily: "var(--serif)", fontSize: "1.2rem" }}>{fmtBRL(a.balance_cents)}</div></div>)}
          </div>
          <small>Saldo = saldo inicial cadastrado + recebimentos confirmados (líquidos de taxas) + aportes − contas pagas. <Link href="/relatorios/cash_balance">Ver composição</Link>.</small>
        </section>
      ) : null}

      <div className="grid asym">
        <section className="card">
          <h2>{full ? "Receita × custos e despesas por dia" : "Receita por dia"}</h2>
          {dash.revenueByDay.some((d) => d.cents || d.expenses) ? (
            <>
              <BarChart data={dash.revenueByDay.map((d) => ({ date: d.date, a: d.cents, b: full ? d.expenses : undefined }))} />
              {full ? <div className="legend"><span><i style={{ background: "var(--chart-1)" }} />Receita de serviços</span><span><i style={{ background: "var(--chart-2)", opacity: 0.7 }} />Custos e despesas (competência)</span></div> : null}
            </>
          ) : <Empty title="Sem movimento no período">Nenhum atendimento concluído nem lançamento neste intervalo.</Empty>}
        </section>
        {full ? (
          <section className="card editorial">
            <h2>Evolução do resultado (acumulado)</h2>
            {dash.resultSeries.length > 1 ? <LineChart data={dash.resultSeries.map((d) => ({ date: d.date, v: d.cents }))} /> : <Empty title="Período curto demais para a evolução" />}
            <small>Receita de serviços e produtos − custos e despesas lançados por competência.</small>
          </section>
        ) : (
          <section className="card">
            <h2>Serviços mais realizados</h2>
            {dash.topServices.length ? <HBars rows={dash.topServices.map((t) => ({ label: t.name, value: t.cents, text: `${t.qty}× · ${fmtBRL(t.cents)}` }))} /> : <Empty title="Sem serviços no período" />}
          </section>
        )}
      </div>

      {full ? (
        <div className="grid cols-2">
          <section className="card">
            <h2>Serviços mais realizados</h2>
            {dash.topServices.length ? <HBars rows={dash.topServices.map((t) => ({ label: t.name, value: t.cents, text: `${t.qty}× · ${fmtBRL(t.cents)}` }))} /> : <Empty title="Sem serviços no período" />}
          </section>
          <section className="card">
            <h2>Pagamentos por modalidade</h2>
            {dash.byMethod.length ? <HBars rows={dash.byMethod.map((t) => ({ label: t.name, value: Math.max(t.cents, 0), text: fmtBRL(t.cents) }))} /> : <Empty title="Sem pagamentos no período" />}
          </section>
        </div>
      ) : null}

      <section className="card analytic">
        <h2>Ocupação por dia e horário</h2>
        {dash.heat.length ? <Heatmap cells={dash.heat} /> : <Empty title="Sem atendimentos no período" />}
        <small>Cada célula conta os atendimentos que começaram naquele dia da semana e horário. É uma contagem, não um percentual.</small>
      </section>
      {full && dash.warnings.length ? <div className="stack">{dash.warnings.map((w) => <div className="alert warn" key={w}>{w}</div>)}</div> : null}
      <p><Badge>Conferência manual</Badge> <small>Valores &quot;confirmados&quot; e &quot;conciliados&quot; dependem da conferência registrada por um operador; não há integração bancária automática.</small></p>
    </>
  );
}
