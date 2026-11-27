"use client";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const BUSY = "data-busy";
const LABEL = "data-label";

/** Formulário que grava (ação do servidor, POST). Busca e filtros (GET) ficam de fora. */
const isAction = (form: HTMLFormElement, submitter: HTMLElement | null) =>
  form.method.toLowerCase() === "post" || !!form.querySelector('input[name^="$ACTION"]')
  || (form.getAttribute("action") ?? "").startsWith("javascript:") || (submitter?.getAttribute("formaction") ?? "").startsWith("javascript:");

function release(form: Element) {
  form.removeAttribute(BUSY);
  form.querySelectorAll<HTMLButtonElement>(`button[${LABEL}]`).forEach((b) => {
    b.disabled = false;
    b.textContent = b.getAttribute(LABEL);
    b.removeAttribute(LABEL);
    b.removeAttribute("aria-busy");
  });
}

/**
 * Evita gravar duas vezes: ao enviar um formulário que salva no sistema, os botões dele ficam travados com "Salvando…"
 * até a página responder (ou 15 s, se algo der errado na rede). Vale para todos os formulários, sem mexer em cada um.
 */
export function FormGuard() {
  const path = usePathname();
  const query = useSearchParams().toString();

  useEffect(() => {
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      const submitter = e.submitter as HTMLElement | null;
      if (!(form instanceof HTMLFormElement) || !isAction(form, submitter)) return;
      if (form.hasAttribute(BUSY)) { e.preventDefault(); e.stopImmediatePropagation(); return; } // segundo clique: ignora
      form.setAttribute(BUSY, "1");
      // trava depois que o React já leu o formulário (o botão clicado ainda conta no envio)
      setTimeout(() => {
        form.querySelectorAll<HTMLButtonElement>('button[type="submit"], button:not([type])').forEach((b) => {
          if (b.hasAttribute(LABEL)) return;
          b.setAttribute(LABEL, b.textContent ?? "");
          b.disabled = true;
          b.setAttribute("aria-busy", "true");
          if (b === submitter) b.textContent = "Salvando…";
        });
      }, 0);
      setTimeout(() => release(form), 15000);
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);

  // a página respondeu (mudou o endereço ou a mensagem): libera os formulários que ficaram na tela
  useEffect(() => {
    document.querySelectorAll(`form[${BUSY}]`).forEach(release);
  }, [path, query]);

  return null;
}
