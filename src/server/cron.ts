import crypto from "node:crypto";
import { getDb } from "./db";

/**
 * Segredo das rotinas. Em produção ele é gerado e guardado no cofre do Supabase (Vault), e o próprio banco chama
 * as rotinas pelo pg_cron: o valor nunca passa por código, variável ou conversa. CRON_SECRET continua aceito
 * para ambientes sem o cofre.
 */
let cached: { value: string | null; at: number } | null = null;
async function vaultSecret(): Promise<string | null> {
  if (cached && Date.now() - cached.at < 300000) return cached.value;
  let value: string | null = null;
  try {
    const [r] = await (await getDb()).query<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name='marfim_cron' limit 1");
    value = r?.s ?? null;
  } catch { /* sem cofre (desenvolvimento) */ }
  cached = { value, at: Date.now() };
  return value;
}

const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** null = nenhum segredo configurado; false = não autorizado. */
export async function cronAuthorized(req: Request): Promise<boolean | null> {
  const secrets = [process.env.CRON_SECRET, await vaultSecret()].filter((s): s is string => !!s && s.length >= 32);
  if (!secrets.length) return null;
  const got = req.headers.get("authorization") ?? "";
  return secrets.some((s) => same(got, `Bearer ${s}`));
}
