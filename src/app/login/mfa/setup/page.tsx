import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { totpUri } from "@/server/auth";
import { currentSession } from "@/server/session";
import { mfaSetupFinishAction, mfaSetupStartAction, logoutAction } from "@/app/actions/auth";
import { Flash } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ativar autenticador" };

export default async function MfaSetupPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const sp = await searchParams;
  const s = await currentSession();
  if (!s) redirect("/login");
  if (s.mfaVerified && s.user.mfaEnabled) redirect("/conta");
  const [u] = await (await getDb()).query<{ mfa_secret: string | null }>("select mfa_secret from users where id=$1", [s.user.id]);
  const secret = u?.mfa_secret;
  return (
    <div className="login">
      <div className="card stack" style={{ width: "min(100%, 460px)" }}>
        <div>
          <div className="brand"><span className="mark" aria-hidden="true">E</span><span className="name">EAGLE<small>Detetizadora</small></span></div>
          <h1>Ative a verificação em duas etapas</h1>
          <p className="muted">Obrigatória para administrador e gerente. Use um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy, 1Password...).</p>
        </div>
        <Flash erro={sp.erro} />
        {!secret ? (
          <form action={mfaSetupStartAction}><button className="btn accent" type="submit">Gerar chave</button></form>
        ) : (
          <>
            <ol className="stack" style={{ paddingLeft: 18, margin: 0 }}>
              <li>No aplicativo, escolha &quot;adicionar conta&quot; e informe a chave manualmente:</li>
            </ol>
            <code style={{ background: "var(--surface-2)", padding: "10px 12px", borderRadius: 6, wordBreak: "break-all", letterSpacing: "0.08em", fontSize: 16 }}>{secret.match(/.{1,4}/g)?.join(" ")}</code>
            <small>Tipo: baseado em tempo (TOTP), 6 dígitos, 30 s. Link para aplicativos compatíveis: <a href={totpUri(secret, s.user.email)}>abrir no autenticador</a>.</small>
            <form action={mfaSetupFinishAction} className="form">
              <label>2. Digite o código gerado<input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required /></label>
              <button className="btn accent" type="submit">Ativar</button>
            </form>
          </>
        )}
        <form action={logoutAction}><button className="btn small ghost" type="submit">Sair</button></form>
      </div>
    </div>
  );
}
