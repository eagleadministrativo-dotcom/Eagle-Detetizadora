import { describe, it, expect, beforeAll } from "vitest";
import { createDb, type Db } from "./db";
import { setupInitial, createUser, updateUser, listUsers } from "./services/bootstrap";
import { login, getSession, verifyTotp, totpAt, base32Encode, newTotpSecret, beginMfaSetup, completeMfaSetup, verifyMfaForSession, hashPassword, verifyPassword, changePassword, logout } from "./auth";
import { buildPerms, ROLE_PERMISSIONS } from "./permissions";
import { updateSettings } from "./services/catalog";

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

describe("senha e TOTP", () => {
  it("hash não é reversível e verifica; senha fraca é recusada", async () => {
    const h = hashPassword("abc12345678");
    expect(h).not.toContain("abc12345678");
    expect(verifyPassword("abc12345678", h)).toBe(true);
    expect(verifyPassword("outra", h)).toBe(false);
    const owner = { userId: ownerId, unitId, role: "administrador" as const, perms: buildPerms("administrador", []) };
    expect(await msg(createUser(db, owner, { email: "x@t.com", fullName: "X", role: "tecnico", password: "curta" }))).toMatch(/10 caracteres/);
    expect(await msg(createUser(db, owner, { email: "x@t.com", fullName: "X", role: "tecnico", password: "somenteletras" }))).toMatch(/letras e números/);
  });
  it("TOTP bate com o vetor da RFC 6238", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpAt(secret, 59000)).toBe("287082");
    expect(totpAt(secret, 1111111109000)).toBe("081804");
    const s = newTotpSecret();
    expect(verifyTotp(s, totpAt(s, Date.now()))).toBe(true);
    expect(verifyTotp(s, "000000")).toBe(false);
    expect(verifyTotp(s, "abc")).toBe(false);
  });
});

describe("login, bloqueio, MFA e sessão", () => {
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

  it("proprietário em produção precisa ativar MFA; sessão só vale depois do código", async () => {
    const owner = { userId: ownerId, unitId, role: "administrador" as const, perms: buildPerms("administrador", []) };
    await updateSettings(db, owner, { mfa_required: true });
    const l = await login(db, "dono@t.com", "SenhaForte123");
    expect(l.needsMfaSetup).toBe(true);
    let s = await getSession(db, l.token);
    expect(s?.mfaVerified).toBe(false);
    const secret = await beginMfaSetup(db, ownerId);
    expect(await msg(completeMfaSetup(db, l.token, ownerId, "000000"))).toMatch(/incorreto/);
    await completeMfaSetup(db, l.token, ownerId, totpAt(secret, Date.now()));
    s = await getSession(db, l.token);
    expect(s?.mfaVerified).toBe(true);

    const l2 = await login(db, "dono@t.com", "SenhaForte123");
    expect(l2.needsMfa).toBe(true);
    expect((await getSession(db, l2.token))?.mfaVerified).toBe(false);
    expect(await msg(verifyMfaForSession(db, l2.token, "123456"))).toMatch(/incorreto/);
    await verifyMfaForSession(db, l2.token, totpAt(secret, Date.now()));
    expect((await getSession(db, l2.token))?.mfaVerified).toBe(true);

    await logout(db, l2.token);
    expect(await getSession(db, l2.token)).toBeNull();
    expect(await getSession(db, undefined)).toBeNull();
    expect(await getSession(db, "token-inventado")).toBeNull();
  });

  it("código MFA errado repetido bloqueia a conta e derruba a sessão", async () => {
    const l = await login(db, "dono@t.com", "SenhaForte123");
    for (let i = 0; i < 4; i++) expect(await msg(verifyMfaForSession(db, l.token, "000000"))).toMatch(/incorreto/);
    expect(await msg(verifyMfaForSession(db, l.token, "000000"))).toMatch(/Muitas tentativas/);
    expect(await getSession(db, l.token)).toBeNull();
    expect(await msg(login(db, "dono@t.com", "SenhaForte123"))).toMatch(/bloqueado/);
    await db.query("update users set locked_until=null, failed_attempts=0 where id=$1", [ownerId]);
  });

  it("trocar a senha encerra todas as sessões; usuário desativado perde o acesso", async () => {
    const owner = { userId: ownerId, unitId, role: "administrador" as const, perms: buildPerms("administrador", []) };
    const uid = await createUser(db, owner, { email: "b@t.com", fullName: "B", role: "tecnico", password: "SenhaForte123" });
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
