/** Linhas automáticas da importação que não interessam a quem atende. */
const NOISE = /^(Cliente vindo da planilha de vendas.*|Outros telefones:.*)$/i;

/** Observações do cliente que valem mostrar em destaque (ficha, agenda): sem as linhas automáticas da importação. */
export function customerObs(notes: string | null | undefined): string {
  return (notes ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !NOISE.test(l)).join("\n");
}

/** Versão curta para o card da agenda. */
export function customerObsShort(notes: string | null | undefined, max = 60): string {
  const s = customerObs(notes).replace(/^Obs\.:\s*/gim, "").replace(/\n+/g, "; ");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
