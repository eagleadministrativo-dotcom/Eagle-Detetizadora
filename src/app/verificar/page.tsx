import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { flowInfo } from "@/server/services/invites";
import { AuthCard } from "@/components/auth-card";
import { resendCodeAction, verifyCodeAction } from "@/app/actions/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirmar código" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const info = await flowInfo(await getDb(), (await cookies()).get("marfim_fluxo")?.value);
  if (!info) redirect("/bem-vindo");
  if (info.verified) redirect(info.purpose === "login" ? "/login" : "/definir-senha");
  const restart = info.purpose === "login" ? { href: "/login", label: "Voltar para Entrar" } : info.purpose === "senha" ? { href: "/esqueci", label: "Usar outro e-mail" } : { href: "/cadastro", label: "Usar outro e-mail" };
  return (
    <AuthCard title="Digite o código" sub={<>Enviado para <b>{info.email}</b>. Ele vale por 15 minutos.</>} ok={sp.ok} erro={sp.erro} back={restart}>
      <form action={verifyCodeAction} className="form">
        <label>Código de 6 dígitos<input name="code" className="codeinput" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus /></label>
        <button className="btn accent" type="submit">Confirmar</button>
      </form>
      <form action={resendCodeAction}><button className="btn ghost small" type="submit">Não chegou? Enviar outro código</button></form>
    </AuthCard>
  );
}
