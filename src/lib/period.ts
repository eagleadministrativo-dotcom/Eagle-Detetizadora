import { addDays, addMonths, dayOfWeek, monthEnd, monthStart, todayYmd, type Period } from "./dates";

const ok = (s?: string): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const PRESETS = [["hoje", "Hoje"], ["semana", "Semana"], ["mes", "Mês"], ["mes-ant", "Mês anterior"]] as const;
export function resolvePeriod(sp: { r?: string; de?: string; ate?: string }): { preset: string; p: Period } {
  const t = todayYmd();
  if (ok(sp.de) && ok(sp.ate) && sp.de <= sp.ate) return { preset: "custom", p: { start: sp.de, end: sp.ate } };
  if (sp.r === "hoje") return { preset: "hoje", p: { start: t, end: t } };
  if (sp.r === "semana") { const s = addDays(t, -((dayOfWeek(t) + 6) % 7)); return { preset: "semana", p: { start: s, end: addDays(s, 6) } }; }
  if (sp.r === "mes-ant") { const m = addMonths(monthStart(t), -1); return { preset: "mes-ant", p: { start: m, end: monthEnd(m) } }; }
  return { preset: "mes", p: { start: monthStart(t), end: monthEnd(t) } };
}
