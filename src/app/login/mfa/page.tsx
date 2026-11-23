import { redirect } from "next/navigation";
import { currentSession } from "@/server/session";
import { mfaVerifyAction, logoutAction } from "@/app/actions/auth";
import { Flash } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verificação em duas etapas" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const sp = await searchParams;
  const s = await currentSession();
  if (!s) redirect("/login");
  if (s.mfaVerified) redirect("/");
  if (!s.user.mfaEnabled) redirect("/login/mfa/setup");
  return (
    <div className="login">
      <div className="card stack">
        <div>
          <div className="brand"><span className="mark" aria-hidden="true">M</span><span className="name">MARFIM<small>Studio OS</small></span></div>
          <h1>Verificação em duas etapas</h1>
          <p className="muted">Digite o código de 6 dígitos do seu aplicativo autenticador. Sem o celular? Use um dos códigos de recuperação (formato ABCD-EFGH).</p>
        </div>
        <Flash erro={sp.erro} />
        <form action={mfaVerifyAction} className="form">
          <label>Código<input name="code" autoComplete="one-time-code" autoCapitalize="characters" pattern="[0-9 ]{6,7}|[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}" maxLength={9} required autoFocus /></label>
          <button className="btn accent" type="submit">Verificar</button>
        </form>
        <form action={logoutAction}><button className="btn small ghost" type="submit">Cancelar e sair</button></form>
      </div>
    </div>
  );
}
