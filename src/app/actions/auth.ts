"use server";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { rateLimit } from "@/server/services/health";
import { getDb } from "@/server/db";
import { changePassword, login, logout, LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILS, type LoginResult } from "@/server/auth";
import { finishLoginCheck, finishPasswordReset, finishSignup, flowInfo, maskEmail, resendCode, sendAccessLink, setTempPassword, startLoginCheck, startPasswordReset, startSignup, verifyCode } from "@/server/services/invites";
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

async function afterLogin(token: string) {
  await setSessionCookie(token);
  const db = await getDb();
  const s = await getSession(db, token);
  if (s) await setThemeCookie((await getPrefs(db, s.user.id)).theme);
  redirect("/");
}

/** Primeiro acesso: manda o código ao e-mail e leva à tela do código. */
async function startEmailCheck(from: string, check: NonNullable<LoginResult["emailCheck"]>) {
  const db = await getDb();
  if (!(await rateLimit(db, `codigo:email:${check.email.slice(0, 190)}`, 5, 3600))) return back(from, TOO_MANY);
  try {
    await setFlow(await startLoginCheck(db, check));
  } catch (e) {
    return back(from, isDomainError(e) ? e.message : "Não foi possível enviar o código. Tente novamente.");
  }
  redirect("/verificar?ok=" + encodeURIComponent(`Primeiro acesso: enviamos um código de 6 dígitos para ${maskEmail(check.email)}. Confira também a caixa de spam.`));
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
  if (r.emailLink) {
    // senha provisória: nenhuma sessão é criada; o link do e-mail leva à criação da senha
    if (!(await rateLimit(db, `link:email:${r.emailLink.email.slice(0, 190)}`, 5, 3600))) return back("/login", TOO_MANY);
    try {
      await sendAccessLink(db, r.emailLink);
    } catch (e) {
      return back("/login", isDomainError(e) ? e.message : "Não foi possível enviar o e-mail. Tente novamente.");
    }
    redirect("/login?ok=" + encodeURIComponent(`Primeiro acesso: enviamos um link para ${maskEmail(r.emailLink.email)}. Abra o e-mail, crie sua senha nova e depois volte aqui para entrar com ela.`));
  }
  if (r.emailCheck) return startEmailCheck("/login", r.emailCheck);
  return afterLogin(r.token);
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
  const flow = await flowToken();
  let token: string | null = null;
  try {
    const purpose = await verifyCode(db, flow, str(fd, "code"));
    if (purpose === "login") token = await finishLoginCheck(db, flow);
  } catch (e) {
    return back("/verificar", isDomainError(e) ? e.message : "Não foi possível conferir o código.");
  }
  if (token) {
    const jar = await cookies();
    jar.delete(FLOW_COOKIE);
    jar.delete(FAILS_COOKIE);
    await knownDevice();
    return afterLogin(token);
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
  try {
    await finishSignup(db, flow, { fullName: str(fd, "name"), password: str(fd, "password") });
  } catch (e) {
    return back("/definir-senha", isDomainError(e) ? e.message : "Não foi possível criar o acesso.");
  }
  jar.delete(FLOW_COOKIE);
  jar.delete(FAILS_COOKIE);
  await knownDevice();
  redirect("/login?ok=" + encodeURIComponent("Senha criada. Agora entre com o seu e-mail e a senha nova."));
}

/** Configurações → senha provisória dos convidados. */
export async function tempPasswordAction(fd: FormData) {
  const s = await currentSession();
  if (!s?.mfaVerified) redirect("/login");
  if (str(fd, "password") !== str(fd, "password2")) return back("/admin/usuarios", "As senhas provisórias não conferem.");
  try {
    await setTempPassword(await getDb(), s.ctx, str(fd, "password"));
  } catch (e) {
    return back("/admin/usuarios", isDomainError(e) ? e.message : "Não foi possível salvar.");
  }
  redirect("/admin/usuarios?ok=" + encodeURIComponent("Senha provisória salva. Ela vale para os convites em aberto e os próximos."));
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
  if (r.emailCheck) return startEmailCheck("/login", r.emailCheck);
  return afterLogin(r.token);
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
