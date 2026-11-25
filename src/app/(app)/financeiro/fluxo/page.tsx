import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { getCashFlow, accountBalances } from "@/server/services/reports";
import { listCapitalEntries } from "@/server/services/finance";
import { listCatalog } from "@/server/services/catalog";
import { addDays, fmtYmd, todayYmd } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { Badge, Empty, Field, Flash, PageHead, money, newKey } from "@/components/ui";
import { LineChart } from "@/components/charts";
import { capitalAction } from "@/app/actions/finance";

export const metadata = { title: "Fluxo de caixa" };

export default async function FlowPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("finance.view");
  const db = await getDb();
  const today = todayYmd();
  const de = /^\d{4}-\d{2}-\d{2}$/.test(sp.de ?? "") ? sp.de! : addDays(today, -14);
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(sp.ate ?? "") ? sp.ate! : today;
  const flow = await getCashFlow(db, ctx, { start: de, end: ate }, 30);
  const accounts = await accountBalances(db.query, ctx.unitId);
  const capital = await listCapitalEntries(db, ctx);
  const cat = await listCatalog(db, ctx.unitId);
  const firstEst = flow.rows.find((r) => r.estimate)?.date;
  const real = flow.rows.filter((r) => !r.estimate);
  return (
    <>
      <PageHead title="Fluxo de caixa" sub="Regime de caixa: o que efetivamente entrou e saiu das contas. A parte tracejada é estimativa." />
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="filters" method="get">
        <label>De<input type="date" name="de" defaultValue={de} /></label><label>Até<input type="date" name="ate" defaultValue={ate} /></label>
        <button className="btn ghost" type="submit">Aplicar</button>
      </form>
      {flow.firstNegative ? <div className="alert critico"><b>Risco de caixa negativo</b> previsto para {fmtYmd(flow.firstNegative)} <Badge tone="warn">estimativa</Badge> — baseado nas contas a pagar e cobranças em aberto.</div> : null}
      {flow.pendingConfirmation !== 0 ? <div className="alert">Há <b>{fmtBRL(flow.pendingConfirmation)}</b> registrados e ainda não conferidos; só entram no fluxo depois da conferência.</div> : null}
      <div className="grid cols-3">
        <div className="card"><small>Saldo inicial do período</small><div className="mono" style={{ fontFamily: "var(--serif)", fontSize: "1.4rem" }}>{fmtBRL(flow.openingBalance)}</div></div>
        <div className="card"><small>Saldo hoje</small><div className="mono" style={{ fontFamily: "var(--serif)", fontSize: "1.4rem" }}>{fmtBRL(flow.todayBalance)}</div></div>
        <div className="card"><small>Entradas − saídas (realizado)</small><div className="mono" style={{ fontFamily: "var(--serif)", fontSize: "1.4rem" }}>{fmtBRL(real.reduce((a, r) => a + r.inflow - r.outflow, 0))}</div></div>
      </div>
      <section className="card">
        <h2>Saldo projetado</h2>
        <LineChart data={flow.rows.map((r) => ({ date: r.date, v: r.balance }))} estimateFrom={firstEst} />
        <div className="legend"><span><i style={{ background: "var(--accent)" }} />Realizado</span><span><i style={{ background: "var(--info)" }} />Estimativa</span></div>
        {flow.note.map((n) => <small key={n} style={{ display: "block" }}>{n}</small>)}
      </section>
      <section className="stack">
        <h2>Dia a dia</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Data</th><th>Tipo</th><th className="n">Entradas</th><th className="n">Saídas</th><th className="n">Saldo</th></tr></thead>
          <tbody>{flow.rows.map((r) => (
            <tr key={r.date} className={r.estimate ? "dim" : ""}><td>{fmtYmd(r.date)}</td><td>{r.estimate ? <Badge tone="info">estimativa</Badge> : "realizado"}</td>
              <td className="n">{money(r.inflow)}</td><td className="n">{money(r.outflow)}</td><td className="n" style={r.balance < 0 ? { color: "var(--bad)" } : undefined}>{fmtBRL(r.balance)}</td></tr>))}</tbody>
        </table></div>
      </section>
      <div className="grid cols-2">
        <section className="card stack">
          <h2>Saldo por conta</h2>
          {accounts.length === 0 ? <Empty title="Sem contas" /> : accounts.map((a) => <div className="row" key={a.id}><span className="grow">{a.name}</span><b className="mono">{fmtBRL(a.balance_cents)}</b></div>)}
        </section>
        {can(ctx, "finance.manage") ? (
          <section className="card stack">
            <h2>Aporte ou empréstimo</h2>
            <p className="muted">Entram no caixa, mas <b>não são receita</b> nem aparecem na DRE.</p>
            <form action={capitalAction} className="form">
              <input type="hidden" name="key" value={newKey()} />
              <div className="fields">
                <Field label="Tipo"><select name="kind"><option value="aporte">Aporte do sócio</option><option value="emprestimo">Empréstimo</option></select></Field>
                <Field label="Valor (R$)"><input name="amount" inputMode="decimal" required /></Field>
                <Field label="Data"><input type="date" name="entryDate" defaultValue={today} required /></Field>
                <Field label="Conta"><select name="accountId" required>{cat.accounts.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
              </div>
              <Field label="Descrição"><input name="description" minLength={3} required /></Field>
              <div><button className="btn ghost" type="submit">Registrar</button></div>
            </form>
            {capital.length ? <small>Últimos: {capital.slice(0, 3).map((c) => `${fmtYmd(c.entry_date)} ${c.kind} ${fmtBRL(c.amount_cents)}`).join(" · ")}</small> : null}
          </section>
        ) : null}
      </div>
    </>
  );
}
