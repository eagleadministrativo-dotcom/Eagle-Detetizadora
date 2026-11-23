import { requireSession } from "@/server/session";
import { ROLE_LABEL } from "@/server/permissions";
import { changePasswordAction, mfaSetupStartAction } from "@/app/actions/auth";
import { Badge, Flash, PageHead } from "@/components/ui";
import { getDb } from "@/server/db";
import { getPrefs } from "@/server/services/access";
import { NOTIFY_GROUPS } from "@/server/services/notify";
import { savePrefsAction } from "@/app/actions/account";
import { ThemeChoice } from "@/components/client";
import { PushToggle } from "@/components/push-toggle";

export const metadata = { title: "Minha conta" };

export default async function Account({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession();
  const prefs = await getPrefs(await getDb(), s.user.id);
  return (
    <>
      <PageHead title="Minha conta" sub={`${s.user.fullName} · ${s.user.email} · ${ROLE_LABEL[s.ctx.role]}`} />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid cols-2">
        <section className="card stack">
          <h2>Alterar senha</h2>
          <form action={changePasswordAction} className="form">
            <label>Senha atual<input name="current" type="password" autoComplete="current-password" required /></label>
            <label>Nova senha (mín. 10, letras e números)<input name="next" type="password" minLength={10} autoComplete="new-password" required /></label>
            <label>Repita a nova senha<input name="next2" type="password" minLength={10} autoComplete="new-password" required /></label>
            <div><button className="btn" type="submit">Alterar senha</button></div>
          </form>
          <small>Ao alterar a senha, todas as sessões são encerradas.</small>
        </section>
        <section className="card stack">
          <h2>Verificação em duas etapas</h2>
          <p>{s.user.mfaEnabled ? <Badge tone="ok">Ativa</Badge> : <Badge tone="warn">Desativada</Badge>}</p>
          {!s.user.mfaEnabled ? (
            <form action={mfaSetupStartAction}><button className="btn accent" type="submit">Ativar agora</button></form>
          ) : <small>Para trocar de aparelho, peça ao proprietário para redefinir sua senha (isso reinicia o autenticador).</small>}
        </section>
        <section className="card stack" id="preferencias">
          <h2>Preferências</h2>
          <h3>Aparência</h3>
          <ThemeChoice initial={prefs.theme} />
          <form action={savePrefsAction} className="form">
            <label>Agenda abre em<select name="agendaView" defaultValue={prefs.agenda_view}><option value="dia">Dia</option><option value="semana">Semana</option><option value="mes">Mês</option></select></label>
            <fieldset>
              <legend>Enviar para o celular</legend>
              {NOTIFY_GROUPS.map((g) => <label className="switch" key={g.key}>{g.label}<input type="checkbox" role="switch" name={`n_${g.key}`} defaultChecked={prefs.notify[g.key] !== false} /></label>)}
            </fieldset>
            <small>Desligar aqui só silencia o celular. O aviso continua na central.</small>
            <div><button className="btn" type="submit">Salvar preferências</button></div>
          </form>
        </section>
        <section className="card stack">
          <h2>Notificações no celular</h2>
          <p>Receba tarefas, agenda e alertas como aviso do aplicativo, sem e-mail. Valores não aparecem na tela bloqueada. Ative em cada aparelho que você usa.</p>
          <PushToggle />
          <small>Para instalar: no Chrome, abra o menu e escolha &quot;Instalar aplicativo&quot;. No iPhone, use o Safari e &quot;Adicionar à Tela de Início&quot;.</small>
        </section>
      </div>
    </>
  );
}
