const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/** "2026-10-06" -> "06/10/26 - Terça-feira", como no modelo da OS. */
export function docDateWithWeekday(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  const wd = WEEKDAYS[new Date(`${ymd}T12:00:00Z`).getUTCDay()];
  return `${d}/${m}/${y.slice(2)} - ${wd}`;
}

/** "2026-09-17" -> "17 de Setembro de 2026", como no fecho do orçamento. */
export function docLongDate(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  return `${Number(d)} de ${MONTHS[Number(m) - 1]} de ${y}`;
}

export const docMoney = (cents: number | null | undefined) =>
  cents == null ? "" : `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function docPhone(digits: string | null | undefined): string {
  const d = (digits ?? "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits ?? "";
}

/** Nome de arquivo seguro: "OS 12 - Cei Centopeia.docx". */
export function docFileName(prefix: string, number: number, customer: string, ext: string) {
  const clean = customer.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w\s.-]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  return `${prefix} ${number} - ${clean || "cliente"}.${ext}`;
}
