import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { getSession, type SessionInfo } from "./auth";
import { COOKIE, SESSION_COOKIE_OPTIONS } from "./session-cookie";
import { isDomainError } from "./errors";
import type { Permission } from "./permissions";

export { COOKIE };
/** Falhas de senha neste aparelho (só para a tela destacar "Esqueceu a senha?"; o bloqueio real é no servidor). */
export const FAILS_COOKIE = "marfim_falhas";

export async function setSessionCookie(token: string) {
  (await cookies()).set(COOKIE, token, SESSION_COOKIE_OPTIONS);
}
/** Tema em cookie: o servidor já entrega a página no tema certo, sem clarão. */
export const THEME_COOKIE = "marfim_theme";
export async function setThemeCookie(theme: "auto" | "claro" | "escuro") {
  const v = theme === "claro" ? "light" : theme === "escuro" ? "dark" : "auto";
  (await cookies()).set(THEME_COOKIE, v, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 86400 });
}
export async function clearSessionCookie() {
  (await cookies()).delete(COOKIE);
}
export async function sessionToken() {
  return (await cookies()).get(COOKIE)?.value;
}

export async function currentSession(): Promise<SessionInfo | null> {
  const token = await sessionToken(); // lê o cookie primeiro: torna a rota dinâmica antes de tocar no banco
  return getSession(await getDb(), token);
}

export async function requireSession(): Promise<SessionInfo> {
  const s = await currentSession();
  if (!s || !s.mfaVerified) redirect("/login");
  return s;
}

/** Exige ao menos uma das permissões; senão, leva à página de acesso negado. */
export async function requirePerm(...anyOf: Permission[]): Promise<SessionInfo> {
  const s = await requireSession();
  if (anyOf.length && !anyOf.some((p) => s.ctx.perms.has(p))) redirect("/sem-permissao");
  return s;
}

function withParam(path: string, key: string, value: string) {
  const [base, qs = ""] = path.split("?");
  const sp = new URLSearchParams(qs);
  sp.delete("ok");
  sp.delete("erro");
  sp.set(key, value);
  return `${base}?${sp.toString()}`;
}

/** Executa uma ação de formulário e volta para `path` com mensagem de sucesso ou erro (sem expor detalhes internos). */
export async function run(path: string, fn: () => Promise<string | void | { to: string; ok?: string }>): Promise<never> {
  let target: string;
  try {
    const res = await fn();
    if (res && typeof res === "object") target = res.ok ? withParam(res.to, "ok", res.ok) : res.to;
    else target = res ? withParam(path, "ok", res) : path;
  } catch (e) {
    if (isDomainError(e)) target = withParam(path, "erro", e.message);
    else if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    else {
      console.error("[acao]", e);
      target = withParam(path, "erro", "Não foi possível concluir a operação. Tente novamente; se persistir, avise o administrador.");
    }
  }
  redirect(target);
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
export const optStr = (fd: FormData, k: string) => str(fd, k) || null;
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
export const int = (fd: FormData, k: string) => {
  const v = Number.parseInt(str(fd, k), 10);
  return Number.isFinite(v) ? v : NaN;
};
