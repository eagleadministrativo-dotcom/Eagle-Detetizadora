// Brasil não tem horário de verão desde 2019: America/Sao_Paulo = UTC-3 fixo.
export const TZ = "America/Sao_Paulo";
const OFFSET_MS = 3 * 3600 * 1000;

/** "2026-11-23" -> instante UTC do início desse dia em São Paulo. */
export const dayStartUtc = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) + OFFSET_MS);
/** Fim exclusivo (início do dia seguinte). */
export const dayEndUtc = (ymd: string) => new Date(dayStartUtc(ymd).getTime() + 86400000);

export function toYmd(d: Date): string {
  return new Date(d.getTime() - OFFSET_MS).toISOString().slice(0, 10);
}
export const todayYmd = (now = new Date()) => toYmd(now);

export function addDays(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
export function addMonths(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
export const monthStart = (ymd: string) => `${ymd.slice(0, 7)}-01`;
export const monthEnd = (ymd: string) => addDays(addMonths(monthStart(ymd), 1), -1);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
export const dayOfWeek = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`)).getUTCDay();

export const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
export const fmtTime = (d: Date | string) =>
  new Date(d).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
export const fmtDateTime = (d: Date | string) => `${fmtDate(d)} ${fmtTime(d)}`;
export const fmtYmd = (ymd: string) => ymd.split("-").reverse().join("/");

/** "09:30" no dia ymd (SP) -> Date UTC. */
export const atLocal = (ymd: string, hhmm: string) =>
  new Date(dayStartUtc(ymd).getTime() + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))) * 60000);

export interface Period {
  start: string; // inclusivo
  end: string; // inclusivo
}
export const periodRange = (p: Period) => ({ from: dayStartUtc(p.start), to: dayEndUtc(p.end) });
export function previousPeriod(p: Period): Period {
  const len = daysBetween(p.start, p.end) + 1;
  return { start: addDays(p.start, -len), end: addDays(p.start, -1) };
}
