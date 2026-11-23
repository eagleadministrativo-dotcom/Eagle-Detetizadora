import { describe, it, expect, beforeAll } from "vitest";
import { createDb, type Db } from "./db";
import { setupInitial } from "./services/bootstrap";
import { login, getSession, totpAt, beginMfaSetup, completeMfaSetup, verifyMfaForSession, generateRecoveryCodes, recoveryCodesLeft } from "./auth";
import { rateLimit, recordJob, logError, healthReport, pruneOps } from "./services/health";
import { buildPerms } from "./permissions";

let db: Db;
let ownerId: string;
let unitId: string;
beforeAll(async () => {
  db = await createDb({ dataDir: "memory://" });
  const r = await setupInitial(db, { orgName: "T", unitName: "U", ownerName: "Dono", email: "dono@ops.com", password: "SenhaForte123" });
  ownerId = r.ownerId; unitId = r.unitId;
});
const owner = () => ({ userId: ownerId, unitId, role: "proprietario" as const, staffId: null, perms: buildPerms("proprietario", []) });

describe("códigos de recuperação do MFA", () => {
  it("só gera com MFA ativo, cada código vale uma vez e gerar de novo invalida os antigos", async () => {
    await expect(generateRecoveryCodes(db, ownerId)).rejects.toThrow(/Ative/);
    const l = await login(db, "dono@ops.com", "SenhaForte123");
    const secret = await beginMfaSetup(db, ownerId);
    await completeMfaSetup(db, l.token, ownerId, totpAt(secret, Date.now()));
    const codes = await generateRecoveryCodes(db, ownerId);
    expect(codes).toHaveLength(8);
    expect(codes.every((c) => /^[A-Z][A-Z0-9]{3}-[A-Z0-9]{4}$/.test(c))).toBe(true);
    expect(await recoveryCodesLeft(db, ownerId)).toBe(8);

    const l2 = await login(db, "dono@ops.com", "SenhaForte123");
    await verifyMfaForSession(db, l2.token, codes[0].toLowerCase().replace("-", ""));
    expect((await getSession(db, l2.token))?.mfaVerified).toBe(true);
    expect(await recoveryCodesLeft(db, ownerId)).toBe(7);

    const l3 = await login(db, "dono@ops.com", "SenhaForte123");
    await expect(verifyMfaForSession(db, l3.token, codes[0])).rejects.toThrow(/incorreto/);
    const fresh = await generateRecoveryCodes(db, ownerId);
    await expect(verifyMfaForSession(db, l3.token, codes[1])).rejects.toThrow(/incorreto/);
    await verifyMfaForSession(db, l3.token, fresh[0]);
    expect((await getSession(db, l3.token))?.mfaVerified).toBe(true);
  });
});

describe("limite de tentativas", () => {
  it("barra depois do máximo dentro da janela e libera chaves diferentes", async () => {
    const r: boolean[] = [];
    for (let i = 0; i < 4; i++) r.push(await rateLimit(db, "login:ip:1.1.1.1", 3, 900));
    expect(r).toEqual([true, true, true, false]);
    expect(await rateLimit(db, "login:ip:2.2.2.2", 3, 900)).toBe(true);
    await db.query("update rate_limits set window_start = now() - interval '20 minutes' where key='login:ip:1.1.1.1'");
    expect(await rateLimit(db, "login:ip:1.1.1.1", 3, 900)).toBe(true);
  });
});

describe("saúde do sistema", () => {
  it("registra rotinas, marca erro interno e avisa o proprietário", async () => {
    await recordJob(db, "teste_ok", async () => ({ enviados: 2 }));
    await recordJob(db, "teste_falha", async () => ({ parte: { error: "timeout no envio" } }));
    await expect(recordJob(db, "teste_excecao", async () => { throw new Error("quebrou"); })).rejects.toThrow("quebrou");
    await logError(db, { message: "falha x", path: "/agenda?x=dados-pessoais", method: "GET" });
    const h = await healthReport(db, owner());
    const by = Object.fromEntries(h.jobs.map((j) => [j.job, j]));
    expect(by.teste_ok.status).toBe("ok");
    expect(by.teste_falha).toMatchObject({ status: "erro", error: "timeout no envio" });
    expect(by.teste_excecao.status).toBe("erro");
    expect(h.recentErrors[0]).toMatchObject({ path: "/agenda", message: "falha x" }); // sem query string
    const n = await db.query<{ message: string; severity: string }>("select message, severity from notifications where kind='sistema_rotina' and user_id=$1", [ownerId]);
    expect(n.length).toBe(2);
    expect(n.every((x) => x.severity === "critico")).toBe(true);
  });
  it("fecha rotinas presas e limpa registros antigos", async () => {
    await db.query("insert into job_runs(job, started_at) values ('presa', now() - interval '2 hours')");
    await db.query("insert into job_runs(job, started_at, status) values ('velha', now() - interval '120 days', 'ok')");
    const r = await pruneOps(db);
    expect(r.jobs).toBe(1);
    const [p] = await db.query<{ status: string }>("select status from job_runs where job='presa'");
    expect(p.status).toBe("erro");
  });
});

describe("copiloto", () => {
  it("toda sugestão explica o motivo e dispensar vale até o dia seguinte", async () => {
    const { copilotInsights, dismissInsight } = await import("./services/insights");
    const kpis = [{ key: "occupancy", label: "Ocupação", value: 12, unit: "pct" as const, definition: "", formula: "", source: "", exclusions: "", updatedAt: new Date() }];
    const a = await copilotInsights(db, owner(), { kpis, nextUp: [], full: true });
    const occ = a.find((i) => i.id.startsWith("ocup-"));
    expect(occ?.why).toMatch(/35%/);
    expect(a.every((i) => i.why.length > 10)).toBe(true);
    await dismissInsight(db, owner(), occ!.id);
    await dismissInsight(db, owner(), occ!.id); // repetir não quebra
    const b = await copilotInsights(db, owner(), { kpis, nextUp: [], full: true });
    expect(b.some((i) => i.id === occ!.id)).toBe(false);
    await db.query("update copilot_dismissals set dismissed_on = current_date - 1");
    const c = await copilotInsights(db, owner(), { kpis, nextUp: [], full: true });
    expect(c.some((i) => i.id === occ!.id)).toBe(true);
  });
});
