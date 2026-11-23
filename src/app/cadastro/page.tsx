import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { Icon, type IconName } from "@/components/icons";
import { SIGNUP_CHOICES, type SignupChoice } from "@/server/services/invites";

export const metadata = { title: "Cadastrar" };
const ICON: Record<SignupChoice, IconName> = { dono: "shield", barbeiro: "scissors", admin: "gear" };

export default function SignupChoicePage() {
  return (
    <AuthCard title="Como você vai usar o app?" sub="Escolha o perfil do seu convite." back={{ href: "/bem-vindo", label: "Voltar" }}>
      <nav className="choices" aria-label="Tipo de acesso">
        {(Object.keys(SIGNUP_CHOICES) as SignupChoice[]).map((k) => (
          <Link key={k} className="choice" href={`/cadastro/${k}`}>
            <Icon name={ICON[k]} />
            <span><b>{SIGNUP_CHOICES[k].label}</b><small>{SIGNUP_CHOICES[k].sub}</small></span>
          </Link>
        ))}
      </nav>
    </AuthCard>
  );
}
