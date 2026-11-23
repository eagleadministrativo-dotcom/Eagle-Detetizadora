import { describe, it, expect, beforeAll } from "vitest";
import { createDb, type Db } from "./db";
import { seedDemo, DEMO_USERS } from "./demo";
import { buildPerms, type Ctx } from "./permissions";
import { accountBalances, computeDre, getDashboard, indicatorRecords, getCashFlow } from "./services/reports";
import { runDailyJobs } from "./services/ops";
import { monthStart, todayYmd, addDays } from "@/lib/dates";

// Simulação de um mês de operação (dados fictícios) e conferência da cadeia
// Agenda → Atendimento → Cobrança → Pagamento → Caixa → Financeiro → DRE → Dashboard.
let db: Db;
let unitId: string;
let owner: Ctx;
const today = todayYmd();
const P = { start: addDays(today, -35), end: today };

beforeAll(async () => {
  db = await createDb({ dataDir: "memory://" });
  ({ unitId } = await seedDemo(db));
  const [u] = await db.query<{ id: string }>("select id from users where email=$1", [DEMO_USERS.owner]);
  owner = { userId: u.id, unitId, role: "proprietario", perms: buildPerms("proprietario", []) };
}, 240000);

const one = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p))[0];

describe("consistência do mês simulado", () => {
  it("receita dos atendimentos = valor das cobranças geradas", async () => {
    const a = await one<{ t: number }>("select coalesce(sum(total_cents),0)::bigint as t from attendances where status='concluido'");
    const r = await one<{ t: number }>("select coalesce(sum(amount_due_cents),0)::bigint as t from receivables where attendance_id is not null and status='ativo'");
    expect(a.t).toBeGreaterThan(0);
    expect(r.t).toBe(a.t);
    const noRec = await one<{ n: number }>("select count(*)::bigint as n from attendances a where status='concluido' and not exists (select 1 from receivables r where r.attendance_id=a.id)");
    expect(noRec.n).toBe(0);
  });

  it("nenhuma cobrança recebe mais do que o devido e os saldos da visão batem com os pagamentos", async () => {
    const bad = await one<{ n: number }>("select count(*)::bigint as n from receivable_balances where registered_cents > amount_due_cents or registered_cents < 0 or confirmed_cents > registered_cents or settled_cents > confirmed_cents");
    expect(bad.n).toBe(0);
    const diff = await one<{ n: number }>(
      `select count(*)::bigint as n from receivable_balances b where b.registered_cents <>
         coalesce((select sum(case when kind='recebimento' then amount_cents else -amount_cents end) from payments p where p.receivable_id=b.receivable_id),0)`);
    expect(diff.n).toBe(0);
  });

  it("cada pagamento tem seu movimento de caixa quando houve caixa aberto; sessões fechadas fecham a conta", async () => {
    const orphan = await one<{ n: number }>("select count(*)::bigint as n from payments p where p.cash_session_id is not null and not exists (select 1 from cash_movements m where m.payment_id=p.id)");
    expect(orphan.n).toBe(0);
    const cashNoSession = await one<{ n: number }>("select count(*)::bigint as n from payments p join payment_methods m on m.id=p.method_id where m.kind='dinheiro' and p.cash_session_id is null");
    expect(cashNoSession.n).toBe(0);
    const sessions = await db.query<{ id: string; difference_cents: number; closing_declared: { declared_cents: number }[]; closing_expected: { expected_cents: number }[] }>(
      "select id, difference_cents, closing_declared, closing_expected from cash_sessions where status='fechado'");
    expect(sessions.length).toBeGreaterThan(20);
    for (const s of sessions) {
      const d = s.closing_declared.reduce((a, x) => a + x.declared_cents, 0);
      const e = s.closing_expected.reduce((a, x) => a + x.expected_cents, 0);
      expect(d - e).toBe(s.difference_cents);
    }
    const withDiff = sessions.filter((s) => s.difference_cents !== 0);
    expect(withDiff.length).toBeGreaterThan(0);
    const justified = await one<{ n: number }>("select count(*)::bigint as n from cash_sessions where status='fechado' and difference_cents <> 0 and justification is null");
    expect(justified.n).toBe(0);
  });

  it("DRE, dashboard e detalhamento mostram a mesma receita", async () => {
    const dre = await computeDre(db.query, unitId, P);
    const dash = await getDashboard(db, owner, P);
    const k = (key: string) => dash.kpis.find((x) => x.key === key)!;
    const drill = await indicatorRecords(db, owner, "revenue", P);
    // a DRE soma serviços e produtos; cada painel mostra os dois separados
    expect(dre.netRevenue - dre.otherRevenue).toBe(k("revenue").value! + k("products").value!);
    expect((await indicatorRecords(db, owner, "products", P)).total).toBe(k("products").value);
    expect(drill.total).toBe(k("revenue").value);
    expect(drill.rows.length).toBe(k("attendances").value);
    const bySeries = dash.revenueByDay.reduce((a, d) => a + d.cents, 0);
    expect(bySeries).toBe(k("revenue").value);
    const rd = await indicatorRecords(db, owner, "receipts_registered", P);
    expect(rd.total).toBe(k("receipts_registered").value);
    expect(k("receipts_registered").value! >= k("receipts_confirmed").value!).toBe(true);
    expect(k("receipts_confirmed").value! >= k("receipts_settled").value!).toBe(true);
    expect(k("receipts_confirmed").notReconciledCents).toBe(k("receipts_registered").value! - k("receipts_confirmed").value!);
  });

  it("saldo das contas = saldo inicial + recebimentos confirmados líquidos de taxa + aportes − contas pagas (conferido por SQL independente)", async () => {
    const acc = await accountBalances(db.query, unitId);
    const total = acc.reduce((a, c) => a + c.balance_cents, 0);
    const [open] = await db.query<{ v: number }>("select coalesce(sum(opening_balance_cents),0)::bigint as v from financial_accounts where unit_id=$1", [unitId]);
    const [inn] = await db.query<{ v: number }>(
      `select coalesce(sum(case when p.kind='recebimento' then p.amount_cents - p.fee_cents else -(p.amount_cents - p.fee_cents) end),0)::bigint as v
       from payments p join payment_methods m on m.id=p.method_id where p.status in ('confirmado','liquidado') and m.account_id is not null`);
    const [out] = await db.query<{ v: number }>("select coalesce(sum(case when kind='pagamento' then amount_cents else -amount_cents end),0)::bigint as v from payable_payments where account_id is not null");
    expect(total).toBe(open.v + inn.v - out.v);
  });

  it("fluxo de caixa realizado fecha com o saldo atual", async () => {
    const flow = await getCashFlow(db, owner, { start: monthStart(addDays(today, -40)), end: today }, 0);
    const last = flow.rows[flow.rows.length - 1];
    expect(last.balance).toBe(flow.todayBalance);
    expect(flow.rows.every((r) => !r.estimate)).toBe(true);
  });

  it("rotinas automáticas são idempotentes e não duplicam notificações nem contas recorrentes", async () => {
    const before = await one<{ n: number }>("select count(*)::bigint as n from payables");
    await runDailyJobs(db, unitId, today);
    await runDailyJobs(db, unitId, today);
    await runDailyJobs(db, unitId, addDays(today, 1));
    const rec1 = await one<{ n: number }>("select count(*)::bigint as n from payables");
    await runDailyJobs(db, unitId, addDays(today, 1));
    const rec2 = await one<{ n: number }>("select count(*)::bigint as n from payables");
    expect(rec1.n).toBeGreaterThanOrEqual(before.n);
    expect(rec2.n).toBe(rec1.n);
    const dups = await one<{ n: number }>("select count(*)::bigint as n from (select dedupe_key from notifications group by 1 having count(*)>1) x");
    expect(dups.n).toBe(0);
    const dupPay = await one<{ n: number }>("select count(*)::bigint as n from (select idempotency_key from payments group by 1 having count(*)>1) x");
    expect(dupPay.n).toBe(0);
  });

  it("nada é excluído silenciosamente: trilha de auditoria cobre o fluxo e é imutável", async () => {
    const actions = await db.query<{ action: string }>("select distinct action from audit_logs");
    const set = new Set(actions.map((a) => a.action));
    for (const a of ["AGENDAMENTO_CRIADO", "ATENDIMENTO_INICIADO", "ATENDIMENTO_CONCLUIDO", "PAGAMENTO_REGISTRADO", "PAGAMENTO_CONFIRMADO", "PAGAMENTO_LIQUIDADO", "CAIXA_ABERTO", "CAIXA_FECHADO", "CONTA_PAGAR_CRIADA", "CONTA_PAGA"]) expect(set.has(a)).toBe(true);
    await expect(db.query("delete from audit_logs")).rejects.toThrow();
  });
});

describe("backup lógico e restauração", () => {
  it("restaura em banco vazio e os números do financeiro coincidem", async () => {
    const { exportBackup, restoreBackup } = await import("./services/ops");
    const backup = await exportBackup(db, owner);
    const db2 = await createDb({ dataDir: "memory://" });
    await expect(restoreBackup(db2, backup.json, DEMO_USERS.owner, "NovaSenhaForte99")).resolves.toBeTruthy();
    const [u2] = await db2.query<{ id: string }>("select id from users where email=$1", [DEMO_USERS.owner]);
    const owner2: Ctx = { userId: u2.id, unitId, role: "proprietario", perms: buildPerms("proprietario", []) };
    const a = await getDashboard(db, owner, P);
    const b = await getDashboard(db2, owner2, P);
    for (const key of ["revenue", "attendances", "receipts_registered", "receipts_confirmed", "receipts_settled", "operating_result", "cash_balance", "receivables_open", "payables_open"]) {
      expect(b.kpis.find((k) => k.key === key)?.value).toBe(a.kpis.find((k) => k.key === key)?.value);
    }
    expect((await computeDre(db2.query, unitId, P)).netResult).toBe((await computeDre(db.query, unitId, P)).netResult);
    // só o proprietário informado consegue entrar; os demais têm acesso bloqueado até redefinição
    const { login } = await import("./auth");
    await expect(login(db2, DEMO_USERS.owner, "NovaSenhaForte99")).resolves.toBeTruthy();
    await expect(login(db2, DEMO_USERS.barber1, "Demo@Marfim2026")).rejects.toThrow();
    await expect(restoreBackup(db2, backup.json, DEMO_USERS.owner, "NovaSenhaForte99")).rejects.toThrow(/vazio/);
    const [aud] = await db2.query<{ n: number }>("select count(*)::bigint as n from audit_logs");
    expect(aud.n).toBeGreaterThan(100);
    await db2.close();
  }, 120000);
});
