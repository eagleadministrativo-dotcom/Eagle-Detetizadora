import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { goalsProgress, simulateGoal, getDashboard } from "@/server/services/reports";
import { addDays, fmtYmd, monthEnd, monthStart, todayYmd } from "@/lib/dates";
import { fmtBRL, fmtPct } from "@/lib/money";
import { Badge, Empty, Field, Flash, PageHead } from "@/components/ui";
import { saveGoalAction } from "@/app/actions/finance";

export const metadata = { title: "Metas e reservas" };
const ST: Record<string, [string, string]> = { atingida: ["ok", "Atingida"], adiantada: ["ok", "Adiantada"], no_ritmo: ["info", "No ritmo"], atrasada: ["warn", "Atrasada"], sem_dados: ["", "Sem dados"] };

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("finance.view");
  const db = await getDb();
  const goals = await goalsProgress(db, ctx);
  const today = todayYmd();
  const dash = await getDashboard(db, ctx, { start: addDays(today, -29), end: today });
  const ticket = dash.kpis.find((k) => k.key === "ticket")?.value ?? null;
  return (
    <>
      <PageHead title="Metas e reservas" sub="Meta de receita e de resultado por período; meta de reserva compara com o saldo total das contas." />
      <Flash ok={sp.ok} erro={sp.erro} />
      {goals.length === 0 ? <Empty title="Nenhuma meta cadastrada">Defina uma meta de receita do mês para acompanhar o ritmo.</Empty> : (
        <div className="grid cols-2">
          {goals.map((g) => {
            const sim = g.kind === "receita" && g.isActive ? simulateGoal(g, ticket) : null;
            const [tone, label] = ST[g.status];
            return (
              <section className="card stack" key={g.id} style={{ opacity: g.isActive ? 1 : 0.6 }}>
                <div className="row"><h3>{g.name}</h3><Badge tone={tone as "ok"}>{label}</Badge>{!g.isActive ? <Badge>inativa</Badge> : null}</div>
                <small>{g.kind === "reserva" ? "Reserva (saldo total das contas)" : `${g.kind === "receita" ? "Receita de serviços" : "Resultado operacional"} · ${g.periodStart ? fmtYmd(g.periodStart) : ""} a ${g.periodEnd ? fmtYmd(g.periodEnd) : ""}`}</small>
                <div className="row"><b className="mono" style={{ fontFamily: "var(--serif)", fontSize: "1.3rem" }}>{fmtBRL(g.current)}</b><span className="muted">de {fmtBRL(g.target)} ({g.pct == null ? "—" : fmtPct(g.pct, 0)})</span></div>
                <div className="hbar" style={{ gridTemplateColumns: "1fr" }}><div className="track"><div className="fill" style={{ width: `${Math.min(100, g.pct ?? 0)}%` }} /></div></div>
                {g.expectedPct != null ? <small>Ritmo esperado hoje: {fmtPct(g.expectedPct, 0)} do período decorrido.</small> : null}
                {sim ? <div className="alert">Faltam <b>{fmtBRL(sim.missing)}</b> em {sim.daysLeft} dia(s): cerca de <b>{fmtBRL(sim.perDay)}</b> por dia{sim.attendancesPerDay ? ` (≈ ${sim.attendancesPerDay.toString().replace(".", ",")} atendimentos/dia ao ticket médio de ${fmtBRL(ticket)})` : ""}. <Badge tone="info">simulação</Badge></div> : null}
              </section>
            );
          })}
        </div>
      )}
      {can(ctx, "finance.goals") ? (
        <form action={saveGoalAction} className="card form">
          <h2>Nova meta</h2>
          <div className="fields">
            <Field label="Tipo"><select name="kind"><option value="receita">Receita de serviços</option><option value="resultado">Resultado operacional</option><option value="reserva">Reserva (saldo das contas)</option></select></Field>
            <Field label="Nome"><input name="name" required placeholder="Ex.: Receita de dezembro" /></Field>
            <Field label="Valor da meta (R$)"><input name="target" inputMode="decimal" required /></Field>
            <Field label="Início"><input type="date" name="start" defaultValue={monthStart(today)} /></Field>
            <Field label="Fim"><input type="date" name="end" defaultValue={monthEnd(today)} /></Field>
          </div>
          <small>Para reserva, as datas são opcionais.</small>
          <div><button className="btn accent" type="submit">Salvar meta</button></div>
        </form>
      ) : null}
    </>
  );
}
