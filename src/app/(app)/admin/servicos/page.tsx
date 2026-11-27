import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { listCatalog, listServices } from "@/server/services/catalog";
import { fmtBRL } from "@/lib/money";
import { Badge, Empty, Flash, PageHead } from "@/components/ui";
import { saveServiceCategoryAction } from "@/app/actions/admin";
import { deleteDocOptionAction, saveDocOptionAction } from "@/app/actions/eagle";
import { listDocOptions } from "@/server/services/doc-options";
import { DOC_OPTION_KINDS, DOC_OPTION_LABEL, MULTI_KINDS } from "@/lib/doc-options";

export const metadata = { title: "Serviços e preços" };

export default async function ServicesAdmin({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string; aberto?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("admin.catalog");
  const db = await getDb();
  const services = await listServices(db, ctx.unitId, true);
  const cat = await listCatalog(db, ctx.unitId);
  const options = await listDocOptions(db, ctx.unitId, { all: true });
  return (
    <>
      <PageHead title="Serviços e preços" sub="Cadastre cada serviço (duração, preço, texto no orçamento) e as opções que montam o orçamento e a OS.">
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
      <section className="card stack" id="opcoes">
        <h2>Opções do orçamento e da OS</h2>
        <p className="muted">Essas opções aparecem para marcar ao montar o orçamento. As marcadas como <b>padrão</b> já vêm marcadas em todo orçamento novo.
          O texto de cada serviço no orçamento é a <b>Descrição</b> do serviço (sem descrição, vai o nome).</p>
        {DOC_OPTION_KINDS.map((kind) => {
          const list = options.filter((o) => o.kind === kind);
          return (
            <details key={kind} id={`op-${kind}`} className="confirm neutral" open={list.length === 0 || sp.aberto === kind}>
              <summary>{DOC_OPTION_LABEL[kind]} <small className="muted">· {list.filter((o) => o.is_active).length} ativa(s){MULTI_KINDS.includes(kind) ? " · marca várias" : " · escolhe uma"}</small></summary>
              <div className="stack" style={{ marginTop: 10 }}>
                {list.map((o) => (
                  <div key={o.id} className="editrow optrow">
                    <form action={saveDocOptionAction} className="editrow" style={{ flex: "1 1 100%" }}>
                      <input type="hidden" name="id" value={o.id} />
                      <input type="hidden" name="kind" value={kind} />
                      {kind === "produto" ? <input name="group" defaultValue={o.group_label ?? ""} placeholder="Grupo (ex.: Controle de roedores)" aria-label="Grupo" style={{ flex: "0 1 200px" }} /> : null}
                      <input name="text" defaultValue={o.text} required aria-label="Texto da opção" style={{ flex: "3 1 260px" }} />
                      <input name="sort" type="number" defaultValue={o.sort_order} className="sm" aria-label="Ordem" />
                      <label className="check"><input type="checkbox" name="isDefault" defaultChecked={o.is_default} />padrão</label>
                      <label className="check"><input type="checkbox" name="isActive" defaultChecked={o.is_active} />ativa</label>
                      <button className="btn small ghost" type="submit">Salvar</button>
                    </form>
                    <form action={deleteDocOptionAction}>
                      <input type="hidden" name="id" value={o.id} />
                      <input type="hidden" name="kind" value={kind} />
                      <button className="btn small ghost" type="submit" aria-label={`Excluir opção ${o.text}`}>Excluir</button>
                    </form>
                  </div>
                ))}
                <form action={saveDocOptionAction} className="editrow">
                  <input type="hidden" name="kind" value={kind} />
                  {kind === "produto" ? <input name="group" placeholder="Grupo (ex.: Controle de roedores)" aria-label="Grupo" style={{ flex: "0 1 200px" }} /> : null}
                  <input name="text" placeholder={`Nova opção de ${DOC_OPTION_LABEL[kind].toLowerCase()}`} required aria-label="Texto da nova opção" style={{ flex: "3 1 260px" }} />
                  <label className="check"><input type="checkbox" name="isDefault" />padrão</label>
                  <button className="btn small" type="submit">Adicionar</button>
                </form>
              </div>
            </details>
          );
        })}
      </section>
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
