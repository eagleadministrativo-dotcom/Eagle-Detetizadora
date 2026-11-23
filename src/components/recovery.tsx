"use client";
import { useActionState } from "react";
import { recoveryCodesAction } from "@/app/actions/auth";

/** Gera e mostra os códigos de recuperação uma única vez. Gerar de novo invalida os anteriores. */
export function RecoveryCodes({ left }: { left: number }) {
  const [state, run, pending] = useActionState(recoveryCodesAction, null);
  const codes = state?.codes;
  return (
    <div className="stack">
      {codes ? (
        <>
          <div className="alert warn" role="status">Guarde estes códigos agora (foto, papel ou gerenciador de senhas). Eles não aparecem de novo. Cada um vale uma vez.</div>
          <ol className="rcodes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ol>
          <div className="row">
            <button type="button" className="btn ghost small" onClick={() => navigator.clipboard?.writeText(codes.join("\n")).catch(() => {})}>Copiar todos</button>
          </div>
        </>
      ) : (
        <small>{left > 0 ? `${left} código(s) de recuperação disponível(is).` : "Nenhum código de recuperação gerado."} Eles permitem entrar se você perder o celular.</small>
      )}
      {state?.erro ? <div className="alert bad" role="alert">{state.erro}</div> : null}
      <form action={run}>
        <button className="btn small" type="submit" disabled={pending}>{pending ? "Gerando…" : left > 0 || codes ? "Gerar novos códigos" : "Gerar códigos de recuperação"}</button>
      </form>
    </div>
  );
}
