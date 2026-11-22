import { describe, it, expect, beforeAll } from "vitest";
import { makeWorld, future, key, type World } from "./testkit";
import { quickAttendance, completeAttendance, applyDiscount } from "./services/attendance";
import { confirmPayment, settlePayment } from "./services/payments";
import { openCash, closeCash, expectedByMethod } from "./services/cash";
import { savePaymentMethod, listCatalog } from "./services/catalog";
import { createPayable, payPayable, generateRecurringPayables, alertDueDates, listPayables } from "./services/finance";
import { computeDre, getDashboard, indicatorRecords, getCashFlow, accountBalances } from "./services/reports";
import { validateClosure, closePeriod, reopenPeriod } from "./services/closure";
import { runDailyJobs, exportDataset, listAudit } from "./services/ops";
import { saveCustomer } from "./services/customers";
import { todayYmd, addMonths, monthStart, monthEnd, addDays } from "@/lib/dates";
import { splitInstallments } from "@/lib/money";

let w: World;
const today = todayYmd();
const P = { start: today, end: today };
const msg = async (p: Promise<unknown>) => p.then(() => "OK", (e) => (e as Error).message);
let cashId: string;
let pixPaymentId: string;
const catId = async (kind: string) => (await listCatalog(w.db, w.unitId)).categories.find((c) => c.kind === kind)!.id;

beforeAll(async () => {
  w = await makeWorld();
  const cat = await listCatalog(w.db, w.unitId);
  const pix = cat.methods.find((m) => m.kind === "pix")!;
  await savePaymentMethod(w.db, w.owner, { id: pix.id, name: pix.name, kind: "pix", feePercent: 1, accountId: pix.account_id });
  cashId = await openCash(w.db, w.owner, { declaredCents: 0 });

  const mk = async (n: number, services: string[], customer: string) => {
    const att = await quickAttendance(w.db, w.owner, { customerId: customer, staffId: w.ownerStaffId, serviceIds: services, startsAt: future(-30 - n) });
    return att;
  };
  const a1 = await mk(1, [w.serviceId, w.service2Id], w.customerId);
  await applyDiscount(w.db, w.owner, a1, { discountCents: 1000, reason: "Fidelidade" });
  const r1 = await completeAttendance(w.db, w.owner, a1, {
    payments: [
      { methodId: w.methods.dinheiro, amountCents: 5000, idempotencyKey: key() },
      { methodId: w.methods.pix, amountCents: 4000, idempotencyKey: key(), reference: "PIX-1" },
    ],
  });
  pixPaymentId = r1.paymentIds[1];
  const a2 = await mk(2, [w.serviceId], w.customer2Id);
  const r2 = await completeAttendance(w.db, w.owner, a2, { payments: [{ methodId: w.methods.pix, amountCents: 5000, idempotencyKey: key() }] });
  void r2;
  const a3 = await mk(3, [w.service2Id], w.customerId);
  await completeAttendance(w.db, w.owner, a3); // fica pendente

  const aluguel = (await listCatalog(w.db, w.unitId)).categories.find((c) => c.name === "Aluguel")!.id;
  const ids = await createPayable(w.db, w.owner, { categoryId: aluguel, description: "Aluguel novembro", amountCents: 300000, dueDate: today, competenceDate: today });
  await createPayable(w.db, w.owner, { categoryId: await catId("custo"), description: "Produtos", amountCents: 1500, dueDate: today });
  await createPayable(w.db, w.owner, { categoryId: await catId("imposto"), description: "DAS", amountCents: 500, dueDate: today });
  void ids;
});

describe("DRE e indicadores", () => {
  it("DRE por competência com valores exatos", async () => {
    const d = await computeDre(w.db.query, w.unitId, P);
    expect(d.grossRevenue).toBe(20000);
    expect(d.discounts).toBe(1000);
    expect(d.netRevenue).toBe(19000);
    expect(d.fees).toBe(90); // pix 1% sobre 9000
    expect(d.variableCosts).toBe(1500);
    expect(d.contributionMargin).toBe(17410);
    expect(d.expenses).toBe(300000);
    expect(d.taxes).toBe(500);
    expect(d.operatingResult).toBe(17410 - 300000 - 500);
    expect(d.warnings.some((x) => x.includes("não foram conferidos"))).toBe(true);
  });

  it("indicadores separam registrado, confirmado e conciliado; drill-down fecha com o total", async () => {
    const dash = await getDashboard(w.db, w.owner, P);
    const k = (key: string) => dash.kpis.find((x) => x.key === key)!;
    expect(k("revenue").value).toBe(19000);
    expect(k("attendances").value).toBe(3);
    expect(k("ticket").value).toBe(6333);
    expect(k("receipts_registered").value).toBe(14000);
    expect(k("receipts_confirmed").value).toBe(5000); // só o dinheiro; pix aguarda conferência
    expect(k("receipts_confirmed").notReconciledCents).toBe(9000);
    expect(k("receipts_settled").value).toBe(0);
    expect(k("receivables_open").value).toBe(5000);
    for (const kp of dash.kpis) {
      expect(kp.definition.length).toBeGreaterThan(10);
      expect(kp.formula.length).toBeGreaterThan(3);
      expect(kp.source.length).toBeGreaterThan(3);
    }
    expect((await indicatorRecords(w.db, w.owner, "revenue", P)).total).toBe(19000);
    expect((await indicatorRecords(w.db, w.owner, "receipts_registered", P)).total).toBe(14000);
    expect((await indicatorRecords(w.db, w.owner, "receivables_open", P)).total).toBe(5000);
    expect(dash.alerts.some((a) => a.message.includes("aguardando conferência"))).toBe(true);
  });

  it("ocupação sem horário cadastrado não inventa resultado", async () => {
    const dash = await getDashboard(w.db, w.owner, P);
    const occ = dash.kpis.find((x) => x.key === "occupancy")!;
    expect(occ.value).toBeNull();
    expect(occ.warning).toMatch(/horário de funcionamento/);
  });

  it("barbeiro não vê números financeiros da empresa e só os próprios atendimentos", async () => {
    const dash = await getDashboard(w.db, w.barber, P);
    const keys = dash.kpis.map((x) => x.key);
    expect(keys).not.toContain("operating_result");
    expect(keys).not.toContain("cash_balance");
    expect(keys).not.toContain("receipts_confirmed");
    expect(dash.kpis.find((x) => x.key === "revenue")!.value).toBe(0);
    expect(await msg(indicatorRecords(w.db, w.barber, "receipts_registered", P))).toMatch(/permissão|Indicador/i);
    expect(await msg(getDashboard(w.db, w.accountant, P))).toBe("OK"); // contador lê indicadores financeiros
    expect(await msg(getDashboard(w.db, { ...w.barber, perms: new Set() }, P))).toMatch(/permissão/);
  });
});

describe("conciliação, caixa e fluxo", () => {
  it("conferir e liquidar atualiza confirmados/conciliados; saldo e fluxo batem", async () => {
    await confirmPayment(w.db, w.owner, pixPaymentId, "Extrato linha 3");
    await settlePayment(w.db, w.owner, pixPaymentId);
    const aluguelPayable = (await listPayables(w.db, w.owner)).rows.find((r) => r.description === "Aluguel novembro")!;
    await payPayable(w.db, w.owner, { payableId: aluguelPayable.id, amountCents: 100000, accountId: w.accounts.banco, idempotencyKey: key() });
    const kp = (await getDashboard(w.db, w.owner, P)).kpis;
    expect(kp.find((x) => x.key === "receipts_confirmed")!.value).toBe(9000);
    expect(kp.find((x) => x.key === "receipts_settled")!.value).toBe(4000);
    const flow = await getCashFlow(w.db, w.owner, P, 0);
    const row = flow.rows.find((r) => r.date === today)!;
    expect(row.inflow).toBe(5000 + 3960); // dinheiro + pix(4000) líquido de taxa 40
    expect(row.outflow).toBe(100000);
    expect(row.estimate).toBe(false);
    expect(flow.pendingConfirmation).toBe(5000); // pix de 5000 ainda só registrado
    const total = (await accountBalances(w.db.query, w.unitId)).reduce((a, c) => a + c.balance_cents, 0);
    expect(total).toBe(5000 + 3960 - 100000);
  });

  it("projeção é estimativa e sinaliza risco de caixa negativo", async () => {
    const flow = await getCashFlow(w.db, w.owner, P, 0);
    expect(flow.rows.some((r) => r.estimate)).toBe(false); // sem dias após o fim do período hoje→hoje
    const f2 = await getCashFlow(w.db, w.owner, { start: addDays(today, -1), end: today }, 5);
    expect(f2.rows.filter((r) => r.estimate).length).toBe(5);
    expect(f2.firstNegative).not.toBeNull();
  });

  it("fechamento de caixa confere por modalidade", async () => {
    const totals = await expectedByMethod(w.db.query, cashId);
    const declared = Object.fromEntries(totals.map((t) => [t.method_id, t.expected_cents]));
    const res = await closeCash(w.db, w.owner, cashId, { declared });
    expect(res.anyDiff).toBe(false);
  });
});

describe("contas, recorrência, parcelas e automações", () => {
  it("parcelamento não perde centavos", async () => {
    expect(splitInstallments(1000, 3)).toEqual([334, 333, 333]);
    const ids = await createPayable(w.db, w.owner, { categoryId: await catId("despesa"), description: "Equipamento", amountCents: 1000, dueDate: today, installments: 3 });
    expect(ids).toHaveLength(3);
    const rows = (await listPayables(w.db, w.owner)).rows.filter((r) => r.description === "Equipamento");
    expect(rows.reduce((a, r) => a + r.amount_cents, 0)).toBe(1000);
  });

  it("recorrência é idempotente e rodar duas vezes não duplica", async () => {
    await createPayable(w.db, w.owner, { categoryId: await catId("despesa"), description: "Internet", amountCents: 12000, dueDate: addDays(today, -40), recurrence: "mensal" });
    const first = await generateRecurringPayables(w.db, w.unitId, today);
    const again = await generateRecurringPayables(w.db, w.unitId, today);
    expect(first.created).toBeGreaterThan(0);
    expect(again.created).toBe(0);
  });

  it("pagamento de conta: não excede o saldo e é idempotente", async () => {
    const p = (await listPayables(w.db, w.owner)).rows.find((r) => r.description === "Produtos")!;
    expect(await msg(payPayable(w.db, w.owner, { payableId: p.id, amountCents: 2000, accountId: w.accounts.banco, idempotencyKey: key() }))).toMatch(/excede o saldo/);
    const k = key();
    const a = await payPayable(w.db, w.owner, { payableId: p.id, amountCents: 1500, accountId: w.accounts.banco, idempotencyKey: k });
    const b = await payPayable(w.db, w.owner, { payableId: p.id, amountCents: 1500, accountId: w.accounts.banco, idempotencyKey: k });
    expect(b.duplicate).toBe(true);
    expect(b.id).toBe(a.id);
  });

  it("alertas e rotina diária não geram notificações duplicadas", async () => {
    const a = await alertDueDates(w.db, w.unitId, today);
    const b = await alertDueDates(w.db, w.unitId, today);
    expect(a.sent).toBeGreaterThan(0);
    expect(b.sent).toBe(0);
    const j1 = await runDailyJobs(w.db, w.unitId, addDays(today, 1));
    const j2 = await runDailyJobs(w.db, w.unitId, addDays(today, 1));
    expect(j1.skipped).toBe(false);
    expect(j2.skipped).toBe(true);
    const [dups] = await w.db.query<{ n: number }>("select count(*)::bigint as n from (select dedupe_key from notifications group by 1 having count(*) > 1) x");
    expect(dups.n).toBe(0);
  });
});

describe("fechamento mensal e trava de período", () => {
  const prev = { start: monthStart(addMonths(today, -2)), end: monthEnd(addMonths(today, -2)) };
  it("período corrente não fecha; período passado limpo fecha, trava lançamentos e reabre", async () => {
    const cur = await validateClosure(w.db, w.owner, { start: monthStart(today), end: monthEnd(today) });
    expect(cur.ready).toBe(false);
    expect(cur.checks.find((c) => c.key === "ended")!.passed).toBe(false);
    expect(await msg(closePeriod(w.db, w.manager, prev))).toMatch(/permissão/);
    const id = await closePeriod(w.db, w.owner, prev);
    expect(await msg(closePeriod(w.db, w.owner, prev))).toMatch(/Já existe fechamento/);
    const aluguel = await catId("despesa");
    expect(await msg(createPayable(w.db, w.owner, { categoryId: aluguel, description: "Atrasada", amountCents: 100, dueDate: prev.end, competenceDate: prev.end }))).toMatch(/está fechado/);
    await reopenPeriod(w.db, w.owner, id, "Ajuste de lançamento");
    await createPayable(w.db, w.owner, { categoryId: aluguel, description: "Atrasada", amountCents: 100, dueDate: prev.end, competenceDate: prev.end });
  });
});

describe("exportação e auditoria", () => {
  it("CSV neutraliza fórmulas e registra auditoria; perfis sem permissão não exportam", async () => {
    await saveCustomer(w.db, w.owner, { name: "=HYPERLINK(\"x\")", phone: "41999990009" });
    const out = await exportDataset(w.db, w.owner, "clientes");
    expect(out.csv.startsWith("﻿")).toBe(true);
    expect(out.csv).toContain("'=HYPERLINK");
    expect(await msg(exportDataset(w.db, w.barber, "pagamentos"))).toMatch(/permissão/);
    const log = await listAudit(w.db, w.owner, { action: "DADOS_EXPORTADOS" });
    expect(log.total).toBeGreaterThan(0);
    expect(await msg(listAudit(w.db, w.barber))).toMatch(/permissão/);
  });
});
