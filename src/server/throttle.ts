/** Memória do servidor (por instância): evita repetir rotinas a cada página aberta. */
const mem = ((globalThis as unknown as { __eagleThrottle?: Map<string, number> }).__eagleThrottle ??= new Map());

/** true no máximo uma vez a cada `ms` para a mesma chave (e já marca como feito). */
export function every(key: string, ms: number): boolean {
  const now = Date.now();
  if (now - (mem.get(key) ?? 0) < ms) return false;
  mem.set(key, now);
  return true;
}

/** Já rodou com sucesso hoje nesta instância? */
export const doneToday = (key: string) => mem.has(`day:${key}`);
export const markDoneToday = (key: string) => { mem.set(`day:${key}`, Date.now()); };
