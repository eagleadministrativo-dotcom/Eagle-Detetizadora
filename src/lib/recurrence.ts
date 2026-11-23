import { addDays, addMonths, dayOfWeek, monthEnd, monthStart } from "./dates";

/** Regra de recorrência, usada por tarefas, agendamentos em série e retornos. Datas sempre "AAAA-MM-DD" no fuso da operação. */
export type Rule =
  | { kind: "dias"; n: number }
  | { kind: "semanas"; n: number }
  | { kind: "mensal"; n: number }
  | { kind: "dia_semana"; dow: number; n: number }
  | { kind: "ordinal"; ordinal: 1 | 2 | 3 | 4 | -1; dow: number; n: number };

export const DOW_LABEL = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const ORD: Record<string, [string, string]> = { "1": ["primeiro", "primeira"], "2": ["segundo", "segunda"], "3": ["terceiro", "terceira"], "4": ["quarto", "quarta"], "-1": ["último", "última"] };
const isMasc = (dow: number) => dow === 0 || dow === 6;

export function parseRule(v: unknown): Rule | null {
  const r = v as Partial<Rule> & { n?: number; dow?: number; ordinal?: number } | null;
  if (!r || typeof r !== "object") return null;
  const n = r.n ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > 365) return null;
  const dowOk = Number.isInteger(r.dow) && r.dow! >= 0 && r.dow! <= 6;
  if (r.kind === "dias" || r.kind === "semanas" || r.kind === "mensal") return { kind: r.kind, n };
  if (r.kind === "dia_semana" && dowOk) return { kind: "dia_semana", dow: r.dow!, n };
  if (r.kind === "ordinal" && dowOk && [1, 2, 3, 4, -1].includes(r.ordinal as number)) return { kind: "ordinal", ordinal: r.ordinal as 1 | 2 | 3 | 4 | -1, dow: r.dow!, n };
  return null;
}

/** Converte os campos do formulário (frequencia, n, dow, ordinal) em regra. null = sem recorrência. */
export function ruleFromForm(get: (k: string) => string): Rule | null {
  const f = get("freq");
  const n = Number.parseInt(get("freqN") || "1", 10);
  const dow = Number.parseInt(get("freqDow") || "-1", 10);
  if (f === "diario") return { kind: "dias", n: 1 };
  if (f === "semanal") return { kind: "semanas", n: 1 };
  if (f === "quinzenal") return { kind: "dias", n: 15 };
  if (f === "mensal") return { kind: "mensal", n: 1 };
  if (f === "dias") return parseRule({ kind: "dias", n });
  if (f === "semanas") return parseRule({ kind: "semanas", n });
  if (f === "dia_semana") return parseRule({ kind: "dia_semana", dow, n: 1 });
  if (f === "ordinal") return parseRule({ kind: "ordinal", ordinal: Number.parseInt(get("freqOrd") || "1", 10), dow, n: 1 });
  return null;
}

export function ruleLabel(r: Rule): string {
  switch (r.kind) {
    case "dias": return r.n === 1 ? "Diária" : r.n === 15 ? "Quinzenal (15 dias)" : `A cada ${r.n} dias`;
    case "semanas": return r.n === 1 ? "Semanal" : `A cada ${r.n} semanas`;
    case "mensal": return r.n === 1 ? "Mensal" : `A cada ${r.n} meses`;
    case "dia_semana": return `${isMasc(r.dow) ? "Todo" : "Toda"} ${DOW_LABEL[r.dow]}`;
    case "ordinal": { const w = ORD[String(r.ordinal)][isMasc(r.dow) ? 0 : 1]; return `${w[0].toUpperCase()}${w.slice(1)} ${DOW_LABEL[r.dow]} do mês`; }
  }
}

export function ordinalInMonth(ymd: string, ordinal: number, dow: number): string {
  if (ordinal === -1) {
    const last = monthEnd(ymd);
    return addDays(last, -((dayOfWeek(last) - dow + 7) % 7));
  }
  const first = monthStart(ymd);
  return addDays(first, ((dow - dayOfWeek(first) + 7) % 7) + (ordinal - 1) * 7);
}

/** Próxima data estritamente depois de `from`. */
export function nextAfter(r: Rule, from: string): string {
  switch (r.kind) {
    case "dias": return addDays(from, r.n);
    case "semanas": return addDays(from, 7 * r.n);
    case "mensal": return addMonths(from, r.n);
    case "dia_semana": return addDays(from, ((r.dow - dayOfWeek(from) + 6) % 7) + 1 + (r.n - 1) * 7);
    case "ordinal": {
      const same = ordinalInMonth(from, r.ordinal, r.dow);
      return same > from ? same : ordinalInMonth(addMonths(monthStart(from), r.n), r.ordinal, r.dow);
    }
  }
}

/** Retorno após uma visita real: evita sugerir o dia seguinte quando a regra é por dia fixo da semana/mês. */
export function nextReturn(r: Rule, lastVisit: string): string {
  const gap = r.kind === "dia_semana" ? 3 : r.kind === "ordinal" ? 14 : 0;
  return gap ? nextAfter(r, addDays(lastVisit, gap - 1)) : nextAfter(r, lastVisit);
}

/** Datas da série a partir de `start` (inclusive quando a regra permite), até `until`, no máximo `max`. */
export function occurrences(r: Rule, start: string, until: string, max = 400): string[] {
  const out: string[] = [];
  let d = r.kind === "dia_semana" || r.kind === "ordinal" ? nextAfter({ ...r, n: 1 }, addDays(start, -1)) : start;
  for (let i = 1; d <= until && out.length < max; i++) {
    out.push(d);
    d = r.kind === "mensal" ? addMonths(start, r.n * i) : nextAfter(r, d); // mensal: sempre a partir do início, sem perder o dia 31
  }
  return out;
}
