"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { changePassword, beginMfaSetup, completeMfaSetup, login, logout, verifyMfaForSession } from "@/server/auth";
import { isDomainError } from "@/server/errors";
import { setupInitial, isSetupDone } from "@/server/services/bootstrap";
import { clearSessionCookie, currentSession, sessionToken, setSessionCookie, str } from "@/server/session";

const back = (path: string, erro: string) => redirect(`${path}?erro=${encodeURIComponent(erro)}`);

async function afterLogin(r: { token: string; needsMfa: boolean; needsMfaSetup: boolean }) {
  await setSessionCookie(r.token);
  if (r.needsMfa) redirect("/login/mfa");
  if (r.needsMfaSetup) redirect("/login/mfa/setup");
  redirect("/");
}

export async function loginAction(fd: FormData) {
  let r;
  try {
    r = await login(await getDb(), str(fd, "email"), str(fd, "password"));
  } catch (e) {
    return back("/login", isDomainError(e) ? e.message : "Não foi possível entrar. Tente novamente.");
  }
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
  redirect("/conta?ok=" + encodeURIComponent("Autenticador ativado."));
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

