import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { isDomainError } from "@/server/errors";
import { getUserAccess, listProfiles } from "@/server/services/access";
import { PERMISSION_GROUPS, ROLE_LABEL } from "@/server/permissions";
import { fmtDateTime } from "@/lib/dates";
import { Badge, ConfirmAction, Field, Flash, PageHead } from "@/components/ui";
import { applyProfileAction, setPermissionsAction } from "@/app/actions/access";

export const metadata = { title: "Permissões" };
const label = new Map(PERMISSION_GROUPS.flatMap((g) => g.items.map(([k, l]) => [k as string, `${g.title}: ${l}`] as const)));

export default async function AccessPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("users.manage");
  const db = await getDb();
  let a;
  try { a = await getUserAccess(db, ctx, id); } catch (e) { if (isDomainError(e)) notFound(); throw e; }
  const profiles = await listProfiles(db, ctx);
  const locked = a.user.role === "administrador" || id === ctx.userId;
  const screens = [["Agenda", a.perms.has("agenda.view_own") || a.perms.has("agenda.view_all")], ["Atendimentos", a.perms.has("attendance.view_own") || a.perms.has("attendance.view_all")], ["Clientes", a.perms.has("customers.view")], ["Tarefas", true], ["Retornos", a.perms.has("returns.own") || a.perms.has("returns.view_all")], ["Meu Financeiro", a.perms.has("finance.own")], ["Conquistas", a.perms.has("achievements.own")], ["Produtos", a.perms.has("products.view") || a.perms.has("products.sell")], ["Comissões", a.perms.has("commissions.view_all")], ["Painel da equipe", a.perms.has("team.view")], ["Financeiro geral", a.perms.has("finance.view")], ["Caixa", a.perms.has("cash.manage")], ["Relatórios", a.perms.has("reports.view")], ["Administração", ["admin.catalog", "admin.schedules", "admin.settings", "users.manage"].some((k) => a.perms.has(k as never))]] as const;
  return (
    <>
      <PageHead title={a.user.full_name} sub={<>{a.user.email} · {ROLE_LABEL[a.user.role]}{profiles.find((x) => x.id === a.user.profile_id) ? ` · perfil ${profiles.find((x) => x.id === a.user.profile_id)!.name}` : ""}</>}><Link className="btn ghost" href="/admin/usuarios">Voltar</Link></PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <section className="card stack"><h2>Prévia do acesso</h2><div className="row">{screens.map(([n, on]) => <Badge key={n} tone={on ? "ok" : ""}>{n}{on ? "" : ": não"}</Badge>)}</div>{["tecnico"].includes(a.user.role) && !a.user.staff_id ? <small className="late">Sem vínculo com um profissional: agenda, retornos e financeiro pessoais ficam vazios.</small> : null}</section>
      {locked ? <div className="alert">{id === ctx.userId ? "Você não pode alterar as suas próprias permissões." : "O acesso do proprietário é total e não pode ser reduzido."}</div> : (
        <>
          {profiles.length ? <ConfirmAction label="Aplicar um perfil salvo" tone="neutral" action={applyProfileAction} submit="Aplicar perfil" warn="Substitui as permissões atuais."><input type="hidden" name="id" value={id} /><Field label="Perfil"><select name="profileId">{profiles.map((x) => <option key={x.id} value={x.id}>{x.name} ({ROLE_LABEL[x.base_role]}, {x.permissions.length} permissões)</option>)}</select></Field></ConfirmAction> : null}
          <form action={setPermissionsAction} className="form">
            <input type="hidden" name="id" value={id} /><input type="hidden" name="role" value={a.user.role} />
            <div className="permgrid">
              {PERMISSION_GROUPS.map((g) => (
                <fieldset key={g.title}><legend>{g.title}</legend>
                  {g.items.map(([k, l]) => { const on = a.perms.has(k), forbid = !can(ctx, k) && !on; return <label key={k} className="check"><input type="checkbox" name="perm" value={k} defaultChecked={on} disabled={k === "tasks.own" || forbid} />{l}{forbid ? <small> (você não tem)</small> : null}</label>; })}
                </fieldset>
              ))}
            </div>
            <Field label="Salvar também como perfil (opcional)"><input name="profileName" placeholder="Ex.: Barbeiro com vendas" /></Field>
            <small>Vale na próxima tela que a pessoa abrir. Revogar tem efeito imediato.</small>
            <div className="sticky-actions"><button className="btn accent" type="submit">Salvar permissões</button></div>
          </form>
        </>
      )}
      <section className="card stack"><h2>Histórico</h2>{a.history.length === 0 ? <small>Nenhuma alteração.</small> : a.history.map((h, i) => <div key={i}><small>{fmtDateTime(h.created_at)} · {h.user_name ?? "Sistema"}</small><div>{h.action === "PERMISSOES_ALTERADAS" ? <>{h.after?.added?.length ? <>Concedeu: {h.after.added.map((x) => label.get(x) ?? x).join("; ")}. </> : null}{h.before?.removed?.length ? <>Revogou: {h.before.removed.map((x) => label.get(x) ?? x).join("; ")}.</> : null}</> : h.action.replaceAll("_", " ").toLowerCase()}</div></div>)}</section>
    </>
  );
}
