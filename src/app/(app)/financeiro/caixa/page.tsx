import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { findOpenSession, listCashSessions, expectedByMethod } from "@/server/services/cash";
import { fmtDateTime } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { Badge, Empty, Field, Flash, PageHead, money, newKey } from "@/components/ui";
import { cashMovementAction, openCashAction } from "@/app/actions/finance";

export const metadata = { title: "Caixa" };

export default async function CashPage({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("cash.manage", "finance.view");
  const db = await getDb();
  const manage = can(ctx, "cash.manage");
  const open = await findOpenSession(db.query, ctx.unitId);
  const totals = open ? await expectedByMethod(db.query, open.id) : [];
  const history = await listCashSessions(db, ctx, 30);
  return (
    <>
      <PageHead title="Caixa" sub="Abertura, movimentações e fechamento com conferência por modalidade." />
      <Flash ok={sp.ok} erro={sp.erro} />
      {open ? (
        <section className="card stack">
          <div className="row"><h2>Caixa aberto</h2><Badge tone="ok">desde {fmtDateTime(open.opened_at)}</Badge><span className="grow" /><Link className="btn accent" href={`/financeiro/caixa/${open.id}`}>Ver detalhes / fechar</Link></div>
          <div className="tablewrap"><table>
            <thead><tr><th>Modalidade</th><th className="n">Esperado agora</th></tr></thead>
            <tbody>{totals.map((t) => <tr key={t.method_id}><td>{t.name}{t.kind === "dinheiro" ? <small> (inclui saldo inicial {fmtBRL(open.opening_declared_cents)})</small> : null}</td><td className="n">{money(t.expected_cents)}</td></tr>)}</tbody>
          </table></div>
          {manage ? (
            <div className="grid cols-2">
              {(["sangria", "suprimento"] as const).map((kind) => (
                <form key={kind} action={cashMovementAction} className="form card flat">
                  <h3>{kind === "sangria" ? "Sangria (retirada de dinheiro)" : "Suprimento (entrada de dinheiro)"}</h3>
                  <input type="hidden" name="kind" value={kind} /><input type="hidden" name="key" value={newKey()} />
                  <div className="fields"><Field label="Valor (R$)"><input name="amount" inputMode="decimal" required /></Field><Field label="Descrição"><input name="description" minLength={3} required /></Field></div>
                  <div><button className="btn ghost" type="submit">Registrar {kind}</button></div>
                </form>
              ))}
            </div>
          ) : null}
        </section>
      ) : manage ? (
        <section className="card stack">
          <h2>Abrir caixa</h2>
          <form action={openCashAction} className="form">
            <div className="fields"><Field label="Dinheiro contado no caixa agora (R$)"><input name="declared" inputMode="decimal" defaultValue="0,00" /></Field></div>
            <small>O valor declarado é comparado com o último fechamento; diferenças geram alerta.</small>
            <div><button className="btn accent" type="submit">Abrir caixa</button></div>
          </form>
        </section>
      ) : <Empty title="Caixa fechado" />}

      <section className="stack">
        <h2>Histórico</h2>
        {history.length === 0 ? <Empty title="Nenhuma sessão de caixa ainda" /> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Abertura</th><th>Fechamento</th><th>Responsável</th><th>Situação</th><th className="n">Diferença</th></tr></thead>
            <tbody>{history.map((s) => (
              <tr key={s.id}>
                <td className="nowrap"><Link href={`/financeiro/caixa/${s.id}`}>{fmtDateTime(s.opened_at)}</Link></td>
                <td className="nowrap">{s.closed_at ? fmtDateTime(s.closed_at) : "—"}</td>
                <td>{s.opened_by_name}{s.closed_by_name && s.closed_by_name !== s.opened_by_name ? ` → ${s.closed_by_name}` : ""}</td>
                <td>{s.status === "aberto" ? <Badge tone="ok">Aberto</Badge> : <Badge>Fechado</Badge>}</td>
                <td className="n">{s.difference_cents == null ? "—" : s.difference_cents === 0 ? "sem diferença" : <span style={{ color: "var(--bad)" }}>{fmtBRL(s.difference_cents)}</span>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
