/**
 * Opções cadastradas que montam os textos do orçamento e da OS.
 * O texto montado continua salvo no próprio documento (o PDF, o Word e a importação não mudam);
 * ao editar, as opções que já estão no texto aparecem marcadas.
 */
export const DOC_OPTION_KINDS = ["aplicacao", "produto", "acompanha", "agendamento", "pagamento", "prazo", "validade"] as const;
export type DocOptionKind = (typeof DOC_OPTION_KINDS)[number];
export const DOC_OPTION_LABEL: Record<DocOptionKind, string> = {
  aplicacao: "Formas de aplicação", produto: "Produtos", acompanha: "Acompanha", agendamento: "Agendamento",
  pagamento: "Formas de pagamento", prazo: "Prazo de execução", validade: "Validade do orçamento",
};
/** Marcar várias (lista) ou escolher uma. */
export const MULTI_KINDS: DocOptionKind[] = ["aplicacao", "produto", "acompanha"];
/** "servico" = serviços do orçamento (um por linha); "servico_os" = serviços da OS (em uma frase). */
export type ComposeKind = DocOptionKind | "servico" | "servico_os";

/** Um serviço já marcado na agenda, para a mini agenda (data, hora, cliente, técnico). */
export interface AgendaItem { d: string; t: string; who: string; staff: string }

export interface DocOption { id: string; kind: DocOptionKind; group_label: string | null; text: string; sort_order: number; is_default: boolean; is_active: boolean }
/** Item marcado no formulário: texto da opção (e grupo, para produtos). `raw` = trecho do texto antigo que não bate com nenhuma opção. */
export interface Picked { t: string; g?: string | null; raw?: boolean; id?: string | null }

const COMBINING = /[̀-ͯ]/g;
export const norm = (v: string | null | undefined) =>
  (v ?? "").normalize("NFD").replace(COMBINING, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** "a, b e c." */
export function joinNatural(items: string[]): string {
  const xs = items.map((s) => s.trim().replace(/[.;,]+$/, "")).filter(Boolean);
  if (!xs.length) return "";
  const body = xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`;
  return `${body}.`;
}

/** Monta o texto do documento a partir dos itens marcados, na ordem em que aparecem. */
export function composeOptions(kind: ComposeKind, picked: Picked[], opts: { intro?: string | null } = {}): string {
  const items = picked.filter((p) => p.t?.trim());
  if (!items.length) return "";
  switch (kind) {
    case "servico":
      return items.map((p) => p.t.trim()).join("\n");
    case "servico_os": // OS: "Dedetização geral, desratização, limpeza de 2 caixas d'água."
      return `${items.map((p) => p.t.trim().replace(/[.;,]+$/, "")).join(", ")}.`;
    case "aplicacao":
      return items.map((p) => (p.raw ? p.t.trim() : `- ${p.t.trim()}`)).join("\n");
    case "produto": {
      const blocks: string[] = [];
      let current: string | null | undefined;
      let lines: string[] = [];
      const flush = () => { if (lines.length) blocks.push([current ? `${current}:` : null, ...lines].filter(Boolean).join("\n")); lines = []; };
      for (const p of items) {
        if (p.raw) { flush(); current = undefined; blocks.push(p.t.trim()); continue; }
        if ((p.g ?? null) !== (current ?? null)) { flush(); current = p.g ?? null; }
        lines.push(`• ${p.t.trim()}`);
      }
      flush();
      return [opts.intro?.trim(), ...blocks].filter(Boolean).join("\n\n");
    }
    case "acompanha":
      return joinNatural(items.map((p) => p.t));
    default:
      return items[0].t.trim();
  }
}

/** Divide o texto salvo nas partes que uma opção pode ocupar: linhas, itens separados por vírgula, ou o texto inteiro. */
function parts(kind: ComposeKind, text: string, intro?: string | null): string[] {
  const clean = (s: string) => s.replace(/^\s*[-•*]\s*/, "").trim();
  switch (kind) {
    case "servico_os":
      return text.replace(/\.\s*$/, "").split(/,|\n/).map(clean).filter(Boolean);
    case "acompanha": {
      // "a, b, c e d." → a | b | c | d (só o último "e" separa: "desinsetização e desratização" continua inteiro)
      const xs = text.replace(/\.\s*$/, "").split(/,|\n/).map(clean).filter(Boolean);
      const last = xs.pop() ?? "";
      const i = last.lastIndexOf(" e ");
      return [...xs, ...(xs.length && i > 0 ? [last.slice(0, i), last.slice(i + 3)] : [last])].map(clean).filter(Boolean);
    }
    case "servico": case "aplicacao": case "produto": {
      const introN = norm(intro);
      return text.split("\n").map(clean).filter((l) => l && !/:$/.test(l)
        // a frase que abre a lista de produtos não é um produto (nem quando veio escrita um pouco diferente, de arquivo)
        && !(kind === "produto" && ((introN && (norm(l) === introN || (norm(l).length > 20 && introN.includes(norm(l))))) || /^obs\b.*produtos serao usados/.test(norm(l)))));
    }
    default:
      return [text.trim()];
  }
}

/**
 * Diz quais opções já estão no texto salvo e o que sobrou dele (as sobras ficam marcadas como "texto anterior" para não se perder).
 * Nas listas, a opção só é marcada quando é exatamente uma das partes; nas de escolher uma, quando o texto contém a opção.
 */
export function matchOptions<T extends { text: string }>(kind: ComposeKind, text: string | null | undefined, options: T[], intro?: string | null): { checked: Set<T>; extra: string[] } {
  const t = (text ?? "").trim();
  const checked = new Set<T>();
  if (!t) return { checked, extra: [] };
  const ps = parts(kind, t, intro);
  const pn = new Set(ps.map(norm));
  const single = !["servico", "servico_os", "aplicacao", "produto", "acompanha"].includes(kind);
  for (const o of options) {
    const n = norm(o.text);
    if (n && (single ? ` ${norm(t)} `.includes(` ${n} `) : pn.has(n))) checked.add(o);
  }
  const used = new Set([...checked].map((o) => norm(o.text)));
  return { checked, extra: single ? (checked.size ? [] : [t]) : ps.filter((p) => !used.has(norm(p))) };
}

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
/** "Agendado para 02/12/2026 (quarta-feira) às 09:00." */
export function scheduledText(date: string | null | undefined, time?: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  if (!m) return null;
  const wd = WEEKDAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  return `Agendado para ${m[3]}/${m[2]}/${m[1]} (${wd})${time && /^\d{2}:\d{2}$/.test(time) ? ` às ${time}` : ""}.`;
}

/** Lê os itens marcados de um campo do formulário (valores em JSON). */
export function pickedFrom(values: FormDataEntryValue[]): Picked[] {
  const out: Picked[] = [];
  for (const v of values) {
    if (typeof v !== "string" || !v) continue;
    try {
      const p = JSON.parse(v) as Picked;
      if (p && typeof p.t === "string" && p.t.trim()) out.push({ t: p.t.slice(0, 2000), g: typeof p.g === "string" ? p.g.slice(0, 200) : null, raw: !!p.raw, id: typeof p.id === "string" ? p.id : null });
    } catch { /* valor inválido: ignora */ }
  }
  return out;
}
