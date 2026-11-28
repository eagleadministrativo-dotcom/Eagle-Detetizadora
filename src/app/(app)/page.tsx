import Link from "next/link";
import { getDb } from "@/server/db";
import { requireSession } from "@/server/session";
import { can } from "@/server/core";
import { listAppointments } from "@/server/services/agenda";
import { listCatalog } from "@/server/services/catalog";
import { entryTotals, orderBreakdowns, orderTotals, quoteTotals, returnTotals } from "@/server/services/eagle-stats";
import { addDays, dayEndUtc, dayStartUtc, fmtTime, fmtYmd, monthEnd, monthStart, addMonths, todayYmd } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { ApptBadge, Empty, Flash, PageHead, Seg, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { LiveAgenda } from "@/components/live";
import { BarChart, Donut, HBars } from "@/components/charts";

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

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

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
  const today = todayYmd();
  // período anterior do mesmo tamanho, para comparar
  const len = Math.round((Date.parse(p.end) - Date.parse(p.start)) / 86400000) + 1;
  const prevP = { start: addDays(p.start, -len), end: addDays(p.start, -1) };

  const [tot, prev, br, quotes, rets, entries, mine] = await Promise.all([
    orderTotals(db, ctx, p, staffId), orderTotals(db, ctx, prevP, staffId), orderBreakdowns(db, ctx, p, staffId),
    full ? quoteTotals(db, ctx, p) : Promise.resolve(null), returnTotals(db, ctx), full ? entryTotals(db, ctx, p) : Promise.resolve(null),
    listAppointments(db, ctx, { from: dayStartUtc(today), to: dayEndUtc(today) }).catch(() => []),
  ]);
  const nextUp = mine.filter((a) => a.status === "agendado" || a.status === "em_atendimento");
  const base = (r: string) => `/?r=${r}${staffId ? `&s=${staffId}` : ""}`;
  const custom = preset === "custom" || !!staffId;
  const delta = (a: number, b: number) => (b ? <>{a >= b ? "▲" : "▼"} {Math.abs(Math.round(((a - b) / b) * 100))}% vs período anterior</> : null);

  const alerts: { href: string; text: string; tone: "critico" | "atencao" | "info" }[] = [];
  if (rets?.overdue) alerts.push({ href: "/retornos", text: `${rets.overdue} retorno(s) atrasado(s)`, tone: "critico" });
  if (rets?.today) alerts.push({ href: "/retornos", text: `${rets.today} retorno(s) para hoje`, tone: "atencao" });
  if (tot.late) alerts.push({ href: "/os?s=aberta", text: `${tot.late} OS aberta(s) com a data do serviço já passada: conclua ou reagende`, tone: "atencao" });
  if (quotes?.expiring) alerts.push({ href: "/orcamentos?s=enviado", text: `${quotes.expiring} orçamento(s) vencendo nos próximos 7 dias`, tone: "info" });
  if (full && can(ctx, "finance.view") && tot.unpaid) alerts.push({ href: "/financeiro#receber", text: `${fmtBRL(tot.unpaid)} de OS concluídas no período ainda sem pagamento`, tone: "atencao" });

  return (
    <>
      <PageHead eyebrow={full ? "Painel do administrador" : "Seu dia"} title="Olá," accent={s.user.fullName.trim().split(" ")[0]} sub={`${full ? "Resumo da Eagle" : "Seus serviços"} · ${fmtYmd(p.start)} a ${fmtYmd(p.end)}`}>
        <Seg items={[
          { href: base("hoje"), label: "Hoje", active: preset === "hoje" }, { href: base("7d"), label: "7 dias", active: preset === "7d" },
          { href: base("mes"), label: "Mês atual", active: preset === "mes" }, { href: base("mes-ant"), label: "Mês anterior", active: preset === "mes-ant" },
        ]} />
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <LiveAgenda every={30000} />

      {full ? (
        <details className="filters-d" open={custom}>
          <summary><Icon name="search" />Período personalizado e técnico{custom ? <span className="badge info">ativo</span> : null}</summary>
          <form className="filters" method="get">
            <label>De<input type="date" name="de" defaultValue={p.start} /></label>
            <label>Até<input type="date" name="ate" defaultValue={p.end} /></label>
            <label>Técnico
              <select name="s" defaultValue={staffId ?? ""}>
                <option value="">Todos</option>
                {catalog?.staff.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <button className="btn ghost" type="submit">Aplicar</button>
          </form>
        </details>
      ) : null}

      {alerts.length ? (
        <nav className="signals" aria-label="Avisos">
          {alerts.map((a) => <Link key={a.text} className={`signal ${a.tone}`} href={a.href}><i className="sg-dot" aria-hidden="true" /><span>{a.text}</span><Icon name="arrow" className="ic sg-go" /></Link>)}
        </nav>
      ) : null}

      <h2 className="secline"><i>01</i>Hoje</h2>
      <section className="card today" aria-label="Serviços de hoje">
        <header><h2>Agenda de hoje</h2><Link className="btn small ghost" href="/agenda">Agenda</Link></header>
        {nextUp.length === 0 ? <Empty title="Nada pendente para hoje">Sem serviços agendados para hoje.</Empty> : (
          <div className="daylist">
            {nextUp.slice(0, 6).map((a) => (
              <Link key={a.id} className="item" href={`/agenda/${a.id}`}>
                <span className="t">{fmtTime(a.starts_at)}</span>
                <span><b>{a.customer_name}</b><br /><small>{a.services}{full ? ` · ${a.staff_name}` : ""}</small></span>
                <ApptBadge s={a.status} />
              </Link>
            ))}
            {nextUp.length > 6 ? <Link className="more" href="/agenda">+ {nextUp.length - 6} no dia</Link> : null}
          </div>
        )}
      </section>

      <h2 className="secline"><i>02</i>Ordens de serviço</h2>
      <div className="grid cols-3">
        <Stat label="Faturamento (OS concluídas)" value={fmtBRL(tot.billed)} tone="ol" hint={delta(tot.billed, prev.billed) ?? "Valor das OS concluídas no período, pela data do serviço."} />
        <Stat label="OS concluídas" value={tot.done} hint={delta(tot.done, prev.done) ?? <Link href="/os?s=executada">Ver lista</Link>} />
        <Stat label="Ticket médio" value={tot.ticket == null ? "—" : fmtBRL(tot.ticket)} hint="Faturamento ÷ OS concluídas" />
        {full && can(ctx, "finance.view") ? <Stat label="Recebido (OS pagas)" value={fmtBRL(tot.paid)} hint={<Link href="/financeiro">Financeiro</Link>} /> : null}
        {full && can(ctx, "finance.view") ? <Stat label="A receber do período" value={fmtBRL(tot.unpaid)} tone={tot.unpaid ? "hi" : ""} hint={<Link href="/financeiro#receber">Cobrar</Link>} /> : null}
        <Stat label="OS abertas" value={tot.open} tone={tot.late ? "hi" : ""} hint={tot.late ? `${tot.late} com a data já passada` : <Link href="/os?s=aberta">Ver abertas</Link>} />
      </div>

      {quotes || rets || entries ? (
        <>
          <h2 className="secline"><i>03</i>Vendas, retornos e caixa</h2>
          <div className="grid cols-3">
            {quotes ? <Stat label="Orçamentos emitidos" value={quotes.created} hint={`${quotes.sent} enviados · ${quotes.approved} aprovados · ${quotes.refused} recusados`} /> : null}
            {quotes ? <Stat label="Taxa de aprovação" value={pct(quotes.conversion)} tone="ol" hint={`Aprovados ${fmtBRL(quotes.approvedCents)}`} /> : null}
            {rets ? <Stat label="Retornos" value={rets.overdue + rets.today + rets.week} tone={rets.overdue ? "hi" : ""} hint={<Link href="/retornos">{rets.overdue} atrasados · {rets.today} hoje · {rets.week} nos próximos 7 dias</Link>} /> : null}
            {entries ? <Stat label="Gastos lançados" value={fmtBRL(entries.expense)} hint={<Link href="/financeiro">Lançamentos</Link>} /> : null}
            {entries && can(ctx, "finance.view") ? <Stat label="Saldo do período" value={fmtBRL(tot.paid + entries.income - entries.expense)} tone={tot.paid + entries.income - entries.expense >= 0 ? "ol" : "hi"} hint="Recebido das OS + outras receitas − gastos" /> : null}
          </div>
        </>
      ) : null}

      <h2 className="secline"><i>{quotes || rets || entries ? "04" : "03"}</i>Análises</h2>
      <section className="card">
        <h2>Faturamento por dia</h2>
        {br.byDay.some((d) => d.cents) ? <BarChart data={br.byDay.map((d) => ({ date: d.date, a: d.cents }))} /> : <Empty title="Sem OS concluídas no período" />}
      </section>
      <div className="grid cols-2">
        <section className="card">
          <h2>Serviços mais feitos</h2>
          {br.byService.length ? <HBars rows={br.byService.slice(0, 8).map((t) => ({ label: t.label, value: t.cents, text: `${t.n}× · ${fmtBRL(t.cents)}` }))} /> : <Empty title="Sem serviços no período" />}
        </section>
        {full ? (
          <section className="card">
            <h2>Por técnico</h2>
            {br.byStaff.length ? <HBars rows={br.byStaff.map((t) => ({ label: t.label, value: t.cents, text: `${t.n} OS · ${fmtBRL(t.cents)}` }))} /> : <Empty title="Sem OS no período" />}
          </section>
        ) : null}
      </div>
      {full && br.byMethod.length ? (
        <section className="card">
          <h2>Forma de pagamento</h2>
          <Donut rows={br.byMethod.map((t) => ({ label: t.label, value: t.cents, text: fmtBRL(t.cents) }))} center={fmtBRL(tot.billed).replace(",00", "")} />
        </section>
      ) : null}
    </>
  );
}
