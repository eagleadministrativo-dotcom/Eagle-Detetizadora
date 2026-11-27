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
import { inviteUserAction, resendInviteAction, resetPasswordAction, revokeInviteAction, updateUserAction } from "@/app/actions/admin";
import { hasTempPassword, listInvites } from "@/server/services/invites";
import { tempPasswordAction } from "@/app/actions/auth";

export const metadata = { title: "Usuários e permissões" };
const ROLES = Object.keys(ROLE_LABEL) as Role[];

export default async function UsersAdmin({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("users.manage");
  const db = await getDb();
  const users = await listUsers(db, ctx);
  const cat = await listCatalog(db, ctx.unitId);
  const profiles = await listProfiles(db, ctx);
  const invites = await listInvites(db, ctx);
  const hasTemp = await hasTempPassword(db, ctx.unitId);
  const freeStaff = cat.staff.filter((s) => s.is_active && !s.user_id);  return (
    <>
      <PageHead title="Usuários e permissões" sub="Cada pessoa tem login próprio. As permissões são verificadas no servidor em toda operação." />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="stack">
        {users.map((u) => (
          <details className="card" key={u.id}>
            <summary><b>{u.full_name}</b> · {u.email} <Badge tone="solid">{ROLE_LABEL[u.role]}</Badge> {!u.is_active ? <Badge>inativo</Badge> : null} {u.email_verified ? null : <Badge tone="warn">e-mail a confirmar</Badge>} {u.staff_name ? <small>· profissional: {u.staff_name}</small> : null}</summary>
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
              <ConfirmAction label="Redefinir senha" action={resetPasswordAction} submit="Redefinir" warn="Encerra todas as sessões do usuário, em todos os aparelhos.">
                <input type="hidden" name="id" value={u.id} />
                <Field label="Nova senha provisória (mín. 10, letras e números)"><input name="password" type="password" minLength={10} required autoComplete="new-password" /></Field>
              </ConfirmAction>
            </div>
          </details>
        ))}
      </div>
      {invites.length ? (
        <section className="card stack">
          <h2>Convites</h2>
          {invites.map((i) => (
            <div className="row" key={i.id}>
              <span className="grow"><b>{i.full_name}</b> · {i.email} <Badge tone="solid">{ROLE_LABEL[i.role]}</Badge> {i.accepted_at ? <Badge tone="ok">acesso criado</Badge> : i.expired ?<Badge tone="warn">vencido</Badge> : <Badge tone="info">aguardando</Badge>}
                <br /><small>{i.accepted_at ? `Aceito em ${fmtDateTime(i.accepted_at)}` : `Enviado em ${fmtDateTime(i.created_at)}${i.invited_by_name ? ` por ${i.invited_by_name}` : ""}`}{i.staff_name ? ` · profissional: ${i.staff_name}` : ""}</small></span>
              {!i.accepted_at ? (
                <>
                  <form action={resendInviteAction}><input type="hidden" name="id" value={i.id} /><button className="btn small" type="submit">Reenviar</button></form>
                  <form action={revokeInviteAction}><input type="hidden" name="id" value={i.id} /><button className="btn small ghost" type="submit">Cancelar</button></form>
                </>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      <form action={tempPasswordAction} className="card form">
        <h2>Senha provisória dos convidados</h2>
        <p className="muted">{hasTemp ? "Definida." : "Ainda não definida."} Quem foi convidado entra com o próprio e-mail e esta senha. O app não libera o acesso: manda um link ao e-mail da pessoa, ela cria a senha nova e entra com ela. Passe a senha provisória pessoalmente ou por mensagem; ela só é guardada embaralhada.</p>
        <div className="fields">
          <Field label="Senha provisória (mín. 10, letras e números)"><input name="password" type="password" minLength={10} required autoComplete="new-password" /></Field>
          <Field label="Repita"><input name="password2" type="password" minLength={10} required autoComplete="new-password" /></Field>
        </div>
        <div><button className="btn" type="submit">{hasTemp ? "Trocar senha provisória" : "Salvar senha provisória"}</button></div>
      </form>
      <form action={inviteUserAction} className="card form">
        <h2>Convidar pessoa</h2>
        <p className="muted">Dois jeitos de a pessoa criar o acesso: entrar com o e-mail e a <b>senha provisória</b> (recebe um link no e-mail para criar a senha), ou tocar em <b>Cadastrar</b>, escolher o perfil e confirmar um código. Só e-mails convidados conseguem.</p>
        <div className="fields">
          <Field label="Nome"><input name="name" required /></Field>
          <Field label="E-mail"><input name="email" type="email" required autoComplete="off" /></Field>
          <Field label="Perfil"><select name="role" defaultValue="barbeiro">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
          <Field label="Vincular ao profissional"><select name="staffId" defaultValue=""><option value="">—</option>{freeStaff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        </div>
        <fieldset>
          <legend>Acesso</legend>
          <Field label="Começar com"><select name="profileId" defaultValue=""><option value="">O padrão do perfil escolhido acima</option>{profiles.map((x) => <option key={x.id} value={x.id}>Perfil salvo: {x.name}</option>)}<option value="custom">Escolher uma a uma (abaixo)</option></select></Field>
          <details style={{ marginTop: 10 }}><summary>Permissões uma a uma</summary><div className="permgrid" style={{ marginTop: 10 }}>{PERMISSION_GROUPS.map((g) => <fieldset key={g.title}><legend>{g.title}</legend>{g.items.map(([k, l]) => <label key={k} className="check"><input type="checkbox" name="perm" value={k} disabled={k === "tasks.own"} defaultChecked={k === "tasks.own"} />{l}</label>)}</fieldset>)}</div></details>
        </fieldset>
        <small>Na tela de cadastro, Administrador aparece como “Dono da empresa”, Técnico como “Técnico de serviço”, Gerente como “Gerente” e Vendedores e Colaboradores como “Equipe comercial e apoio”. Técnicos precisam estar vinculados a um profissional para ter agenda própria. O convite vale por 14 dias.</small>
        <div><button className="btn accent" type="submit">Enviar convite</button></div>
      </form>
      {profiles.length ? <section className="card stack"><h2>Perfis salvos</h2>{profiles.map((x) => <div className="row" key={x.id}><span className="grow"><b>{x.name}</b> <small>· {ROLE_LABEL[x.base_role]} · {x.permissions.length} permissões · {x.users} pessoa(s)</small></span><form action={deleteProfileAction}><input type="hidden" name="id" value={x.id} /><button className="btn small ghost" type="submit">Remover</button></form></div>)}</section> : null}
    </>
  );
}
