import type { Db } from "./db";
import { buildPerms, type Ctx } from "./permissions";
import { createUser, setupInitial } from "./services/bootstrap";
import { listCatalog, saveFinancialAccount, savePaymentMethod, saveService, saveStaff, updateSettings } from "./services/catalog";
import { saveCustomer } from "./services/customers";
import { applyDiscount, completeAttendance, quickAttendance } from "./services/attendance";
import { closeCash, expectedByMethod, openCash, addCashMovement } from "./services/cash";
import { confirmPayment, settlePayment } from "./services/payments";
import { createPayable, payPayable, saveGoal } from "./services/finance";
import { addDays, atLocal, dayOfWeek, monthEnd, monthStart, todayYmd } from "@/lib/dates";

export const DEMO_PASSWORD = "Demo@Marfim2026";
export const DEMO_USERS = { owner: "dono@demo.marfim.local", manager: "gerente@demo.marfim.local", barber1: "rafael@demo.marfim.local", barber2: "diego@demo.marfim.local", accountant: "contador@demo.marfim.local" };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const FIRST = ["Lucas", "Mateus", "Pedro", "Gabriel", "Bruno", "Rafael", "Thiago", "André", "Felipe", "Gustavo", "Carlos", "Eduardo", "Vinícius", "Leonardo", "Henrique", "Rodrigo", "Daniel", "Marcelo", "Fábio", "Ricardo", "Caio", "Renato", "Otávio", "Samuel", "Murilo"];
const LAST = ["Souza", "Lima", "Oliveira", "Costa", "Pereira", "Almeida", "Ribeiro", "Martins", "Carvalho", "Rocha"];

/** Dados FICTÍCIOS para demonstração. Nunca use em produção. */
export async function seedDemo(db: Db) {
  const { unitId, ownerId, staffId: ownerStaff } = await setupInitial(db, { orgName: "MARFIM Studio (DEMONSTRAÇÃO)", unitName: "Curitiba · demo", ownerName: "Proprietário Demo", email: DEMO_USERS.owner, password: DEMO_PASSWORD, demo: true });
  const ctx = (userId: string, role: Ctx["role"], staffId: string | null = null): Ctx => ({ userId, unitId, role, staffId, perms: buildPerms(role, []) });
  const owner = ctx(ownerId, "proprietario", ownerStaff);
  await db.query("update staff set name='Proprietário Demo' where id=$1", [ownerStaff]);

  const sch = [1, 2, 3, 4, 5, 6].map((d) => ({ day: d, start: "09:00", end: d === 6 ? "17:00" : "19:00" }));
  const rafael = await saveStaff(db, owner, { name: "Rafael (demo)", contractType: "pj", color: "#8b6b4a", schedules: sch });
  const diego = await saveStaff(db, owner, { name: "Diego (demo)", contractType: "clt", color: "#56697a", schedules: sch });
  await saveStaff(db, owner, { id: ownerStaff, name: "Proprietário Demo", contractType: "proprietario", color: "#4a6b45", schedules: sch });
  await createUser(db, owner, { email: DEMO_USERS.barber1, fullName: "Rafael (demo)", role: "barbeiro", password: DEMO_PASSWORD, staffId: rafael });
  await createUser(db, owner, { email: DEMO_USERS.barber2, fullName: "Diego (demo)", role: "barbeiro", password: DEMO_PASSWORD, staffId: diego });
  await createUser(db, owner, { email: DEMO_USERS.manager, fullName: "Gerente Demo", role: "gerente", password: DEMO_PASSWORD });
  await createUser(db, owner, { email: DEMO_USERS.accountant, fullName: "Contador Demo", role: "contador", password: DEMO_PASSWORD });
  await db.query("insert into chairs(unit_id,name) values ($1,'Cadeira 2')", [unitId]);

  const cat0 = await listCatalog(db, unitId);
  const cabelo = cat0.svcCats.find((c) => c.name === "Cabelo")!.id, barba = cat0.svcCats.find((c) => c.name === "Barba")!.id, combos = cat0.svcCats.find((c) => c.name === "Combos")!.id;
  const corte = await saveService(db, owner, { name: "Corte", durationMinutes: 30, priceCents: 6000, categoryId: cabelo, color: "#8b6b4a" });
  const barbaS = await saveService(db, owner, { name: "Barba", durationMinutes: 30, priceCents: 4000, categoryId: barba });
  const combo = await saveService(db, owner, { name: "Corte + Barba", durationMinutes: 60, priceCents: 9000, categoryId: combos });
  const sobr = await saveService(db, owner, { name: "Sobrancelha", durationMinutes: 15, priceCents: 2000, categoryId: barba });
  const pig = await saveService(db, owner, { name: "Pigmentação", durationMinutes: 45, priceCents: 8000, categoryId: cabelo, bufferMinutes: 5, customFields: [{ label: "Produto", value: "Tonalizante (demo)" }] });
  const services = [{ id: corte, p: 6000, w: 40 }, { id: barbaS, p: 4000, w: 20 }, { id: combo, p: 9000, w: 25 }, { id: sobr, p: 2000, w: 10 }, { id: pig, p: 8000, w: 5 }];

  const accs = cat0.accounts;
  const bank = accs.find((a) => a.kind === "banco")!;
  await saveFinancialAccount(db, owner, { id: bank.id, name: bank.name, kind: "banco", openingBalanceCents: 500000 });
  for (const m of cat0.methods) {
    if (m.kind === "cartao_debito") await savePaymentMethod(db, owner, { id: m.id, name: m.name, kind: m.kind, feePercent: 1.99, settlementDays: 1, accountId: m.account_id });
    if (m.kind === "cartao_credito") await savePaymentMethod(db, owner, { id: m.id, name: m.name, kind: m.kind, feePercent: 3.49, settlementDays: 30, accountId: m.account_id });
  }
  const methods = Object.fromEntries((await listCatalog(db, unitId)).methods.map((m) => [m.kind, m.id]));

  const custs: string[] = [];
  for (let i = 0; i < 25; i++) custs.push(await saveCustomer(db, owner, { name: `${FIRST[i]} ${LAST[i % LAST.length]} (demo)`, phone: `41 99${String(1000000 + i * 137).slice(0, 7)}` }));
  await updateSettings(db, owner, { retroactive_edit_days: 90 });

  const rand = rng(42);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const today = todayYmd();
  const staffIds = [rafael, diego];
  const chairs = (await db.query<{ id: string }>("select id from chairs where unit_id=$1 order by name", [unitId])).map((c) => c.id);

  let prevCash = 20000;
  for (let back = 30; back >= 1; back--) {
    const day = addDays(today, -back);
    if (dayOfWeek(day) === 0) continue;
    const cashId = await openCash(db, owner, { declaredCents: prevCash });
    const n = dayOfWeek(day) === 6 ? 6 : 5 + Math.floor(rand() * 5);
    for (let k = 0; k < n; k++) {
      const staffId = staffIds[k % 2];
      const startsAt = new Date(atLocal(day, "09:00").getTime() + Math.floor(k / 2) * 120 * 60000);
      const ids = [pick(services.flatMap((s) => Array(s.w).fill(s)))] as typeof services;
      if (rand() < 0.15) ids.push(pick(services.filter((s) => s.id !== ids[0].id)));
      const att = await quickAttendance(db, owner, { customerId: pick(custs), staffId, chairId: chairs[k % 2], serviceIds: ids.map((s) => s.id), startsAt });
      let total = ids.reduce((a, s) => a + s.p, 0);
      if (rand() < 0.08) { const d = Math.round(total * 0.1 / 100) * 100; await applyDiscount(db, owner, att, { discountCents: d, reason: "Cliente fidelidade (demo)" }); total -= d; }
      const r = rand();
      const pay = (m: string, amt: number) => ({ methodId: methods[m], amountCents: amt, idempotencyKey: `demo-${day}-${k}-${m}-${amt}`, reference: m === "pix" ? `E${Math.floor(rand() * 1e9)}` : undefined });
      let payments: ReturnType<typeof pay>[] = [];
      if (r < 0.35) payments = [pay("pix", total)];
      else if (r < 0.55) payments = [pay("cartao_debito", total)];
      else if (r < 0.72) payments = [pay("cartao_credito", total)];
      else if (r < 0.9) payments = [pay("dinheiro", total)];
      else if (r < 0.95) payments = [pay("dinheiro", Math.floor(total / 2 / 100) * 100), pay("pix", total - Math.floor(total / 2 / 100) * 100)];
      else payments = [];
      const res = await completeAttendance(db, owner, att, { payments: payments.filter((p) => p.amountCents > 0) });
      if (back > 2) {
        for (const pid of res.paymentIds) {
          const [p] = await db.query<{ status: string }>("select status from payments where id=$1", [pid]);
          if (p.status === "registrado") {
            await confirmPayment(db, owner, pid, "Conferido no extrato (demo)");
            if (back > 4) await settlePayment(db, owner, pid);
          }
        }
      }
    }
    if (rand() < 0.3) await addCashMovement(db, owner, { kind: "sangria", amountCents: 10000, description: "Retirada para depósito (demo)", idempotencyKey: `demo-sangria-${day}` });
    const totals = await expectedByMethod(db.query, cashId);
    const declared = Object.fromEntries(totals.map((t) => [t.method_id, t.expected_cents]));
    const cashM = totals.find((t) => t.kind === "dinheiro");
    const withDiff = back % 11 === 0 && cashM;
    if (withDiff) declared[cashM.method_id] = cashM.expected_cents - 500;
    await closeCash(db, owner, cashId, { declared, justification: withDiff ? "Troco entregue a mais (demo)" : undefined });
    prevCash = cashM ? declared[cashM.method_id] : prevCash;
  }

  // alinha carimbos de data/hora ao dia do agendamento (histórico gerado em um instante só)
  await db.exec(`
    update attendances a set started_at = ap.starts_at, finished_at = ap.ends_at, updated_at = ap.ends_at from appointments ap where ap.id = a.appointment_id and a.status = 'concluido';
    update receivables r set created_at = a.finished_at from attendances a where a.id = r.attendance_id;
    update payments p set paid_at = r.created_at + interval '2 minutes', registered_at = r.created_at + interval '2 minutes', confirmed_at = case when p.confirmed_at is not null then r.created_at + interval '1 day' end,
      liquidated_at = case when p.liquidated_at is not null then r.created_at + interval '2 days' end from receivables r where r.id = p.receivable_id;
    update cash_movements m set created_at = p.paid_at from payments p where p.id = m.payment_id;
    update cash_sessions s set opened_at = x.mn - interval '25 minutes', closed_at = x.mx + interval '30 minutes' from (select cash_session_id, min(created_at) mn, max(created_at) mx from cash_movements group by 1) x where x.cash_session_id = s.id and s.status = 'fechado';
    update cash_movements m set created_at = s.closed_at - interval '10 minutes' from cash_sessions s where s.id = m.cash_session_id and m.payment_id is null and m.kind in ('sangria','suprimento');
  `);

  // contas
  const fc = Object.fromEntries((await listCatalog(db, unitId)).categories.map((c) => [c.name, c.id]));
  const m0 = monthStart(today);
  const mk = async (name: string, cat: string, amount: number, due: string, opts: { recurrence?: "mensal"; paid?: boolean } = {}) => {
    const [id] = await createPayable(db, owner, { categoryId: fc[cat], description: name, amountCents: amount, dueDate: due, competenceDate: due, recurrence: opts.recurrence ?? null });
    if (opts.paid) await payPayable(db, owner, { payableId: id, amountCents: amount, accountId: bank.id, idempotencyKey: `demo-pay-${name}-${due}`, paidAt: atLocal(due, "10:00") });
  };
  await mk("Aluguel (demo)", "Aluguel", 280000, addDays(m0, 4), { recurrence: "mensal", paid: addDays(m0, 4) < today });
  await mk("Energia elétrica (demo)", "Energia elétrica", 38000, addDays(m0, 9), { paid: addDays(m0, 9) < today });
  await mk("Internet (demo)", "Internet e telefone", 12000, addDays(m0, 14), { recurrence: "mensal", paid: addDays(m0, 14) < today });
  await mk("Produtos de barbearia (demo)", "Produtos de consumo", 65000, addDays(m0, 6), { paid: addDays(m0, 6) < today });
  await mk("Contador (demo)", "Contador", 30000, addDays(today, 3));
  await mk("DAS (demo)", "Impostos e taxas", 42000, addDays(today, 6));
  await mk("Pró-labore (demo)", "Pró-labore", 300000, addDays(today, 10));

  await saveGoal(db, owner, { kind: "receita", name: "Receita do mês", targetCents: 1100000, periodStart: m0, periodEnd: monthEnd(today) });
  await saveGoal(db, owner, { kind: "reserva", name: "Reserva de emergência", targetCents: 1500000 });

  // hoje: caixa aberto, um atendimento em andamento e agenda futura
  await openCash(db, owner, { declaredCents: prevCash });
  const now = new Date();
  await quickAttendance(db, owner, { customerId: custs[0], staffId: rafael, serviceIds: [corte], startsAt: now }).catch(() => undefined);
  const { createAppointment } = await import("./services/agenda");
  for (const [i, h] of ["15:00", "16:00", "17:00"].entries()) {
    const t = atLocal(today, h);
    if (t.getTime() > now.getTime() + 3600000) await createAppointment(db, owner, { customerId: custs[i + 3], staffId: [diego, rafael, diego][i], serviceIds: [combo], startsAt: t }).catch(() => undefined);
  }
  let next = addDays(today, 1);
  if (dayOfWeek(next) === 0) next = addDays(next, 1);
  for (const [i, h] of ["09:00", "10:30", "14:00", "16:30"].entries()) {
    await createAppointment(db, owner, { customerId: custs[i + 6], staffId: staffIds[i % 2], serviceIds: [i % 2 ? barbaS : corte], startsAt: atLocal(next, h) }).catch(() => undefined);
  }
  await updateSettings(db, owner, { retroactive_edit_days: 7 });
  return { unitId };
}
