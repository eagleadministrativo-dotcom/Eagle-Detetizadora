export const fmtBRL = (cents: number | null | undefined) =>
  cents == null ? "—" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : `${v.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

/** "1.234,56" | "12,5" | "12.50" | "R$ 10" -> centavos. Retorna null se inválido. */
export function parseBRL(input: string | null | undefined): number | null {
  if (input == null) return null;
  let s = String(input).replace(/[R$\s]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

/** Taxa em pontos-base sobre o valor mais taxa fixa, arredondada ao centavo. */
export const feeCents = (amountCents: number, feeBps: number, fixedCents: number) =>
  Math.round((amountCents * feeBps) / 10000) + fixedCents;

/** Divide o total em n parcelas sem perder centavos (o resto vai para as primeiras). */
export function splitInstallments(totalCents: number, n: number): number[] {
  const base = Math.floor(totalCents / n);
  const rest = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

export const safeDiv = (a: number, b: number): number | null => (b === 0 ? null : a / b);
