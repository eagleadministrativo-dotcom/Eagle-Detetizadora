import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { createDb, type Db } from "./db";
import { setupInitial, createUser, updateUser, listUsers } from "./services/bootstrap";
import { login, getSession, hashPassword, verifyPassword, changePassword, logout } from "./auth";
import { buildPerms, ROLE_PERMISSIONS } from "./permissions";
import { finishLoginCheck, startLoginCheck, verifyCode } from "./services/invites";

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "eagle-mail-"));
process.env.MAIL_OUTBOX_DIR = OUT;
const lastCode = (email: string) => {
  const f = fs.readdirSync(OUT).filter((x) => x.endsWith(`-${email}.txt`)).sort().pop();
  return f ? /\b(\d{6})\b/.exec(fs.readFileSync(path.join(OUT, f), "utf8").split("\n").find((l) => l.startsWith("Assunto"))!)?.[1] ?? null : null;
};

let db: Db;
let ownerId: string;
let unitId: string;
const msg = async (p: Promise<unknown>) => p.then(() => "OK", (e) => (e as Error).message);

beforeAll(async () => {
  db = await createDb({ dataDir: "memory://" });
  const r = await setupInitial(db, { orgName: "T", unitName: "U", ownerName: "Dono", email: "dono@t.com", password: "SenhaForte123" });
  ownerId = r.ownerId;
  unitId = r.unitId;
});

describe("senha", () => {
  it("hash não é reversível e verifica; senha fraca é recusada", async () => {
    const h = hashPassword("abc12345678");
    expect(h).not.toContain("abc12345678");
    expect(verifyPassword("abc12345678", h)).toBe(true);
    expect(verifyPassword("outra", h)).toBe(false);
    const owner = { userId: ownerId, unitId, role: "administrador" as const, perms: buildPerms("administrador", []) };
    expect(await msg(createUser(db, owner, { email: "x@t.com", fullName: "X", role: "tecnico", password: "curta" }))).toMatch(/10 caracteres/);
    expect(await msg(createUser(db, owner, { email: "x@t.com", fullName: "X", role: "tecnico", password: "somenteletras" }))).toMatch(/letras e números/);
  });
});

describe("login, bloqueio, primeiro acesso e sessão", () => {
  it("credenciais erradas devolvem mensagem genérica e bloqueiam por 10 minutos na 3ª tentativa", async () => {
    for (let i = 0; i < 2; i++) expect(await msg(login(db, "naoexiste@t.com", "qualquer"))).toBe("E-mail ou senha incorretos.");
    expect(await msg(login(db, "naoexiste@t.com", "qualquer"))).toMatch(/bloqueadas por 10 minutos/); // igual a uma conta real
    for (let i = 0; i < 2; i++) expect(await msg(login(db, "dono@t.com", "errada" + i))).toBe("E-mail ou senha incorretos.");
    expect(await msg(login(db, "dono@t.com", "errada3"))).toMatch(/3 vezes.*10 minutos.*redefinir a senha pelo e-mail/);
    expect(await msg(login(db, "dono@t.com", "SenhaForte123"))).toMatch(/bloqueado.*10 minutos/);
    expect(await msg(login(db, "naoexiste@t.com", "qualquer"))).toMatch(/bloqueado.*minutos/);
    const [lk] = await db.query<{ m: number }>("select (extract(epoch from locked_until - now())/60)::float as m from users where id=$1", [ownerId]);
    expect(lk.m).toBeGreaterThan(9);
    expect(lk.m).toBeLessThanOrEqual(10);
    const [n] = await db.query<{ n: number }>("select count(*)::bigint as n from notifications where kind='login_bloqueado'");
    expect(n.n).toBe(1);
    await db.query("update users set locked_until=null, failed_attempts=0 where id=$1", [ownerId]);
  });

  it("primeiro acesso confirma o e-mail por código uma única vez; depois a senha basta e o login fica lembrado", async () => {
    const first = await login(db, "dono@t.com", "SenhaForte123");
    expect(first.token).toBe(""); // sem sessão antes de confirmar o e-mail
    expect(first.emailCheck).toMatchObject({ email: "dono@t.com", userId: ownerId });

    const flow = await startLoginCheck(db, first.emailCheck!);
    const code = lastCode("dono@t.com")!;
    expect(code).toMatch(/^\d{6}$/);
    expect(await msg(finishLoginCheck(db, flow))).toMatch(/Confirme o código/);
    expect(await msg(verifyCode(db, flow, code === "000000" ? "111111" : "000000"))).toMatch(/incorreto/);
    expect(await verifyCode(db, flow, code)).toBe("login");
    const token = await finishLoginCheck(db, flow);
    expect((await getSession(db, token))?.ctx.role).toBe("administrador");
    expect(await msg(finishLoginCheck(db, flow))).toMatch(/Confirme o código|expirou/); // o código não abre outra sessão

    const again = await login(db, "dono@t.com", "SenhaForte123");
    expect(again.emailCheck).toBeUndefined();
    expect((await getSession(db, again.token))?.mfaVerified).toBe(true);
    const [s] = await db.query<{ days: number }>("select (extract(epoch from expires_at - now())/86400)::float as days from sessions where user_id=$1 order by expires_at desc limit 1", [ownerId]);
    expect(s.days).toBeGreaterThan(399);

    // sessão antiga em uso é renovada
    await db.query("update sessions set expires_at = now() + interval '10 days'");
    await getSession(db, again.token);
    const [r] = await db.query<{ days: number }>("select max(extract(epoch from expires_at - now())/86400)::float as days from sessions where user_id=$1", [ownerId]);
    expect(r.days).toBeGreaterThan(399);

    await logout(db, again.token);
    expect(await getSession(db, again.token)).toBeNull();
    expect(await getSession(db, undefined)).toBeNull();
    expect(await getSession(db, "token-inventado")).toBeNull();
  });

  it("trocar a senha encerra todas as sessões; usuário desativado perde o acesso", async () => {
    const owner = { userId: ownerId, unitId, role: "administrador" as const, perms: buildPerms("administrador", []) };
    const uid = await createUser(db, owner, { email: "b@t.com", fullName: "B", role: "tecnico", password: "SenhaForte123" });
    await db.query("update users set email_verified_at=now() where id=$1", [uid]);
    const l = await login(db, "b@t.com", "SenhaForte123");
    expect((await getSession(db, l.token))?.ctx.role).toBe("tecnico");
    await changePassword(db, uid, "SenhaForte123", "NovaSenha4567");
    expect(await getSession(db, l.token)).toBeNull();
    const l2 = await login(db, "b@t.com", "NovaSenha4567");
    await updateUser(db, owner, uid, { isActive: false });
    expect(await getSession(db, l2.token)).toBeNull();
    expect(await msg(login(db, "b@t.com", "NovaSenha4567"))).toBe("E-mail ou senha incorretos.");
  });

  it("nunca fica sem proprietário ativo", async () => {
    const owner = { userId: ownerId, unitId, role: "administrador" as const, perms: buildPerms("administrador", []) };
    expect(await msg(updateUser(db, owner, ownerId, { role: "gerente" }))).toMatch(/pelo menos um administrador/);
    expect(await msg(updateUser(db, owner, ownerId, { isActive: false }))).toMatch(/pelo menos um administrador/);
    expect((await listUsers(db, owner)).some((u) => u.role === "administrador")).toBe(true);
  });
});

describe("matriz de permissões (V1.2)", () => {
  it("tecnico não tem nenhuma permissão financeira ou administrativa", () => {
    const forbidden = ["finance.view", "finance.manage", "finance.close_period", "reports.view", "reports.export", "admin.catalog", "admin.settings", "users.manage", "audit.view", "data.export", "payments.register", "payments.confirm", "payments.reverse", "cash.manage", "dashboard.full"] as const;
    for (const p of forbidden) expect(ROLE_PERMISSIONS.tecnico.has(p)).toBe(false);
  });
  it("gerente opera e lança no financeiro; não altera permissões nem fecha período; estorno é só do administrador", () => {
    for (const p of ["finance.manage", "payments.register", "cash.manage", "agenda.manage"] as const) expect(ROLE_PERMISSIONS.gerente.has(p)).toBe(true);
    for (const p of ["users.manage", "finance.close_period", "payments.reverse", "admin.settings", "admin.catalog", "data.export"] as const) expect(ROLE_PERMISSIONS.gerente.has(p)).toBe(false);
    for (const p of ["finance.manage", "finance.close_period", "payments.reverse", "cash.manage"] as const) expect(ROLE_PERMISSIONS.vendedora_gestora.has(p)).toBe(false);
    expect(ROLE_PERMISSIONS.administrador.has("payments.reverse")).toBe(true);
  });
  it("permissão individual concedida vale; permissões desconhecidas são ignoradas", () => {
    const p = buildPerms("tecnico", [{ permission: "payments.register", granted: true }, { permission: "inventada", granted: true }]);
    expect(p.has("payments.register")).toBe(true);
    expect((p as Set<string>).has("inventada")).toBe(false);
  });
});
