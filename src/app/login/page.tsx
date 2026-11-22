import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { isSetupDone } from "@/server/services/bootstrap";
import { currentSession } from "@/server/session";
import { loginAction } from "@/app/actions/auth";
import { Flash } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const sp = await searchParams;
  if (!(await isSetupDone(await getDb()))) redirect("/setup");
  const s = await currentSession();
  if (s?.mfaVerified) redirect("/");
  return (
    <div className="login">
      <div className="card stack">
        <div>
          <div className="brand"><span className="mark" aria-hidden="true">M</span><span className="name">MARFIM<small>Studio OS</small></span></div>
          <h1 style={{ fontSize: "1.35rem" }}>Acesso da equipe</h1>
          <p className="muted" style={{ marginTop: 4 }}>Sistema privado. Entre com seu e-mail e senha.</p>
        </div>
        <Flash ok={sp.ok} erro={sp.erro} />
        <form action={loginAction} className="form">
          <label>E-mail<input name="email" type="email" autoComplete="username" required autoFocus /></label>
          <label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="btn accent" type="submit">Entrar</button>
        </form>
        <small>Esqueceu a senha? Peça ao proprietário para redefinir em Administração → Usuários. Após 5 tentativas incorretas a conta é bloqueada por 15 minutos.</small>
      </div>
    </div>
  );
}
