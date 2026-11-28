"use client";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const BUSY = "data-busy";
const LABEL = "data-label";
const STORE = "fg:last";
const MAX_AGE = 3 * 60 * 1000;

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

type Saved = { path: string; at: number; form: number; names: string; fields: [string, string, string][] };
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const SKIP = new Set(["file", "password", "submit", "button", "reset", "image"]);
const fieldsOf = (form: HTMLFormElement) =>
  [...form.elements].filter((el): el is Field => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
    && !!el.name && !el.name.startsWith("$ACTION") && !(el instanceof HTMLInputElement && SKIP.has(el.type)));
const signature = (form: HTMLFormElement) => [...new Set(fieldsOf(form).map((f) => f.name))].sort().join("|");

/** Guarda o que foi digitado no formulário enviado, para devolver se o servidor responder com erro. */
function remember(form: HTMLFormElement) {
  const fields: [string, string, string][] = [];
  for (const el of fieldsOf(form)) {
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) fields.push([el.name, el.value, el.checked ? "1" : "0"]);
    else if (el instanceof HTMLSelectElement && el.multiple) [...el.selectedOptions].forEach((o) => fields.push([el.name, o.value, "1"]));
    else fields.push([el.name, el.value, el instanceof HTMLInputElement && el.type === "hidden" ? "h" : "v"]);
  }
  const saved: Saved = { path: location.pathname, at: Date.now(), form: [...document.forms].indexOf(form), names: signature(form), fields };
  try { sessionStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* sem armazenamento: segue sem restaurar */ }
}

// muda o valor como se fosse digitado, para os componentes do React também perceberem
function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, v: string) {
  if (el.value === v) return;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Depois de um erro, preenche de novo o formulário com o que a pessoa tinha digitado. */
function restore() {
  let saved: Saved | null = null;
  try { saved = JSON.parse(sessionStorage.getItem(STORE) ?? "null"); sessionStorage.removeItem(STORE); } catch { return; }
  if (!saved || saved.path !== location.pathname || Date.now() - saved.at > MAX_AGE) return;
  const forms = [...document.forms];
  const form = forms[saved.form] && signature(forms[saved.form]) === saved.names ? forms[saved.form] : forms.find((f) => signature(f) === saved!.names);
  if (!form) return;
  const els = fieldsOf(form);
  // campos escondidos de componentes (ex.: cliente escolhido na busca) avisam o componente
  for (const [name, value] of saved.fields.filter((f) => f[2] === "h")) {
    els.filter((e) => e.name === name && e instanceof HTMLInputElement && e.type === "hidden").forEach((e) => e.dispatchEvent(new CustomEvent("fg:restore", { detail: value })));
  }
  const byName = new Map<string, [string, string][]>();
  for (const [name, value, kind] of saved.fields) if (kind !== "h") byName.set(name, [...(byName.get(name) ?? []), [value, kind]]);
  const used = new Map<string, number>();
  for (const el of els) {
    const list = byName.get(el.name);
    if (!list || (el instanceof HTMLInputElement && el.type === "hidden")) continue;
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      const want = list.some(([v, k]) => v === el.value && k === "1");
      if (el.checked !== want) el.click();
    } else if (el instanceof HTMLSelectElement && el.multiple) {
      [...el.options].forEach((o) => { o.selected = list.some(([v]) => v === o.value); });
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // vários campos com o mesmo nome (linhas de itens): na ordem em que apareceram
      const i = used.get(el.name) ?? 0;
      used.set(el.name, i + 1);
      if (list[i]) setValue(el, list[i][0]);
    }
  }
}

/**
 * Evita gravar duas vezes: ao enviar um formulário que salva no sistema, os botões dele ficam travados com "Salvando…"
 * até a página responder (ou 15 s, se algo der errado na rede). Se a resposta for um erro, o formulário volta preenchido.
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
      remember(form);
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

  // a página respondeu (mudou o endereço ou a mensagem): libera os formulários; se foi erro, devolve o que foi digitado
  useEffect(() => {
    document.querySelectorAll(`form[${BUSY}]`).forEach(release);
    if (!new URLSearchParams(query).has("erro")) {
      try { const s = JSON.parse(sessionStorage.getItem(STORE) ?? "null") as Saved | null; if (s && (new URLSearchParams(query).has("ok") || s.path !== location.pathname || Date.now() - s.at > MAX_AGE)) sessionStorage.removeItem(STORE); } catch { /* nada */ }
      return;
    }
    const t = setTimeout(restore, 60);
    return () => clearTimeout(t);
  }, [path, query]);

  return null;
}
