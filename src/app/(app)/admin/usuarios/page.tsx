import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { listUsers } from "@/server/services/bootstrap";
import { listCatalog } from "@/server/services/catalog";
import { PERMISSION_GROUPS, ROLE_LABEL, type Role } from "@/server/permissions";
import { fmtDateTime } from "@/lib/dates";
import { Badge, ConfirmAction, Field, Flash, PageHead } from "@/components/ui";
import { listProfiles } from "@/server/services/access";
import { deleteProfileAction } from "@/app/actions/access";
import { createUserAction, resetPasswordAction, updateUserAction } from "@/app/actions/admin";

export const metadata = { title: "Usuários e permissões" };
const ROLES = Object.keys(ROLE_LABEL) as Role[];

export default async function UsersAdmin({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("users.manage");
  const db = await getDb();
  const users = await listUsers(db, ctx);
  const cat = await listCatalog(db, ctx.unitId);
  const profiles = await listProfiles(db, ctx);
  const freeStaff = cat.staff.filter((s) => s.is_active && !s.user_id);
  return (
    <>
      <PageHead title="Usuários e permissões" sub="Cada pessoa tem login próprio. As permissões são verificadas no servidor em toda operação." />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="stack">
        {users.map((u) => (
          <details className="card" key={u.id}>
            <summary><b>{u.full_name}</b> · {u.email} <Badge tone="solid">{ROLE_LABEL[u.role]}</Badge> {!u.is_active ? <Badge>inativo</Badge> : null} {u.mfa_enabled ? <Badge tone="ok">2FA</Badge> : <Badge tone="warn">sem 2FA</Badge>} {u.staff_name ? <small>· profissional: {u.staff_name}</small> : null}</summary>
            <div className="stack" style={{ marginTop: 12 }}>
              <small>Último acesso: {u.last_login_at ? fmtDateTime(u.last_login_at) : "nunca"}</small>
              <form action={updateUserAction} className="form">
                <input type="hidden" name="id" value={u.id} />
                <div className="fields">
                  <Field label="Perfil"><select name="role" defaultValue={u.role}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
                  <label className="check"><input type="checkbox" name="isActive" defaultChecked={u.is_active} />Acesso ativo</label>
                </div>
                <div className="row"><button className="btn" type="submit">Salvar</button><Link className="btn accent" href={`/admin/usuarios/${u.id}`}>Permissões individuais</Link></div>
              </form>
              <ConfirmAction label="Redefinir senha e 2FA" action={resetPasswordAction} submit="Redefinir" warn="Encerra todas as sessões do usuário e reinicia o autenticador.">
                <input type="hidden" name="id" value={u.id} />
                <Field label="Nova senha provisória (mín. 10, letras e números)"><input name="password" type="password" minLength={10} required autoComplete="new-password" /></Field>
              </ConfirmAction>
            </div>
          </details>
        ))}
      </div>
      <form action={createUserAction} className="card form">
        <h2>Novo usuário</h2>
        <div className="fields">
          <Field label="Nome"><input name="name" required /></Field>
          <Field label="E-mail"><input name="email" type="email" required autoComplete="off" /></Field>
          <Field label="Perfil"><select name="role" defaultValue="barbeiro">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
          <Field label="Vincular ao profissional"><select name="staffId" defaultValue=""><option value="">—</option>{freeStaff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Senha inicial (mín. 10, letras e números)"><input name="password" type="password" minLength={10} required autoComplete="new-password" /></Field>
        </div>
        <fieldset>
          <legend>Acesso</legend>
          <Field label="Começar com"><select name="profileId" defaultValue=""><option value="">O padrão do perfil escolhido acima</option>{profiles.map((x) => <option key={x.id} value={x.id}>Perfil salvo: {x.name}</option>)}<option value="custom">Escolher uma a uma (abaixo)</option></select></Field>
          <details style={{ marginTop: 10 }}><summary>Permissões uma a uma</summary><div className="permgrid" style={{ marginTop: 10 }}>{PERMISSION_GROUPS.map((g) => <fieldset key={g.title}><legend>{g.title}</legend>{g.items.map(([k, l]) => <label key={k} className="check"><input type="checkbox" name="perm" value={k} disabled={k === "tasks.own"} defaultChecked={k === "tasks.own"} />{l}</label>)}</fieldset>)}</div></details>
        </fieldset>
        <small>Barbeiros precisam estar vinculados a um profissional para ter agenda própria. Proprietário e gerente configuram a verificação em duas etapas no primeiro acesso.</small>
        <div><button className="btn accent" type="submit">Criar usuário</button></div>
      </form>
      {profiles.length ? <section className="card stack"><h2>Perfis salvos</h2>{profiles.map((x) => <div className="row" key={x.id}><span className="grow"><b>{x.name}</b> <small>· {ROLE_LABEL[x.base_role]} · {x.permissions.length} permissões · {x.users} pessoa(s)</small></span><form action={deleteProfileAction}><input type="hidden" name="id" value={x.id} /><button className="btn small ghost" type="submit">Remover</button></form></div>)}</section> : null}
    </>
  );
}
