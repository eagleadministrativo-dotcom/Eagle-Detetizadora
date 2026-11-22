import Link from "next/link";
import { PageHead } from "@/components/ui";

export default function Forbidden() {
  return (
    <>
      <PageHead title="Acesso restrito" sub="Seu perfil não tem permissão para esta área." />
      <div className="card"><p>Se você precisa deste acesso, peça ao proprietário. <Link href="/">Voltar ao início</Link></p></div>
    </>
  );
}
