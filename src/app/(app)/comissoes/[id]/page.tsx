import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listEntries, listSettlements } from "@/server/services/commissions";
import { listCatalog } from "@/server/services/catalog";
import { fmtDateTime, fmtYmd } from "@/lib/dates";
import { ConfirmAction, Field, Flash, PageHead, Stat, money, newKey } from "@/components/ui";
import { Entries, StateBadge } from "@/components/commission-ui";
import { cancelSettlementAction, paySettlementAction } from "@/app/actions/commissions";

export const metadata = { title: "Repasse" };

export default async function Settlement({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("commissions.view_all", "finance.own");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await getDb();
  const [s] = await listSettlements(db, ctx, { id });
  if (!s) notFound();
  const { rows } = await listEntries(db, ctx, { period: { start: s.period_start, end: s.period_end }, staffId: s.staff_id, settlementId: id, limit: 500 });
  const left = s.total_cents - s.paid_cents;
  const accounts = can(ctx, "commissions.pay") ? (await listCatalog(db, ctx.unitId)).accounts.filter((a) => a.is_active) : [];
  return (
    <>
      <PageHead title={`Repasse de ${s.staff_name}`} sub={<>{fmtYmd(s.period_start)} a {fmtYmd(s.period_end)} · aprovado em {fmtDateTime(s.approved_at)}{s.note ? ` · ${s.note}` : ""}</>}>
        <StateBadge s={s.state} />
        <a className="btn ghost" href={`/api/export/repasse?id=${s.id}`}>Demonstrativo</a>
        <Link className="btn ghost" href={can(ctx, "commissions.view_all") ? "/comissoes" : "/meu-financeiro"}>Voltar</Link>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="stats"><Stat label="Comissões" value={money(s.entries_cents)} /><Stat label="Ajustes" value={money(s.adjustments_cents)} /><Stat label="Total" value={money(s.total_cents)} tone="ol" /><Stat label="Pago" value={money(s.paid_cents)} tone="hi" /><Stat label="Falta pagar" value={money(s.state === "cancelado" ? 0 : left)} /></div>
      {s.evidence_name ? <p><a href={`/api/arquivo/comprovante/${s.id}`} download>Comprovante: {s.evidence_name}</a></p> : null}
      <Entries rows={rows} />
      {left > 0 && s.state !== "cancelado" && can(ctx, "commissions.pay") ? (
        <form action={paySettlementAction} className="card form">
          <h2>Registrar pagamento</h2>
          <input type="hidden" name="id" value={s.id} /><input type="hidden" name="key" value={newKey()} />
          <div className="fields">
            <Field label="Valor (R$)"><input name="amount" defaultValue={(left / 100).toFixed(2).replace(".", ",")} required /></Field>
            <Field label="Pago com"><select name="accountId">{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label="Referência (opcional)"><input name="evidence" placeholder="Ex.: ID do Pix" /></Field>
            <Field label="Comprovante (imagem ou PDF, até 2 MB)"><input type="file" name="file" accept="image/png,image/jpeg,image/webp,application/pdf" /></Field>
          </div>
          <small>Este registro não transfere dinheiro. Faça o pagamento no banco e registre aqui. Aceita pagamento em partes.</small>
          <div><button className="btn accent" type="submit">Registrar pagamento</button></div>
        </form>
      ) : null}
      {s.paid_cents === 0 && s.state !== "cancelado" && can(ctx, "commissions.approve") ? <ConfirmAction label="Cancelar repasse" action={cancelSettlementAction} submit="Cancelar repasse" warn="As comissões voltam a ficar prontas para aprovar e a conta a pagar é cancelada."><input type="hidden" name="id" value={s.id} /><Field label="Motivo"><input name="reason" minLength={3} required /></Field></ConfirmAction> : null}
    </>
  );
}
