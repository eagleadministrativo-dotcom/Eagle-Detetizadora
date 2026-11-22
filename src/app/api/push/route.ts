import { getDb } from "@/server/db";
import { currentSession } from "@/server/session";
import { isDomainError } from "@/server/errors";
import { countSubscriptions, pushConfigured, removeSubscription, saveSubscription, validateSubscription, vapidPublicKey } from "@/server/services/push";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** Rejeita pedidos que não partem do próprio site (proteção contra CSRF). */
function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return !origin || origin === new URL(req.url).origin;
}

/** Estado das notificações para o usuário logado + chave pública (VAPID). */
export async function GET() {
  const s = await currentSession();
  if (!s || !s.mfaVerified) return json({ error: "Não autenticado" }, 401);
  return json({ enabled: pushConfigured(), publicKey: vapidPublicKey(), devices: await countSubscriptions(await getDb(), s.user.id) });
}

/** Registra este aparelho. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Origem inválida" }, 403);
  const s = await currentSession();
  if (!s || !s.mfaVerified) return json({ error: "Não autenticado" }, 401);
  if (!pushConfigured()) return json({ error: "Notificações ainda não estão configuradas no servidor." }, 503);
  try {
    const sub = validateSubscription(await req.json());
    await saveSubscription(await getDb(), s.user.id, sub, req.headers.get("user-agent"));
    return json({ ok: true });
  } catch (e) {
    if (isDomainError(e)) return json({ error: e.message }, 400);
    console.error("[push] salvar", e);
    return json({ error: "Erro ao ativar as notificações." }, 500);
  }
}

/** Remove este aparelho. */
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Origem inválida" }, 403);
  const s = await currentSession();
  if (!s || !s.mfaVerified) return json({ error: "Não autenticado" }, 401);
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string") return json({ error: "Pedido inválido" }, 400);
  await removeSubscription(await getDb(), s.user.id, body.endpoint);
  return json({ ok: true });
}
