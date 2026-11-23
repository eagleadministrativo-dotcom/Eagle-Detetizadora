import crypto from "node:crypto";
import { getDb } from "./db";

/**
 * Segredo das rotinas. Em produção ele é gerado e guardado no cofre do Supabase (Vault), e o próprio banco chama
 * as rotinas pelo pg_cron: o valor nunca passa por código, variável ou conversa. Havendo cofre, CRON_SECRET é
 * ignorado (o valor antigo ficou exposto); ele só vale em ambientes sem o cofre.
 */
let cached: { value: string | null; at: number } | null = null;
async function vaultSecret(fresh = false): Promise<string | null> {
  if (!fresh && cached && Date.now() - cached.at < 300000) return cached.value;
  let value: string | null = null;
  try {
    const [r] = await (await getDb()).query<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name='marfim_cron' limit 1");
    value = r?.s ?? null;
  } catch { /* sem cofre (desenvolvimento) */ }
  if (value) cached = { value, at: Date.now() }; // falha de leitura não fica guardada
  return value;
}

const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** null = nenhum segredo configurado; false = não autorizado. */
export async function cronAuthorized(req: Request): Promise<boolean | null> {
  const vault = await vaultSecret();
  const secrets = (vault ? [vault] : [process.env.CRON_SECRET]).filter((s): s is string => !!s && s.length >= 32);
  if (!secrets.length) return null;
  const got = req.headers.get("authorization") ?? "";
  if (secrets.some((s) => same(got, `Bearer ${s}`))) return true;
  // o segredo é trocado automaticamente todo mês: se não bateu com o valor em memória, relê o cofre uma vez
  if (!vault) return false;
  const now = await vaultSecret(true);
  return !!now && now !== vault && same(got, `Bearer ${now}`);
}
