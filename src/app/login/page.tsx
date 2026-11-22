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
          <div className="brand">MARFIM</div>
          <p className="muted">Studio OS · acesso restrito à equipe</p>
        </div>
        <Flash ok={sp.ok} erro={sp.erro} />
        <form action={loginAction} className="form">
          <label>E-mail<input name="email" type="email" autoComplete="username" required autoFocus /></label>
          <label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="btn accent" type="submit">Entrar</button>
        </form>
        <small>Após 5 tentativas incorretas a conta é bloqueada por 15 minutos.</small>
      </div>
    </div>
  );
}
