import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { isSetupDone } from "@/server/services/bootstrap";
import { currentSession } from "@/server/session";
import { enterAction } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bem-vindo" };

export default async function WelcomePage() {
  if (!(await isSetupDone(await getDb()))) redirect("/setup");
  if ((await currentSession())?.mfaVerified) redirect("/");
  return (
    <AuthCard title="Bem-vindo" sub="Sistema privado da equipe MARFIM. Já tem acesso? Entre. Recebeu um convite? Cadastre-se.">
      <div className="authactions">
        <form action={enterAction}><button className="btn accent" type="submit">Entrar</button></form>
        <Link className="btn" href="/cadastro">Cadastrar</Link>
      </div>
      <small>O cadastro só funciona para o e-mail que recebeu convite do dono ou do administrador da barbearia.</small>
    </AuthCard>
  );
}
