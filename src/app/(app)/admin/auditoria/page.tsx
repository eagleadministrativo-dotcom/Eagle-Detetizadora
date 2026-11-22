import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { listAudit } from "@/server/services/ops";
import { fmtDateTime } from "@/lib/dates";
import { Empty, PageHead, Pager } from "@/components/ui";

export const metadata = { title: "Auditoria" };
const SIZE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ a?: string; e?: string; p?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("audit.view");
  const page = Math.max(1, Number(sp.p) || 1);
  const { rows, total } = await listAudit(await getDb(), ctx, { action: sp.a, entity: sp.e, limit: SIZE, offset: (page - 1) * SIZE });
  return (
    <>
      <PageHead title="Auditoria" sub="Registro imutável de quem fez o quê e quando. Correções financeiras aparecem como estornos e ajustes, nunca como exclusões." />
      <form className="filters" method="get">
        <label>Ação contém<input name="a" defaultValue={sp.a ?? ""} placeholder="Ex.: PAGAMENTO" /></label>
        <label>Entidade<input name="e" defaultValue={sp.e ?? ""} placeholder="Ex.: payment" /></label>
        <button className="btn ghost" type="submit">Filtrar</button>
      </form>
      {rows.length === 0 ? <Empty title="Nenhum registro" /> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Entidade</th><th>Detalhes</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td className="nowrap">{fmtDateTime(r.created_at)}</td><td>{r.user_name ?? "sistema"}</td><td>{r.action}</td><td>{r.entity}<br /><small>{r.entity_id?.slice(0, 8)}</small></td>
              <td>{r.note ? <div>{r.note}</div> : null}{r.before || r.after ? <details><summary><small>antes / depois</small></summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: 0 }}>{JSON.stringify({ antes: r.before, depois: r.after }, null, 1)}</pre></details> : null}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      <Pager base={`/admin/auditoria?${new URLSearchParams({ ...(sp.a ? { a: sp.a } : {}), ...(sp.e ? { e: sp.e } : {}) }).toString()}`} page={page} total={total} size={SIZE} />
    </>
  );
}
