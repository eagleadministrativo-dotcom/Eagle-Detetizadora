import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { createDb, type Db } from "./db";
import { setupInitial } from "./services/bootstrap";
import { login, getSession } from "./auth";
import { buildPerms } from "./permissions";
import { saveStaff } from "./services/catalog";
import { createInvite, finishPasswordReset, finishSignup, flowInfo, listInvites, resendCode, revokeInvite, startPasswordReset, startSignup, verifyCode } from "./services/invites";

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "marfim-mail-"));
process.env.MAIL_OUTBOX_DIR = OUT;
let db: Db, ownerId: string, unitId: string;
const owner = () => ({ userId: ownerId, unitId, role: "administrador" as const, staffId: null, perms: buildPerms("administrador", []) });
const msg = async (p: Promise<unknown>) => p.then(() => "OK", (e) => (e as Error).message);
/** Último código enviado para o e-mail (lido da caixa de saída de teste). */
const lastCode = (email: string) => {
  const f = fs.readdirSync(OUT).filter((x) => x.endsWith(`-${email}.txt`)).sort().pop();
  return f ? /\b(\d{6})\b/.exec(fs.readFileSync(path.join(OUT, f), "utf8").split("\n").find((l) => l.startsWith("Assunto"))!)?.[1] ?? null : null;
};
const mails = (email: string) => fs.readdirSync(OUT).filter((x) => x.endsWith(`-${email}.txt`)).length;

beforeAll(async () => {
  db = await createDb({ dataDir: "memory://" });
  const r = await setupInitial(db, { orgName: "T", unitName: "U", ownerName: "Dono", email: "dono@conv.com", password: "SenhaForte123" });
  ownerId = r.ownerId; unitId = r.unitId;
});

describe("cadastro por convite", () => {
  it("só o e-mail convidado, no perfil certo, recebe código; a pessoa cria a própria senha e entra", async () => {
    const staffId = await saveStaff(db, owner(), { name: "Barbeiro Novo" });
    const inv = await createInvite(db, owner(), { email: "Novo@Conv.com", fullName: "Barbeiro Novo", role: "tecnico", staffId });
    expect(inv.sent).toBe(true);
    expect(mails("novo@conv.com")).toBe(1); // e-mail do convite

    // e-mail sem convite e perfil errado: mesma resposta, nenhum e-mail sai, código nunca confere
    const f0 = await startSignup(db, "tecnico", "estranho@conv.com");
    expect(mails("estranho@conv.com")).toBe(0);
    expect(await msg(verifyCode(db, f0, "123456"))).toMatch(/incorreto/);
    await startSignup(db, "dono", "novo@conv.com");
    expect(mails("novo@conv.com")).toBe(1);

    const flow = await startSignup(db, "tecnico", "novo@conv.com");
    const code = lastCode("novo@conv.com")!;
    expect(code).toMatch(/^\d{6}$/);
    const info = await flowInfo(db, flow);
    expect(info).toMatchObject({ purpose: "cadastro", verified: false, fullName: "Barbeiro Novo", role: "tecnico" });
    expect(info!.email).not.toContain("novo@"); // mascarado na tela
    expect(await msg(finishSignup(db, flow, { fullName: "B", password: "SenhaForte123" }))).toMatch(/Confirme o código/);
    expect(await msg(verifyCode(db, flow, code === "000000" ? "111111" : "000000"))).toMatch(/Restam 4/);
    await verifyCode(db, flow, code.slice(0, 3) + " " + code.slice(3));
    expect(await msg(finishSignup(db, flow, { fullName: "Barbeiro Novo", password: "curta" }))).toMatch(/10 caracteres/);
    const email = await finishSignup(db, flow, { fullName: "Barbeiro Novo", password: "MinhaSenha2026" });
    expect(email).toBe("novo@conv.com");

    const l = await login(db, "novo@conv.com", "MinhaSenha2026");
    const s = await getSession(db, l.token);
    expect(s?.ctx.role).toBe("tecnico");
    expect(s?.ctx.staffId).toBe(staffId);
    // o fluxo não pode ser reutilizado e o convite fica marcado como aceito
    expect(await msg(finishSignup(db, flow, { fullName: "X", password: "OutraSenha2026" }))).toMatch(/Confirme o código/);
    expect((await listInvites(db, owner())).find((i) => i.email === "novo@conv.com")?.accepted_at).toBeTruthy();
    const [n] = await db.query<{ n: number }>("select count(*)::bigint as n from notifications where kind='acesso_convite_aceito' and user_id=$1", [ownerId]);
    expect(n.n).toBe(1);
    // não dá para convidar de novo quem já tem acesso
    expect(await msg(createInvite(db, owner(), { email: "novo@conv.com", fullName: "X", role: "tecnico" }))).toMatch(/Já existe/);
  });

  it("Administrador aceita gerente e contador; convite cancelado deixa de valer; 5 erros invalidam o código", async () => {
    await createInvite(db, owner(), { email: "ger@conv.com", fullName: "Gerente", role: "gerente" });
    const flow = await startSignup(db, "admin", "ger@conv.com");
    expect(lastCode("ger@conv.com")).toMatch(/^\d{6}$/);
    for (let i = 0; i < 4; i++) await msg(verifyCode(db, flow, "000001"));
    expect(await msg(verifyCode(db, flow, "000001"))).toMatch(/muitas vezes/);
    expect(await msg(verifyCode(db, flow, lastCode("ger@conv.com")!))).toMatch(/muitas vezes|Peça/);

    const c = await createInvite(db, owner(), { email: "cont@conv.com", fullName: "gerente", role: "gerente" });
    const f2 = await startSignup(db, "admin", "cont@conv.com");
    await revokeInvite(db, owner(), c.id);
    expect(await msg(verifyCode(db, f2, lastCode("cont@conv.com")!))).toMatch(/expirou/);
  });

  it("só o proprietário convida outro dono", async () => {
    const ger = { userId: ownerId, unitId, role: "gerente" as const, staffId: null, perms: buildPerms("gerente", [{ permission: "users.manage", granted: true }]) };
    expect(await msg(createInvite(db, ger, { email: "socio@conv.com", fullName: "Sócio", role: "administrador" }))).toMatch(/mais acesso/);
    await createInvite(db, owner(), { email: "socio@conv.com", fullName: "Sócio", role: "administrador" });
    const f = await startSignup(db, "dono", "socio@conv.com");
    await verifyCode(db, f, lastCode("socio@conv.com")!);
    await finishSignup(db, f, { fullName: "Sócio", password: "SenhaDoSocio1" });
    const s = await getSession(db, (await login(db, "socio@conv.com", "SenhaDoSocio1")).token);
    expect(s?.ctx.role).toBe("administrador");
  });
});

describe("esqueci a senha", () => {
  it("3 senhas erradas bloqueiam; o código do e-mail troca a senha e desbloqueia", async () => {
    for (let i = 0; i < 3; i++) await msg(login(db, "dono@conv.com", "errada" + i));
    expect(await msg(login(db, "dono@conv.com", "SenhaForte123"))).toMatch(/bloqueado/);
    const before = await login(db, "socio@conv.com", "SenhaDoSocio1"); // outra conta segue normal
    expect(before.token).toBeTruthy();

    const fx = await startPasswordReset(db, "ninguem@conv.com");
    expect(mails("ninguem@conv.com")).toBe(0);
    expect(await msg(verifyCode(db, fx, "123456"))).toMatch(/incorreto/);

    const flow = await startPasswordReset(db, "DONO@conv.com");
    expect(await msg(resendCode(db, flow))).toMatch(/Aguarde/); // reenvio só depois de alguns segundos
    await verifyCode(db, flow, lastCode("dono@conv.com")!);
    await finishPasswordReset(db, flow, "SenhaNova2026x");
    expect(await msg(login(db, "dono@conv.com", "SenhaForte123"))).toMatch(/incorretos/);
    expect((await login(db, "dono@conv.com", "SenhaNova2026x")).token).toBeTruthy();
    const [a] = await db.query<{ n: number }>("select count(*)::bigint as n from audit_logs where action='SENHA_REDEFINIDA_EMAIL' and user_id=$1", [ownerId]);
    expect(a.n).toBe(1);
  });
});

describe("senha provisória + link por e-mail", () => {
  const lastLink = (email: string) => {
    const f = fs.readdirSync(OUT).filter((x) => x.endsWith(`-${email}.txt`)).sort().pop()!;
    return /\/acesso\/([A-Za-z0-9_-]+)/.exec(fs.readFileSync(path.join(OUT, f), "utf8"))![1];
  };
  it("convidado entra com a provisória, recebe link, cria senha e só então entra", async () => {
    const { setTempPassword, sendAccessLink, openAccessLink } = await import("./services/invites");
    await setTempPassword(db, owner(), "Provisoria2026");
    await createInvite(db, owner(), { email: "prov@conv.com", fullName: "Provisório", role: "tecnico" });
    expect(await msg(login(db, "prov@conv.com", "errada123x"))).toMatch(/incorretos/);
    const r = await login(db, "prov@conv.com", "Provisoria2026");
    expect(r.token).toBe(""); // nenhuma sessão com a senha provisória
    expect(r.emailLink).toMatchObject({ purpose: "cadastro" });
    await sendAccessLink(db, r.emailLink!);
    const token = lastLink("prov@conv.com");
    expect(await openAccessLink(db, "x".repeat(40))).toBeNull();
    const flow = (await openAccessLink(db, token))!;
    expect((await flowInfo(db, flow))?.verified).toBe(true);
    expect(await msg(finishSignup(db, flow, { fullName: "Provisório", password: "Provisoria2026" }))).toMatch(/diferente da senha provisória/);
    await finishSignup(db, flow, { fullName: "Provisório", password: "MinhaPropria2026" });
    expect(await openAccessLink(db, token)).toBeNull(); // uso único
    expect(await msg(login(db, "prov@conv.com", "Provisoria2026"))).toMatch(/incorretos/);
    expect((await login(db, "prov@conv.com", "MinhaPropria2026")).token).toBeTruthy();
  });
  it("usuário com troca obrigatória não recebe sessão até criar a senha pelo link", async () => {
    const { sendAccessLink, openAccessLink } = await import("./services/invites");
    await db.query("update users set must_change_password=true, password_hash=(select temp_password_hash from unit_settings limit 1) where lower(email)='socio@conv.com'");
    const r = await login(db, "socio@conv.com", "Provisoria2026");
    expect(r.token).toBe("");
    expect(r.emailLink).toMatchObject({ purpose: "senha" });
    await sendAccessLink(db, r.emailLink!);
    const flow = (await openAccessLink(db, lastLink("socio@conv.com")))!;
    await finishPasswordReset(db, flow, "SocioNovo2026");
    const l = await login(db, "socio@conv.com", "SocioNovo2026");
    expect(l.token).toBeTruthy();
    expect(l.emailLink).toBeUndefined();
  });
});
