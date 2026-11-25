import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listClosures, validateClosure } from "@/server/services/closure";
import { addMonths, fmtDateTime, fmtYmd, monthEnd, monthStart, todayYmd } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { Badge, ConfirmAction, Empty, Field, Flash, PageHead } from "@/components/ui";
import { closePeriodAction, reopenPeriodAction } from "@/app/actions/finance";

export const metadata = { title: "Fechamento mensal" };

export default async function ClosurePage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("finance.view");
  const db = await getDb();
  const today = todayYmd();
  const prevMonth = addMonths(today, -1);
  const p = /^\d{4}-\d{2}-\d{2}$/.test(sp.de ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(sp.ate ?? "") ? { start: sp.de!, end: sp.ate! } : { start: monthStart(prevMonth), end: monthEnd(prevMonth) };
  const v = await validateClosure(db, ctx, p);
  const closures = await listClosures(db, ctx);
  const can_ = can(ctx, "finance.close_period");
  return (
    <>
      <PageHead title="Fechamento mensal" sub="Valide os lançamentos, revise a DRE e feche o período. Períodos fechados não aceitam novos lançamentos." />
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="filters" method="get">
        <label>De<input type="date" name="de" defaultValue={p.start} /></label><label>Até<input type="date" name="ate" defaultValue={p.end} /></label>
        <button className="btn ghost" type="submit">Validar período</button>
      </form>
      <section className="card stack">
        <div className="row"><h2>Verificações · {fmtYmd(p.start)} a {fmtYmd(p.end)}</h2>{v.ready ? <Badge tone="ok">Pronto para fechar</Badge> : <Badge tone="bad">Bloqueado</Badge>}</div>
        <div className="tablewrap"><table>
          <thead><tr><th>Verificação</th><th>Resultado</th><th>Tipo</th></tr></thead>
          <tbody>{v.checks.map((c) => (
            <tr key={c.key}><td>{c.label}</td><td>{c.passed ? <Badge tone="ok">OK</Badge> : <><Badge tone={c.blocking ? "bad" : "warn"}>{c.blocking ? "Pendente" : "Atenção"}</Badge> <small>{c.detail}</small></>}</td><td>{c.blocking ? "Bloqueia" : "Aviso"}</td></tr>))}</tbody>
        </table></div>
        <div className="grid cols-3">
          <div className="card flat"><small>Receita líquida</small><div className="mono" style={{ fontFamily: "var(--serif)", fontSize: "1.3rem" }}>{fmtBRL(v.dre.netRevenue)}</div></div>
          <div className="card flat"><small>Resultado operacional</small><div className="mono" style={{ fontFamily: "var(--serif)", fontSize: "1.3rem" }}>{fmtBRL(v.dre.operatingResult)}</div></div>
          <div className="card flat"><small>Resultado líquido</small><div className="mono" style={{ fontFamily: "var(--serif)", fontSize: "1.3rem" }}>{fmtBRL(v.dre.netResult)}</div></div>
        </div>
        {v.dre.warnings.map((w) => <div className="alert warn" key={w}>{w}</div>)}
        {can_ ? (
          <ConfirmAction label="Fechar este período" tone="neutral" action={closePeriodAction} submit="Fechar período" warn="O resultado fica guardado em uma versão imutável. Para alterar depois, é preciso reabrir o período (fica no histórico).">
            <input type="hidden" name="start" value={p.start} /><input type="hidden" name="end" value={p.end} />
            <small style={{ padding: "0 10px" }}>{v.ready ? "Todas as verificações bloqueantes foram atendidas." : "Há pendências bloqueantes: o fechamento será recusado."}</small>
          </ConfirmAction>
        ) : <small>Apenas o administrador fecha períodos.</small>}
      </section>
      <section className="stack">
        <h2>Fechamentos anteriores</h2>
        {closures.length === 0 ? <Empty title="Nenhum período fechado ainda" /> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Período</th><th>Versão</th><th>Situação</th><th>Fechado por</th><th className="n">Receita líquida</th><th className="n">Resultado líquido</th><th /></tr></thead>
            <tbody>{closures.map((c) => (
              <tr key={c.id}><td>{fmtYmd(c.period_start)} a {fmtYmd(c.period_end)}</td><td>v{c.version}</td><td>{c.status === "fechado" ? <Badge tone="ok">Fechado</Badge> : <Badge tone="warn">Reaberto</Badge>}</td>
                <td>{c.closed_by_name}<br /><small>{fmtDateTime(c.closed_at)}</small></td><td className="n">{fmtBRL(c.snapshot.dre.netRevenue)}</td><td className="n">{fmtBRL(c.snapshot.dre.netResult)}</td>
                <td>{c.status === "fechado" && can_ ? (
                  <ConfirmAction label="Reabrir" action={reopenPeriodAction} submit="Reabrir período" warn="Permite novos lançamentos no período. O fechamento anterior permanece no histórico.">
                    <input type="hidden" name="id" value={c.id} /><Field label="Motivo"><input name="reason" minLength={5} required /></Field>
                  </ConfirmAction>) : null}</td></tr>))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
