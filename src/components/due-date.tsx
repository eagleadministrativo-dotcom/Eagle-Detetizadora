"use client";
import { useEffect, useRef } from "react";

const plusDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * "Vence em" do orçamento: sai sozinho da validade escolhida ("15 dias") contada da data do orçamento.
 * Se a pessoa mudar a data à mão, o campo deixa de ser recalculado.
 */
export function DueDateField({ defaultValue }: { defaultValue?: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const touched = useRef(!!defaultValue);
  useEffect(() => {
    const el = input.current;
    const form = el?.form;
    if (!el || !form) return;
    const calc = () => {
      if (touched.current) return;
      const validity = (form.elements.namedItem("validityText") as HTMLSelectElement | null)?.value ?? "";
      const issue = (form.elements.namedItem("issueDate") as HTMLInputElement | null)?.value || new Date().toISOString().slice(0, 10);
      const m = /(\d{1,3})\s*dias/i.exec(validity);
      el.value = m && Number(m[1]) > 0 ? plusDays(issue, Number(m[1])) : "";
    };
    const onChange = (e: Event) => { const n = (e.target as HTMLInputElement).name; if (n === "validityText" || n === "issueDate") calc(); };
    calc();
    form.addEventListener("change", onChange);
    return () => form.removeEventListener("change", onChange);
  }, []);
  return (
    <label>Vence em (o sistema avisa antes)
      <input ref={input} type="date" name="validUntil" defaultValue={defaultValue ?? ""} onChange={() => { touched.current = true; }} />
    </label>
  );
}
