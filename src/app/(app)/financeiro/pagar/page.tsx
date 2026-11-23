import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listPayables } from "@/server/services/finance";
import { listCatalog } from "@/server/services/catalog";
import { addDays, fmtYmd, todayYmd } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { Badge, Empty, Field, Flash, PageHead, Pager, Seg, money } from "@/components/ui";
import { createPayableAction } from "@/app/actions/finance";

export const metadata = { title: "Contas a pagar" };
const SIZE = 50;

export default async function PayablesPage({ searchParams }: { searchParams: Promise<{ f?: string; p?: string; ok?: string; erro?: string; nova?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("finance.view", "finance.payables_view");
  const db = await getDb();
  const filter = sp.f === "pagas" ? "pagas" : sp.f === "todas" ? "todas" : "abertas";
  const page = Math.max(1, Number(sp.p) || 1);
  const { rows, total } = await listPayables(db, ctx, { filter, limit: SIZE, offset: (page - 1) * SIZE });
  const cat = await listCatalog(db, ctx.unitId);
  const manage = can(ctx, "finance.manage");
  const today = todayYmd();
  const openSum = rows.filter((r) => r.pay_status === "pendente" || r.pay_status === "parcialmente_pago").reduce((a, r) => a + r.amount_cents - r.paid_cents, 0);
  return (
    <>
      <PageHead title="Contas a pagar" sub="Cadastro manual, parcelamento, recorrência e pagamentos parciais.">
        <Seg items={[{ href: "/financeiro/pagar?f=abertas", label: "Em aberto", active: filter === "abertas" }, { href: "/financeiro/pagar?f=pagas", label: "Pagas", active: filter === "pagas" }, { href: "/financeiro/pagar?f=todas", label: "Todas", active: filter === "todas" }]} />
        {manage ? <Link className="btn accent" href="/financeiro/pagar?nova=1&f=abertas#nova">+ Nova conta</Link> : null}
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      {filter === "abertas" && rows.length ? <p className="muted">Em aberto nesta página: <b>{fmtBRL(openSum)}</b></p> : null}

      {manage && sp.nova ? (
        <form id="nova" action={createPayableAction} className="card form">
          <h2>Nova conta a pagar</h2>
          <div className="fields">
            <Field label="Descrição"><input name="description" required minLength={3} /></Field>
            <Field label="Fornecedor (opcional)"><input name="supplier" /></Field>
            <Field label="Categoria">
              <select name="categoryId" required defaultValue="">
                <option value="" disabled>— escolher —</option>
                {cat.categories.filter((c) => c.is_active && c.kind !== "receita").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Valor total (R$)"><input name="amount" inputMode="decimal" required /></Field>
            <Field label="1º vencimento"><input type="date" name="dueDate" defaultValue={addDays(today, 7)} required /></Field>
            <Field label="Competência (opcional)"><input type="date" name="competenceDate" /></Field>
          </div>
          <div className="fields">
            <Field label="Parcelas (1 = à vista)"><input name="installments" type="number" min={1} max={60} defaultValue={1} /></Field>
            <Field label="Recorrência"><select name="recurrence" defaultValue=""><option value="">Não repete</option><option value="mensal">Mensal</option><option value="trimestral">Trimestral</option><option value="anual">Anual</option></select></Field>
          </div>
          <Field label="Observações"><textarea name="notes" /></Field>
          <small>Escolha parcelamento <i>ou</i> recorrência. Recorrentes geram as próximas ocorrências automaticamente; pró-labore e distribuição de lucros têm categorias próprias e não são tratados como despesa comum.</small>
          <div><button className="btn accent" type="submit">Salvar conta</button></div>
        </form>
      ) : null}

      {rows.length === 0 ? <Empty title={filter === "abertas" ? "Nenhuma conta em aberto" : "Nenhuma conta encontrada"}>{manage ? "Use “+ Nova conta” para cadastrar." : ""}</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th>Situação</th><th className="n">Valor</th><th className="n">Pago</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtYmd(r.due_date)}{r.overdue ? <> <Badge tone="bad">vencida</Badge></> : null}</td>
                  <td><Link href={`/financeiro/pagar/${r.id}`}>{r.description}</Link>{r.installment_total ? <small> · parcela {r.installment_no}/{r.installment_total}</small> : null}{r.recurrence || r.recurrence_parent_id ? <small> · recorrente</small> : null}</td>
                  <td>{r.category_name}</td>
                  <td><Badge tone={r.pay_status === "pago" ? "ok" : r.pay_status === "parcialmente_pago" ? "info" : r.pay_status === "cancelado" ? "" : "warn"}>{r.pay_status === "parcialmente_pago" ? "Parcial" : r.pay_status === "pago" ? "Paga" : r.pay_status === "cancelado" ? "Cancelada" : "Pendente"}</Badge></td>
                  <td className="n">{money(r.amount_cents)}</td><td className="n">{money(r.paid_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager base={`/financeiro/pagar?f=${filter}`} page={page} total={total} size={SIZE} />
    </>
  );
}
