import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ClearOfflineCache } from "@/components/live";
import { getDb } from "@/server/db";
import { isSetupDone } from "@/server/services/bootstrap";
import { currentSession, FAILS_COOKIE } from "@/server/session";
import { LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILS } from "@/server/auth";
import { loginAction } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const sp = await searchParams;
  if (!(await isSetupDone(await getDb()))) redirect("/setup");
  const s = await currentSession();
  if (s?.mfaVerified) redirect("/");
  const jar = await cookies();
  // primeiro acesso neste aparelho: tela de boas-vindas com Entrar e Cadastrar
  if (!jar.get("marfim_conhecido") && !sp.erro && !sp.ok) redirect("/bem-vindo");
  const fails = Number(jar.get(FAILS_COOKIE)?.value ?? 0);
  return (
    <AuthCard title="Entrar" sub="Sistema privado. Entre com seu e-mail e senha." ok={sp.ok} erro={sp.erro} back={{ href: "/cadastro", label: "Recebeu um convite? Cadastre-se" }}>
      <ClearOfflineCache />
      <form action={loginAction} className="form">
        <label>E-mail<input name="email" type="email" autoComplete="username" required autoFocus /></label>
        <label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>
        <button className="btn accent" type="submit">Entrar</button>
      </form>
      {fails >= LOGIN_MAX_FAILS ? (
        <div className="alert warn forgot" role="status">
          <span>Não lembra a senha? Redefina pelo e-mail: você recebe um código e cria uma senha nova.</span>
          <Link className="btn small accent" href="/esqueci">Esqueci a senha</Link>
        </div>
      ) : null}
      <small>Por segurança, depois de {LOGIN_MAX_FAILS} senhas erradas novas tentativas ficam bloqueadas por {LOGIN_LOCK_MINUTES} minutos.</small>
    </AuthCard>
  );
}
