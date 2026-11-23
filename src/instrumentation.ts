/**
 * Registro de erros do servidor (sem serviço externo): cada erro de página, ação ou rota vai para error_events
 * e aparece em Sistema → Saúde do sistema. Não grava corpo de requisição, cookies nem dados de clientes.
 */
export async function register() {}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind?: string; routePath?: string; routeType?: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const e = err as Error & { digest?: string };
    // redirecionamentos e "não encontrado" do Next não são erros
    if (typeof e?.digest === "string" && /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK)/.test(e.digest)) return;
    const { getDb } = await import("./server/db");
    const { logError } = await import("./server/services/health");
    await logError(await getDb(), { message: e?.message ?? String(err), stack: e?.stack, path: request.path, method: request.method, digest: e?.digest, kind: context.routeType ?? "request" });
  } catch { /* registrar erro nunca pode derrubar a resposta */ }
}
