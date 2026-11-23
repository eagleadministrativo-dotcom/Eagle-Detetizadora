import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { byStaff, divergences, listEntries, listSettlements, totals, withoutRule } from "@/server/services/commissions";
import { PRESETS, resolvePeriod } from "@/lib/period";
import { fmtDateTime, fmtYmd } from "@/lib/dates";
import { ConfirmAction, Empty, Field, Flash, PageHead, Pager, PeriodBar, Stat, money } from "@/components/ui";
import { Entries, StateBadge } from "@/components/commission-ui";
import { adjustAction, approveAction } from "@/app/actions/commissions";

export const metadata = { title: "Comissões" };
type SP = { r?: string; de?: string; ate?: string; s?: string; k?: string; e?: string; p?: string; ok?: string; erro?: string };

export default async function Commissions({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("commissions.view_all");
  const db = await getDb();
  const { preset, p } = resolvePeriod(sp);
  const staff = /^[0-9a-f-]{36}$/.test(sp.s ?? "") ? sp.s! : null;
  const page = Math.max(1, Number(sp.p) || 1);
  const [t, rows, sets, div, noRule, ent] = await Promise.all([totals(db, ctx, p, staff), byStaff(db, ctx, p), listSettlements(db, ctx, { limit: 12 }), divergences(db, ctx), withoutRule(db, ctx, p), listEntries(db, ctx, { period: p, staffId: staff, kind: sp.k, state: sp.e, limit: 25, offset: (page - 1) * 25 })]);
  const approve = can(ctx, "commissions.approve");
  const qs = new URLSearchParams({ de: p.start, ate: p.end, ...(staff ? { s: staff } : {}), ...(sp.k ? { k: sp.k } : {}), ...(sp.e ? { e: sp.e } : {}) }).toString();
  return (
    <>
      <PageHead title="Comissões" sub="O que a equipe gerou, o que já pode ser pago e o que foi repassado. Comissão é custo: não entra como receita.">
        <Link className="btn" href="/comissoes/regras">Regras e percentuais</Link>
        <a className="btn ghost" href={`/api/export/comissoes?de=${p.start}&ate=${p.end}`}>Exportar</a>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <PeriodBar base="/comissoes" preset={preset} presets={PRESETS} p={p} />
      <div className="stats">
        <Stat label="Geradas no período" value={money(t.generated)} tone="ol" />
        <Stat label="Pendentes" value={money(t.pending)} hint="Aguardam recebimento conferido" />
        <Stat label="Prontas para aprovar" value={money(t.due)} hint={t.adjustments ? <>Ajustes a aplicar: {money(t.adjustments)}</> : undefined} />
        <Stat label="Aprovadas a pagar" value={money(t.approvedOpen)} />
        <Stat label="Pagas" value={money(t.paid)} tone="hi" />
      </div>
      {noRule ? <div className="alert warn">{noRule} item(ns) concluído(s) no período não geraram comissão porque não havia regra. <Link href="/comissoes/regras">Definir regras</Link>.</div> : null}
      {div.length ? <div className="alert bad"><b>{div.length} divergência(s):</b> comissão já aprovada cuja cobrança deixou de estar quitada.{div.slice(0, 5).map((d) => <div key={d.id}>{d.attendance_id ? <Link href={`/atendimentos/${d.attendance_id}`}>{d.description}</Link> : d.description} · {d.staff_name} · {money(d.amount_cents)} · {fmtDateTime(d.reference_at)}</div>)}</div> : null}
      <section className="card stack">
        <h2>Por profissional</h2>
        <div className="tablewrap"><table className="rtable">
          <thead><tr><th>Profissional</th><th className="n">Geradas</th><th className="n">Pendentes</th><th className="n">Prontas</th><th className="n">A pagar</th><th className="n">Pagas</th>{approve ? <th /> : null}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.staff_id}>
              <td className="full"><Link href={`/comissoes?${new URLSearchParams({ de: p.start, ate: p.end, s: r.staff_id }).toString()}#lancamentos`}>{r.name}</Link></td>
              <td className="n" data-l="Geradas">{money(r.generated)}</td><td className="n" data-l="Pendentes">{money(r.pending)}</td>
              <td className="n" data-l="Prontas">{money(r.due)}{r.adjustments ? <><br /><small>ajuste {money(r.adjustments)}</small></> : null}</td>
              <td className="n" data-l="A pagar">{money(r.approved_open)}</td><td className="n" data-l="Pagas">{money(r.paid)}</td>
              {approve ? <td className="full">{r.due > 0 || r.adjustments !== 0 ? (
                <ConfirmAction label="Fechar período" tone="neutral" action={approveAction} submit="Aprovar repasse">
                  <input type="hidden" name="staffId" value={r.staff_id} /><input type="hidden" name="de" value={p.start} /><input type="hidden" name="ate" value={p.end} />
                  <p>Aprovar {money(r.due + r.adjustments)} de {fmtYmd(p.start)} a {fmtYmd(p.end)}. O valor vira uma conta a pagar.</p>
                  <Field label="Observação (opcional)"><input name="note" /></Field>
                </ConfirmAction>) : null}</td> : null}
            </tr>))}</tbody>
        </table></div>
        {approve && rows.length ? (
          <ConfirmAction label="Registrar ajuste" tone="neutral" action={adjustAction} submit="Registrar ajuste" warn="O ajuste entra no próximo repasse e fica na auditoria.">
            <input type="hidden" name="de" value={p.start} /><input type="hidden" name="ate" value={p.end} />
            <div className="fields"><Field label="Profissional"><select name="staffId">{rows.map((r) => <option key={r.staff_id} value={r.staff_id}>{r.name}</option>)}</select></Field><Field label="Valor (negativo desconta)"><input name="amount" placeholder="-10,00" required /></Field><Field label="Motivo"><input name="reason" minLength={3} required /></Field></div>
          </ConfirmAction>
        ) : null}
      </section>
      <section className="card stack">
        <h2>Repasses</h2>
        {sets.length === 0 ? <Empty title="Nenhum repasse ainda" /> : sets.map((s) => <Link className="row" key={s.id} href={`/comissoes/${s.id}`}><span className="grow"><b>{s.staff_name}</b> <small>· {fmtYmd(s.period_start)} a {fmtYmd(s.period_end)}</small></span><StateBadge s={s.state} /><span className="mono">{money(s.total_cents)}</span></Link>)}
      </section>
      <section className="stack" id="lancamentos">
        <h2>Lançamentos{staff ? ` de ${rows.find((r) => r.staff_id === staff)?.name ?? ""}` : ""}</h2>
        <form className="filters" method="get"><input type="hidden" name="de" value={p.start} /><input type="hidden" name="ate" value={p.end} />
          <label>Profissional<select name="s" defaultValue={staff ?? ""}><option value="">Todos</option>{rows.map((r) => <option key={r.staff_id} value={r.staff_id}>{r.name}</option>)}</select></label>
          <label>Tipo<select name="k" defaultValue={sp.k ?? ""}><option value="">Todos</option><option value="servico">Serviço</option><option value="produto">Produto</option></select></label>
          <label>Situação<select name="e" defaultValue={sp.e ?? ""}><option value="">Todas</option><option value="pendente">Pendente</option><option value="exigivel">Pronta</option><option value="aprovada">Aprovada</option><option value="paga">Paga</option><option value="cancelada">Cancelada</option></select></label>
          <button className="btn ghost" type="submit">Filtrar</button></form>
        <Entries rows={ent.rows} staff />
        {ent.total > 25 ? <Pager base={`/comissoes?${qs}`} page={page} total={ent.total} size={25} /> : null}
      </section>
    </>
  );
}
