import { notFound } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { signupStartAction } from "@/app/actions/auth";
import { isChoice, SIGNUP_CHOICES } from "@/server/services/invites";

export const metadata = { title: "Cadastrar" };

export default async function SignupEmailPage({ params, searchParams }: { params: Promise<{ perfil: string }>; searchParams: Promise<{ erro?: string }> }) {
  const { perfil } = await params;
  const sp = await searchParams;
  if (!isChoice(perfil)) notFound();
  return (
    <AuthCard title={SIGNUP_CHOICES[perfil].label} sub="Informe o e-mail em que você recebeu o convite. Vamos enviar um código para confirmar que ele é seu." erro={sp.erro} back={{ href: "/cadastro", label: "Trocar perfil" }}>
      <form action={signupStartAction} className="form">
        <input type="hidden" name="perfil" value={perfil} />
        <label>E-mail<input name="email" type="email" autoComplete="email" inputMode="email" required autoFocus /></label>
        <button className="btn accent" type="submit">Enviar código</button>
      </form>
    </AuthCard>
  );
}
