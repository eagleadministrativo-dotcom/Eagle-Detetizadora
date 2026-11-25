import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { isSetupDone } from "@/server/services/bootstrap";
import { setupAction } from "@/app/actions/auth";
import { Flash } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Primeira configuração" };

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const sp = await searchParams;
  if (await isSetupDone(await getDb())) redirect("/login");
  return (
    <div className="login">
      <div className="card stack" style={{ width: "min(100%, 480px)" }}>
        <div>
          <div className="brand"><span className="mark" aria-hidden="true">E</span><span className="name">EAGLE<small>Detetizadora</small></span></div>
          <h1>Primeira configuração</h1>
          <p className="muted">Crie a empresa e a conta do administrador. Todo o restante (serviços, preços, equipe, formas de pagamento, horários) é cadastrado depois, dentro do sistema.</p>
        </div>
        <Flash erro={sp.erro} />
        <form action={setupAction} className="form">
          <label>Nome da empresa<input name="org" defaultValue="Eagle Detetizadora" required /></label>
          <label>Nome da unidade<input name="unit" defaultValue="Matriz" required /></label>
          <label>Seu nome<input name="name" required autoComplete="name" /></label>
          <label>E-mail de acesso<input name="email" type="email" required autoComplete="username" /></label>
          <label>Senha (mín. 10 caracteres, com letras e números)<input name="password" type="password" minLength={10} required autoComplete="new-password" /></label>
          <label>Repita a senha<input name="password2" type="password" minLength={10} required autoComplete="new-password" /></label>
          <button className="btn accent" type="submit">Criar e entrar</button>
        </form>
      </div>
    </div>
  );
}
