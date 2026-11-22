import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { listCatalog, listServices, priceHistory } from "@/server/services/catalog";
import { fmtBRL } from "@/lib/money";
import { fmtDateTime, todayYmd } from "@/lib/dates";
import { Field, Flash, PageHead } from "@/components/ui";
import { saveServiceAction } from "@/app/actions/admin";

export const metadata = { title: "Serviço" };
const brl = (c: number) => (c / 100).toFixed(2).replace(".", ",");

export default async function ServiceEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("admin.catalog");
  const db = await getDb();
  const isNew = id === "novo";
  const cat = await listCatalog(db, ctx.unitId);
  const s = isNew ? null : (await listServices(db, ctx.unitId, true)).find((x) => x.id === id);
  if (!isNew && !s) notFound();
  const history = s ? await priceHistory(db, ctx, s.id) : [];
  const cf = [...(s?.custom_fields ?? [])];
  while (cf.length < 5) cf.push({ label: "", value: "" });
  return (
    <>
      <PageHead title={isNew ? "Novo serviço" : s!.name} sub={isNew ? "Defina como o serviço aparece na agenda e quanto custa." : `Preço atual ${s!.price_cents == null ? "não definido" : fmtBRL(s!.price_cents)}`}>
        <Link className="btn ghost" href="/admin/servicos">Voltar</Link>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form action={saveServiceAction} className="card form">
        {!isNew ? <input type="hidden" name="id" value={s!.id} /> : null}
        <div className="fields">
          <Field label="Nome"><input name="name" defaultValue={s?.name ?? ""} required /></Field>
          <Field label="Categoria">
            <select name="categoryId" defaultValue={s?.category_id ?? ""}><option value="">Sem categoria</option>{cat.svcCats.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
          <Field label="Duração (minutos)"><input name="duration" type="number" min={1} defaultValue={s?.duration_minutes ?? 30} required /></Field>
          <Field label="Intervalo após (minutos)"><input name="buffer" type="number" min={0} defaultValue={s?.buffer_minutes ?? 0} /></Field>
          <Field label="Cor na agenda"><input name="color" type="color" defaultValue={s?.color ?? "#8b6b4a"} /></Field>
          <Field label="Ordem"><input name="sort" type="number" defaultValue={s?.sort_order ?? 0} /></Field>
        </div>
        <Field label="Descrição (opcional)"><textarea name="description" defaultValue={s?.description ?? ""} /></Field>
        <fieldset>
          <legend>Preço</legend>
          <div className="fields">
            <Field label="Preço (R$)"><input name="price" inputMode="decimal" defaultValue={s?.price_cents != null ? brl(s.price_cents) : ""} placeholder="0,00" /></Field>
            <Field label="Vale a partir de (opcional)"><input name="validFrom" type="date" defaultValue="" min={todayYmd()} /></Field>
          </div>
          <small>Alterar o preço cria uma nova vigência: atendimentos e agendamentos já registrados mantêm o preço antigo. Deixe a data em branco para valer imediatamente.</small>
        </fieldset>
        <fieldset>
          <legend>Quem realiza (nenhum marcado = todos)</legend>
          <div className="row">
            {cat.staff.filter((p) => p.is_active).map((p) => <label className="check" key={p.id}><input type="checkbox" name="staffIds" value={p.id} defaultChecked={s?.staff_ids.includes(p.id)} />{p.name}</label>)}
          </div>
        </fieldset>
        <fieldset>
          <legend>Campos personalizados (livres)</legend>
          <div className="stack">
            {cf.slice(0, 5).map((f, i) => (
              <div className="fields" key={i}>
                <Field label={`Rótulo ${i + 1}`}><input name={`cf_label${i}`} defaultValue={f.label} placeholder="Ex.: Produto utilizado" /></Field>
                <Field label="Valor"><input name={`cf_value${i}`} defaultValue={f.value} /></Field>
              </div>
            ))}
          </div>
        </fieldset>
        {!isNew ? <label className="check"><input type="checkbox" name="isActive" defaultChecked={s!.is_active} />Serviço ativo (aparece para agendamento)</label> : null}
        <div className="sticky-actions"><button className="btn accent" type="submit">Salvar serviço</button></div>
      </form>
      {history.length ? (
        <section className="card stack">
          <h2>Histórico de preços</h2>
          <div className="tablewrap"><table>
            <thead><tr><th>Vigência a partir de</th><th>Profissional</th><th className="n">Preço</th><th>Registrado por</th></tr></thead>
            <tbody>{history.map((h, i) => <tr key={i}><td className="nowrap">{fmtDateTime(h.valid_from)}</td><td>{h.staff_name ?? "Todos"}</td><td className="n">{fmtBRL(h.price_cents)}</td><td>{h.created_by_name ?? "—"}</td></tr>)}</tbody>
          </table></div>
        </section>
      ) : null}
    </>
  );
}
