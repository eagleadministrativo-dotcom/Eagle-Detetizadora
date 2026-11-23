import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listReceivables } from "@/server/services/payments";
import { listCustomers } from "@/server/services/customers";
import { addDays, fmtDate, fmtYmd, todayYmd } from "@/lib/dates";
import { ConcBadge, Empty, Field, Flash, PageHead, PayBadge, Pager, Seg, money } from "@/components/ui";
import { manualReceivableAction } from "@/app/actions/finance";

export const metadata = { title: "Contas a receber" };
const SIZE = 50;

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string; p?: string; nova?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("finance.view", "finance.receivables_view");
  const db = await getDb();
  const filter = sp.f === "todos" ? "todos" : sp.f === "nao_conciliados" ? "nao_conciliados" : "abertos";
  const page = Math.max(1, Number(sp.p) || 1);
  const { rows, total } = await listReceivables(db, ctx, { filter, search: sp.q, limit: SIZE, offset: (page - 1) * SIZE });
  const manage = can(ctx, "finance.manage");
  const customers = manage && sp.nova ? (await listCustomers(db, ctx, { limit: 300 })).rows : [];
  const open = rows.filter((r) => r.pay_status === "pendente" || r.pay_status === "parcialmente_recebido").reduce((a, r) => a + r.amount_due_cents - r.registered_cents, 0);
  return (
    <>
      <PageHead title="Contas a receber" sub="Cobranças geradas pelos atendimentos e cobranças avulsas.">
        <Seg items={[{ href: "/financeiro/receber?f=abertos", label: "Em aberto", active: filter === "abertos" }, { href: "/financeiro/receber?f=nao_conciliados", label: "Não conciliados", active: filter === "nao_conciliados" }, { href: "/financeiro/receber?f=todos", label: "Todas", active: filter === "todos" }]} />
        {manage ? <Link className="btn ghost" href="/financeiro/receber?nova=1#nova">+ Cobrança avulsa</Link> : null}
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      {manage && sp.nova ? (
        <form id="nova" action={manualReceivableAction} className="card form">
          <h2>Cobrança avulsa</h2>
          <div className="fields">
            <Field label="Cliente (opcional)"><select name="customerId" defaultValue=""><option value="">—</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Descrição"><input name="description" required minLength={3} /></Field>
            <Field label="Valor (R$)"><input name="amount" inputMode="decimal" required /></Field>
            <Field label="Vencimento"><input type="date" name="dueDate" defaultValue={addDays(todayYmd(), 7)} required /></Field>
          </div>
          <div><button className="btn accent" type="submit">Criar cobrança</button></div>
        </form>
      ) : null}
      <form className="filters" method="get">
        <input type="hidden" name="f" value={filter} />
        <label>Buscar cliente ou descrição<input name="q" defaultValue={sp.q ?? ""} /></label>
        <button className="btn ghost" type="submit">Buscar</button>
        {filter === "abertos" && rows.length ? <span className="muted">Saldo em aberto nesta página: <b className="mono">{money(open)}</b></span> : null}
      </form>
      {rows.length === 0 ? <Empty title="Nada por aqui">Nenhuma cobrança neste filtro.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Data</th><th>Cliente</th><th>Descrição</th><th>Situação</th><th>Conciliação</th><th className="n">Devido</th><th className="n">Registrado</th><th className="n">Conferido</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td className="nowrap"><Link href={`/financeiro/receber/${r.id}`}>{fmtDate(r.created_at)}</Link></td><td>{r.customer_name ?? "—"}</td><td>{r.description}{r.staff_name ? <small> · {r.staff_name}</small> : null}</td>
                <td><PayBadge s={r.pay_status} /></td><td>{r.registered_cents > 0 ? <ConcBadge s={r.conc_status} /> : <small>—</small>}</td>
                <td className="n">{money(r.amount_due_cents)}</td><td className="n">{money(r.registered_cents)}</td><td className="n">{money(r.confirmed_cents)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      <Pager base={`/financeiro/receber?f=${filter}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`} page={page} total={total} size={SIZE} />
      <small>Vencimento padrão das cobranças de atendimento: a própria data. {fmtYmd(todayYmd())}</small>
    </>
  );
}
