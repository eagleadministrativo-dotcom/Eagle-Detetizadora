import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { GOAL_METRICS, staffGoals, teamOverview } from "@/server/services/team";
import { PRESETS, resolvePeriod } from "@/lib/period";
import { todayYmd } from "@/lib/dates";
import { fmtBRL, fmtPct } from "@/lib/money";
import { HBars } from "@/components/charts";
import { Empty, Field, Flash, PageHead, PeriodBar, Stat, money } from "@/components/ui";
import { removeGoalAction, staffGoalAction } from "@/app/actions/commissions";

export const metadata = { title: "Painel da equipe" };
type SP = { r?: string; de?: string; ate?: string; s?: string; ok?: string; erro?: string };

export default async function Team({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("team.view");
  const db = await getDb();
  const { preset, p } = resolvePeriod(sp);
  const staff = /^[0-9a-f-]{36}$/.test(sp.s ?? "") ? sp.s! : null;
  const all = await teamOverview(db, ctx, p);
  const rows = staff ? all.filter((r) => r.staff_id === staff) : all;
  const sum = (k: "n" | "services" | "products" | "tasks_open" | "tasks_overdue" | "returns_due" | "commission_open") => rows.reduce((a, r) => a + r[k], 0);
  const seeMoney = can(ctx, "commissions.view_all"), goalsEdit = can(ctx, "team.goals");
  const month = todayYmd().slice(0, 7);
  const goals = await Promise.all(rows.map(async (r) => ({ r, list: await staffGoals(db, ctx, r.staff_id, month) })));
  return (
    <>
      <PageHead title="Painel da equipe" sub="Produção, ocupação e pendências de cada profissional." />
      <Flash ok={sp.ok} erro={sp.erro} />
      <PeriodBar base="/equipe" preset={preset} presets={PRESETS} p={p} keep={staff ? { s: staff } : {}} />
      <form className="filters" method="get"><input type="hidden" name="de" value={p.start} /><input type="hidden" name="ate" value={p.end} /><label>Funcionário<select name="s" defaultValue={staff ?? ""}><option value="">Toda a equipe</option>{all.map((r) => <option key={r.staff_id} value={r.staff_id}>{r.name}</option>)}</select></label><button className="btn ghost" type="submit">Filtrar</button></form>
      <div className="stats">
        <Stat label="Profissionais ativos" value={rows.length} tone="ol" />
        <Stat label="Atendimentos" value={sum("n")} />
        <Stat label="Serviços" value={money(sum("services"))} />
        <Stat label="Produtos" value={money(sum("products"))} />
        {seeMoney ? <Stat label="Comissões não repassadas" hint="Total em aberto, de qualquer data" value={money(sum("commission_open"))} tone="hi" /> : null}
        <Stat label="Tarefas abertas" value={sum("tasks_open")} hint={sum("tasks_overdue") ? <span className="late">{sum("tasks_overdue")} atrasada(s)</span> : undefined} />
        <Stat label="Retornos a convidar" value={sum("returns_due")} />
      </div>
      {rows.length === 0 ? <Empty title="Nenhum profissional ativo" /> : (
        <div className="tablewrap"><table className="rtable">
          <thead><tr><th>Profissional</th><th className="n">Atend.</th><th className="n">Serviços</th><th className="n">Ticket</th><th className="n">Produtos</th><th className="n">Ocupação</th><th className="n">Tarefas</th><th className="n">Retornos</th>{seeMoney ? <th className="n">Comissão</th> : null}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.staff_id}>
              <td className="full"><span className="pri" style={{ background: r.color, display: "inline-block", marginRight: 8 }} /><Link href={`/conquistas?s=${r.staff_id}`}>{r.name}</Link></td>
              <td className="n" data-l="Atend.">{r.n}</td><td className="n" data-l="Serviços">{money(r.services)}</td><td className="n" data-l="Ticket">{money(r.ticket)}</td><td className="n" data-l="Produtos">{money(r.products)}</td>
              <td className="n" data-l="Ocupação">{r.occupancy == null ? <small>sem escala</small> : fmtPct(r.occupancy, 0)}</td>
              <td className="n" data-l="Tarefas">{r.tasks_open}{r.tasks_overdue ? <span className="late"> ({r.tasks_overdue} atr.)</span> : null}</td><td className="n" data-l="Retornos">{r.returns_due}</td>
              {seeMoney ? <td className="n" data-l="Comissão">{money(r.commission_open)}</td> : null}
            </tr>))}</tbody>
        </table></div>
      )}
      <div className="grid cols-2">
        <section className="card stack"><h2>Produção por profissional</h2>{rows.some((r) => r.services + r.products > 0) ? <HBars rows={rows.map((r) => ({ label: r.name, value: r.services + r.products, text: fmtBRL(r.services + r.products) }))} /> : <Empty title="Sem produção no período" />}</section>
        <section className="card stack">
          <h2>Metas do mês</h2>
          <small>Metas são gerenciais. Não mudam percentuais de comissão.</small>
          {goals.map(({ r, list }) => list.map((g) => (
            <div key={g.id}><div className="sumrow"><span>{r.name} · {g.label}</span><span className="row"><span className="mono">{g.unit === "brl" ? fmtBRL(g.value) : g.value} de {g.unit === "brl" ? fmtBRL(g.target) : g.target}</span>{goalsEdit ? <form action={removeGoalAction}><input type="hidden" name="id" value={g.id} /><button className="btn small text" type="submit" aria-label={`Remover meta de ${r.name}`}>×</button></form> : null}</span></div><div className="track2"><span style={{ width: `${Math.min(100, g.pct)}%` }} /></div></div>)))}
          {goalsEdit && all.length ? (
            <form action={staffGoalAction} className="form">
              <div className="fields">
                <Field label="Profissional"><select name="staffId">{all.map((r) => <option key={r.staff_id} value={r.staff_id}>{r.name}</option>)}</select></Field>
                <Field label="Meta"><select name="metric">{Object.entries(GOAL_METRICS).map(([k, v]) => <option key={k} value={k}>{v[0]}{v[1] === "brl" ? " (R$)" : ""}</option>)}</select></Field>
                <Field label="Mês"><input type="month" name="month" defaultValue={month} required /></Field>
                <Field label="Alvo"><input name="target" required inputMode="decimal" /></Field>
              </div>
              <div><button className="btn" type="submit">Salvar meta</button></div>
            </form>
          ) : null}
        </section>
      </div>
    </>
  );
}
