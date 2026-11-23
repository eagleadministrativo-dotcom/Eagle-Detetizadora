import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { flowInfo } from "@/server/services/invites";
import { ROLE_LABEL } from "@/server/permissions";
import { AuthCard } from "@/components/auth-card";
import { finishPasswordAction } from "@/app/actions/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Criar senha" };

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const sp = await searchParams;
  const info = await flowInfo(await getDb(), (await cookies()).get("marfim_fluxo")?.value);
  if (!info) redirect("/bem-vindo");
  if (!info.verified) redirect("/verificar");
  const signup = info.purpose === "cadastro";
  return (
    <AuthCard
      title={signup ? "Crie sua senha" : "Nova senha"}
      sub={signup ? <>E-mail confirmado. Você entra como <b>{info.role ? ROLE_LABEL[info.role] : "membro da equipe"}</b>. Só você vai saber esta senha.</> : <>E-mail confirmado. Escolha a nova senha de <b>{info.email}</b>.</>}
      erro={sp.erro}
    >
      <form action={finishPasswordAction} className="form">
        {signup ? <label>Seu nome<input name="name" defaultValue={info.fullName ?? ""} autoComplete="name" required /></label> : null}
        <label>Senha (mín. 10 caracteres, com letras e números)<input name="password" type="password" minLength={10} autoComplete="new-password" required autoFocus={!signup} /></label>
        <label>Repita a senha<input name="password2" type="password" minLength={10} autoComplete="new-password" required /></label>
        <button className="btn accent" type="submit">{signup ? "Criar acesso e entrar" : "Salvar nova senha"}</button>
      </form>
    </AuthCard>
  );
}
