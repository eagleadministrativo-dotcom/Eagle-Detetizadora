import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { isDomainError } from "@/server/errors";
import { getUserAccess, listProfiles } from "@/server/services/access";
import { ACCESS_GROUPS, PERMISSION_GROUPS, ROLE_LABEL, accessPickerProps } from "@/server/permissions";
import { fmtDateTime } from "@/lib/dates";
import { Badge, ConfirmAction, Field, Flash, PageHead } from "@/components/ui";
import { AccessPicker } from "@/components/access-picker";
import { applyProfileAction, setAccessAction } from "@/app/actions/access";

export const metadata = { title: "Cargo e acesso" };
const label = new Map([...PERMISSION_GROUPS, ...ACCESS_GROUPS].flatMap((g) => g.items.map(([k, l]) => [k as string, `${g.title}: ${l}`] as const)));

export default async function AccessPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("users.manage");
  const db = await getDb();
  let a;
  try { a = await getUserAccess(db, ctx, id); } catch (e) { if (isDomainError(e)) notFound(); throw e; }
  const profiles = await listProfiles(db, ctx);
  const self = id === ctx.userId;
  const locked = self || (a.user.role === "administrador" && ctx.role !== "administrador");
  const picker = accessPickerProps(ctx);
  const pages = ACCESS_GROUPS.map((g) => [g.title, g.title === "Tarefas" || g.items.some(([k]) => a.perms.has(k))] as const);
  return (
    <>
      <PageHead title={a.user.full_name} sub={<>{a.user.email} · {ROLE_LABEL[a.user.role]}{profiles.find((x) => x.id === a.user.profile_id) ? ` · perfil ${profiles.find((x) => x.id === a.user.profile_id)!.name}` : ""}</>}><Link className="btn ghost" href="/admin/usuarios">Voltar</Link></PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <section className="card stack">
        <h2>O que aparece no menu dela hoje</h2>
        <div className="row">{pages.map(([n, on]) => <Badge key={n} tone={on ? "ok" : ""}>{n}{on ? "" : ": não"}</Badge>)}</div>
        {a.user.role === "tecnico" && !a.user.staff_id ? <small className="late">Sem vínculo com um técnico da Equipe: a agenda e os retornos dela ficam vazios.</small> : null}
      </section>
      {locked ? <div className="alert">{self ? "Você não pode alterar o seu próprio acesso." : "Só o administrador altera o acesso de outro administrador."}</div> : (
        <>
          <form action={setAccessAction} className="card form">
            <h2>Cargo e acesso</h2>
            <input type="hidden" name="id" value={id} />
            <AccessPicker {...picker} role={a.user.role} perms={[...a.perms]} />
            <Field label="Salvar também como perfil para usar em outros convites (opcional)"><input name="profileName" placeholder="Ex.: Técnico que também faz orçamento" /></Field>
            <small>Vale na próxima tela que a pessoa abrir. Tirar um acesso tem efeito na hora.</small>
            <div className="sticky-actions"><button className="btn accent" type="submit">Salvar cargo e acesso</button></div>
          </form>
          {profiles.length ? <ConfirmAction label="Aplicar um perfil salvo" tone="neutral" action={applyProfileAction} submit="Aplicar perfil" warn="Substitui o cargo e o acesso atuais."><input type="hidden" name="id" value={id} /><Field label="Perfil"><select name="profileId">{profiles.map((x) => <option key={x.id} value={x.id}>{x.name} ({ROLE_LABEL[x.base_role]})</option>)}</select></Field></ConfirmAction> : null}
        </>
      )}
      <section className="card stack"><h2>Histórico</h2>{a.history.length === 0 ? <small>Nenhuma alteração.</small> : a.history.map((h, i) => <div key={i}><small>{fmtDateTime(h.created_at)} · {h.user_name ?? "Sistema"}</small><div>{h.action === "PERMISSOES_ALTERADAS" ? <>{h.after?.added?.length ? <>Liberou: {h.after.added.map((x) => label.get(x) ?? x).join("; ")}. </> : null}{h.before?.removed?.length ? <>Retirou: {h.before.removed.map((x) => label.get(x) ?? x).join("; ")}.</> : null}</> : h.action === "CARGO_ALTERADO" ? <>Cargo: {ROLE_LABEL[(h.before as { role?: keyof typeof ROLE_LABEL } | null)?.role ?? "pendente"]} → {ROLE_LABEL[(h.after as { role?: keyof typeof ROLE_LABEL } | null)?.role ?? "pendente"]}</> : h.action.replaceAll("_", " ").toLowerCase()}</div></div>)}</section>
    </>
  );
}
