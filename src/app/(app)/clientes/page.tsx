import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listCustomers } from "@/server/services/customers";
import { fmtDate } from "@/lib/dates";
import { Badge, Empty, Flash, PageHead, Pager, money } from "@/components/ui";

export const metadata = { title: "Clientes" };
const SIZE = 40;

export default async function Customers({ searchParams }: { searchParams: Promise<{ q?: string; p?: string; inativos?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("customers.view");
  const page = Math.max(1, Number(sp.p) || 1);
  const { rows, total } = await listCustomers(await getDb(), ctx, { search: sp.q, limit: SIZE, offset: (page - 1) * SIZE, includeInactive: sp.inativos === "1" });
  const base = `/clientes?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.inativos ? { inativos: "1" } : {}) }).toString()}`;
  return (
    <>
      <PageHead title="Clientes" sub="Cadastro interno. Clientes não recebem acesso ao sistema.">
        {can(ctx, "customers.manage") ? <Link className="btn accent" href="/clientes/novo">+ Novo cliente</Link> : null}
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="filters" method="get">
        <label>Buscar por nome ou telefone<input name="q" defaultValue={sp.q ?? ""} /></label>
        <label className="check" style={{ minWidth: 0 }}><input type="checkbox" name="inativos" value="1" defaultChecked={sp.inativos === "1"} />Incluir inativos</label>
        <button className="btn ghost" type="submit">Buscar</button>
      </form>
      {rows.length === 0 ? <Empty title={sp.q ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}>{sp.q ? "Tente outro nome ou telefone." : "Cadastre o primeiro cliente ou crie-o direto ao agendar."}</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Nome</th><th>Telefone</th><th className="n">Visitas</th><th>Última visita</th><th className="n">Total gasto</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/clientes/${c.id}`}>{c.name}</Link> {!c.is_active ? <Badge>inativo</Badge> : null}</td>
                  <td>{c.phone ?? "—"}</td><td className="n">{c.visits}</td><td>{c.last_visit ? fmtDate(c.last_visit) : "—"}</td><td className="n">{money(c.total_spent_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager base={base} page={page} total={total} size={SIZE} />
    </>
  );
}
