"use client";
import { ErrorBox } from "@/components/ui";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorBox title="Não foi possível carregar esta tela">
      <p className="muted">Nenhum dado foi alterado. Tente novamente; se persistir, avise o responsável pelo sistema.</p>
      <button className="btn" type="button" onClick={reset}>Tentar novamente</button>
    </ErrorBox>
  );
}
