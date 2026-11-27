import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { listCatalog, listServices } from "@/server/services/catalog";
import { fmtBRL } from "@/lib/money";
import { Badge, Empty, Flash, PageHead } from "@/components/ui";
import { saveServiceCategoryAction } from "@/app/actions/admin";

export const metadata = { title: "Serviços e preços" };

export default async function ServicesAdmin({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("admin.catalog");
  const db = await getDb();
  const services = await listServices(db, ctx.unitId, true);
  const cat = await listCatalog(db, ctx.unitId);
  return (
    <>
      <PageHead title="Serviços e preços" sub="Cadastre e personalize cada serviço: duração, intervalo, preço com vigência, quem executa e campos livres.">
        <Link className="btn accent" href="/admin/servicos/novo">+ Novo serviço</Link>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      {services.length === 0 ? <Empty title="Nenhum serviço cadastrado">Comece cadastrando o primeiro serviço (ex.: Dedetização residencial) com duração e preço.</Empty> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Serviço</th><th>Categoria</th><th className="n">Duração</th><th className="n">Preço atual</th><th>Situação</th></tr></thead>
          <tbody>{services.map((s) => (
            <tr key={s.id}><td><Link href={`/admin/servicos/${s.id}`}>{s.name}</Link>{s.color ? <i style={{ display: "inline-block", width: 10, height: 10, background: s.color, borderRadius: 2, marginLeft: 6 }} /> : null}</td>
              <td>{s.category_name ?? "—"}</td><td className="n">{s.duration_minutes} min{s.buffer_minutes ? ` + ${s.buffer_minutes}` : ""}</td>
              <td className="n">{s.price_cents == null ? <Badge tone="warn">sem preço</Badge> : fmtBRL(s.price_cents)}</td><td>{s.is_active ? <Badge tone="ok">Ativo</Badge> : <Badge>Inativo</Badge>}</td></tr>))}</tbody>
        </table></div>
      )}
      <section className="card stack">
        <h2>Categorias de serviço</h2>
        <div className="stack">
          {cat.svcCats.map((c) => (
            <form key={c.id} action={saveServiceCategoryAction} className="editrow">
              <input type="hidden" name="id" value={c.id} />
              <input name="name" defaultValue={c.name} aria-label="Nome da categoria" />
              <input name="sort" type="number" defaultValue={c.sort_order} className="sm" aria-label="Ordem" />
              <label className="check"><input type="checkbox" name="isActive" defaultChecked={c.is_active} />ativa</label>
              <button className="btn small ghost" type="submit">Salvar</button>
            </form>
          ))}
        </div>
        <form action={saveServiceCategoryAction} className="editrow">
          <input name="name" placeholder="Nova categoria" required /><button className="btn small" type="submit">Adicionar</button>
        </form>
      </section>
    </>
  );
}
