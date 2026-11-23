"use server";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { rateLimit } from "@/server/services/health";
import { getDb } from "@/server/db";
import { changePassword, beginMfaSetup, completeMfaSetup, generateRecoveryCodes, login, logout, verifyMfaForSession, LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILS } from "@/server/auth";
import { finishPasswordReset, finishSignup, flowInfo, resendCode, startPasswordReset, startSignup, verifyCode } from "@/server/services/invites";
import { FAILS_COOKIE } from "@/server/session";
import { isDomainError } from "@/server/errors";
import { setupInitial, isSetupDone } from "@/server/services/bootstrap";
import { clearSessionCookie, currentSession, sessionToken, setSessionCookie, setThemeCookie, str } from "@/server/session";
import { getSession } from "@/server/auth";
import { getPrefs } from "@/server/services/access";

/** Origem da requisição (primeiro IP do x-forwarded-for, posto pela Vercel). */
async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "desconhecido";
}
const TOO_MANY = "Muitas tentativas a partir desta conexão. Aguarde alguns minutos.";

const back = (path: string, erro: string) => redirect(`${path}?erro=${encodeURIComponent(erro)}`);

async function afterLogin(r: { token: string; needsMfa: boolean; needsMfaSetup: boolean }) {
  await setSessionCookie(r.token);
  const db = await getDb();
  const s = await getSession(db, r.token);
  if (s) await setThemeCookie((await getPrefs(db, s.user.id)).theme);
  if (r.needsMfa) redirect("/login/mfa");
  if (r.needsMfaSetup) redirect("/login/mfa/setup");
  redirect("/");
}

export async function loginAction(fd: FormData) {
  let r;
  const db = await getDb();
  const jar = await cookies();
  await knownDevice();
  if (!(await rateLimit(db, `login:ip:${await clientIp()}`, 20, 900))) return back("/login", TOO_MANY);
  try {
    r = await login(db, str(fd, "email"), str(fd, "password"));
  } catch (e) {
    // conta as falhas neste aparelho: a partir da 3ª a tela destaca "Esqueceu a senha?"
    const n = isDomainError(e) && e.code === "locked" ? LOGIN_MAX_FAILS : Number(jar.get(FAILS_COOKIE)?.value ?? 0) + 1;
    jar.set(FAILS_COOKIE, String(n), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: LOGIN_LOCK_MINUTES * 60 });
    return back("/login", isDomainError(e) ? e.message : "Não foi possível entrar. Tente novamente.");
  }
  jar.delete(FAILS_COOKIE);
  return afterLogin(r);
}

// ---------- primeiro acesso, cadastro por convite e "esqueci a senha" ----------
const FLOW_COOKIE = "marfim_fluxo";
const KNOWN_COOKIE = "marfim_conhecido";
async function knownDevice() {
  (await cookies()).set(KNOWN_COOKIE, "1", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 400 * 86400 });
}
async function setFlow(flow: string) {
  (await cookies()).set(FLOW_COOKIE, flow, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 3600 });
}
const flowToken = async () => (await cookies()).get(FLOW_COOKIE)?.value;

/** Botão "Entrar" da tela de boas-vindas: daqui em diante o aparelho vai direto para o login. */
export async function enterAction() {
  await knownDevice();
  redirect("/login");
}

const SENT = "Se este e-mail tiver um convite para este perfil, enviamos um código de 6 dígitos. Confira também a caixa de spam.";

export async function signupStartAction(fd: FormData) {
  const choice = str(fd, "perfil");
  const email = str(fd, "email").toLowerCase();
  const db = await getDb();
  await knownDevice();
  if (!(await rateLimit(db, `codigo:ip:${await clientIp()}`, 10, 900)) || !(await rateLimit(db, `codigo:email:${email.slice(0, 190)}`, 5, 3600))) return back(`/cadastro/${choice}`, TOO_MANY);
  try {
    await setFlow(await startSignup(db, choice, email));
  } catch (e) {
    return back(`/cadastro/${choice}`, isDomainError(e) ? e.message : "Não foi possível enviar o código. Tente novamente.");
  }
  redirect("/verificar?ok=" + encodeURIComponent(SENT));
}

export async function resetStartAction(fd: FormData) {
  const email = str(fd, "email").toLowerCase();
  const db = await getDb();
  if (!(await rateLimit(db, `codigo:ip:${await clientIp()}`, 10, 900)) || !(await rateLimit(db, `codigo:email:${email.slice(0, 190)}`, 5, 3600))) return back("/esqueci", TOO_MANY);
  try {
    await setFlow(await startPasswordReset(db, email));
  } catch (e) {
    return back("/esqueci", isDomainError(e) ? e.message : "Não foi possível enviar o código. Tente novamente.");
  }
  redirect("/verificar?ok=" + encodeURIComponent("Se este e-mail tiver uma conta ativa, enviamos um código de 6 dígitos. Confira também a caixa de spam."));
}

export async function verifyCodeAction(fd: FormData) {
  const db = await getDb();
  if (!(await rateLimit(db, `verificar:ip:${await clientIp()}`, 20, 900))) return back("/verificar", TOO_MANY);
  try {
    await verifyCode(db, await flowToken(), str(fd, "code"));
  } catch (e) {
    return back("/verificar", isDomainError(e) ? e.message : "Não foi possível conferir o código.");
  }
  redirect("/definir-senha");
}

export async function resendCodeAction() {
  try {
    await resendCode(await getDb(), await flowToken());
  } catch (e) {
    return back("/verificar", isDomainError(e) ? e.message : "Não foi possível reenviar o código.");
  }
  redirect("/verificar?ok=" + encodeURIComponent("Se houver convite ou conta, um novo código foi enviado."));
}

export async function finishPasswordAction(fd: FormData) {
  const db = await getDb();
  const flow = await flowToken();
  const info = await flowInfo(db, flow);
  if (!info?.verified) redirect("/verificar");
  if (str(fd, "password") !== str(fd, "password2")) return back("/definir-senha", "As senhas não conferem.");
  const jar = await cookies();
  if (info.purpose === "senha") {
    try {
      await finishPasswordReset(db, flow, str(fd, "password"));
    } catch (e) {
      return back("/definir-senha", isDomainError(e) ? e.message : "Não foi possível salvar a senha.");
    }
    jar.delete(FLOW_COOKIE);
    jar.delete(FAILS_COOKIE);
    redirect("/login?ok=" + encodeURIComponent("Senha alterada e acesso desbloqueado. Entre com a nova senha."));
  }
  let r;
  try {
    const email = await finishSignup(db, flow, { fullName: str(fd, "name"), password: str(fd, "password") });
    r = await login(db, email, str(fd, "password"));
  } catch (e) {
    return back("/definir-senha", isDomainError(e) ? e.message : "Não foi possível criar o acesso.");
  }
  jar.delete(FLOW_COOKIE);
  return afterLogin(r);
}

export async function setupAction(fd: FormData) {
  const db = await getDb();
  if (await isSetupDone(db)) redirect("/login");
  if (str(fd, "password") !== str(fd, "password2")) return back("/setup", "As senhas não conferem.");
  let r;
  try {
    await setupInitial(db, { orgName: str(fd, "org"), unitName: str(fd, "unit"), ownerName: str(fd, "name"), email: str(fd, "email"), password: str(fd, "password") });
    r = await login(db, str(fd, "email"), str(fd, "password"));
  } catch (e) {
    return back("/setup", isDomainError(e) ? e.message : "Não foi possível concluir a configuração.");
  }
  return afterLogin(r);
}

export async function mfaVerifyAction(fd: FormData) {
  const token = await sessionToken();
  if (!token) redirect("/login");
  if (!(await rateLimit(await getDb(), `mfa:ip:${await clientIp()}`, 15, 900))) return back("/login/mfa", TOO_MANY);
  try {
    await verifyMfaForSession(await getDb(), token, str(fd, "code"));
  } catch (e) {
    return back("/login/mfa", isDomainError(e) ? e.message : "Erro ao validar o código.");
  }
  redirect("/");
}

export async function mfaSetupStartAction() {
  const s = await currentSession();
  if (!s) redirect("/login");
  await beginMfaSetup(await getDb(), s.user.id);
  redirect("/login/mfa/setup");
}

export async function mfaSetupFinishAction(fd: FormData) {
  const s = await currentSession();
  const token = await sessionToken();
  if (!s || !token) redirect("/login");
  try {
    await completeMfaSetup(await getDb(), token, s.user.id, str(fd, "code"));
  } catch (e) {
    return back("/login/mfa/setup", isDomainError(e) ? e.message : "Erro ao ativar o autenticador.");
  }
  redirect("/conta?ok=" + encodeURIComponent("Autenticador ativado. Gere agora seus códigos de recuperação.") + "#seguranca");
}

export async function logoutAction() {
  const token = await sessionToken();
  if (token) await logout(await getDb(), token);
  await clearSessionCookie();
  redirect("/login");
}

export async function changePasswordAction(fd: FormData) {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (str(fd, "next") !== str(fd, "next2")) return back("/conta", "As senhas novas não conferem.");
  try {
    await changePassword(await getDb(), s.user.id, str(fd, "current"), str(fd, "next"));
  } catch (e) {
    return back("/conta", isDomainError(e) ? e.message : "Não foi possível alterar a senha.");
  }
  await clearSessionCookie();
  redirect("/login?ok=" + encodeURIComponent("Senha alterada. Entre novamente."));
}


/** Gera códigos de recuperação e devolve para exibir uma única vez (useActionState). */
export async function recoveryCodesAction(_prev: { codes?: string[]; erro?: string } | null): Promise<{ codes?: string[]; erro?: string }> {
  const s = await currentSession();
  if (!s) redirect("/login");
  try {
    return { codes: await generateRecoveryCodes(await getDb(), s.user.id) };
  } catch (e) {
    return { erro: isDomainError(e) ? e.message : "Não foi possível gerar os códigos." };
  }
}
