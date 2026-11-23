import { AuthCard } from "@/components/auth-card";
import { resetStartAction } from "@/app/actions/auth";

export const metadata = { title: "Esqueci a senha" };

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const sp = await searchParams;
  return (
    <AuthCard title="Esqueci a senha" sub="Informe o e-mail da sua conta. Você recebe um código, confirma e cria uma senha nova. Isso também desbloqueia o acesso." erro={sp.erro} back={{ href: "/login", label: "Voltar para Entrar" }}>
      <form action={resetStartAction} className="form">
        <label>E-mail<input name="email" type="email" autoComplete="email" inputMode="email" required autoFocus /></label>
        <button className="btn accent" type="submit">Enviar código</button>
      </form>
    </AuthCard>
  );
}
