import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addDays, atLocal, todayYmd, toYmd } from "@/lib/dates";
import { nextAfter, nextReturn, occurrences } from "@/lib/recurrence";
import { key, makeWorld, type World } from "./testkit";
import { buildPerms, type Ctx } from "./permissions";
import { openCash } from "./services/cash";
import { cancelAppointment, createAppointment, rescheduleAppointment } from "./services/agenda";
import { applyDiscount, completeAttendance, quickAttendance } from "./services/attendance";
import { cancelReceivable, confirmPayment, reversePayment } from "./services/payments";
import { adjustStock, returnProduct, saleOfAttendance, saveProduct, sellProducts, setAttendanceProducts } from "./services/products";
import { approveSettlement, cancelSettlement, byStaff, divergences, listEntries, listSettlements, paySettlement, saveRule, totals } from "./services/commissions";
import { commentTask, completeTask, createTask, getTask, listTasks, reviewTask, runTaskJobs, startTask, updateTask } from "./services/tasks";
import { listNotifications, markRead, notifyUsers, safeBody, unreadCount } from "./services/notify";
import { flushPush, saveSubscription } from "./services/push";
import { listReturns, refreshReturn, registerContact, runReturnJobs, saveContactPrefs, saveReturnRule, snoozeReturn } from "./services/returns";
import { evaluateRecords, getAchievements } from "./services/achievements";
import { processEvents } from "./services/events";
import { cancelSeries, createSeries, extendSeries, updateSeries } from "./services/series";
import { applyProfile, getUserAccess, savePrefs, saveProfile, search, setUserPermissions } from "./services/access";
import { saveStaffGoal, staffGoals, staffStats, teamOverview } from "./services/team";
import { computeDre } from "./services/reports";
import { listPayables, cancelPayable } from "./services/finance";
import { exportBackup, restoreBackup, runDailyJobs } from "./services/ops";
import { getSession } from "./auth";
import { createDb } from "./db";

let w: World;
const today = todayYmd();
const period = { start: today, end: today };
let slot = 0;
/** Atendimento concluído agora; cada chamada usa um horário próprio (retroativo) para não colidir. */
async function done(ctx: Ctx, staffId: string, o: { customerId?: string; services?: string[]; products?: { productId: string; quantity: number }[]; pay?: boolean; discount?: number; at?: Date } = {}) {
  slot++;
  const id = await quickAttendance(w.db, w.owner, { customerId: o.customerId ?? w.customerId, staffId, serviceIds: o.services ?? [w.serviceId], startsAt: new Date(Date.now() - slot * 3600000 * 2) });
  if (o.products) await setAttendanceProducts(w.db, w.owner, id, { items: o.products });
  if (o.discount) await applyDiscount(w.db, w.owner, id, { discountCents: o.discount, reason: "teste" });
  const sale = await saleOfAttendance(w.db, id);
  const [a] = await w.db.query<{ total_cents: number }>("select total_cents from attendances where id=$1", [id]);
  const r = await completeAttendance(w.db, w.owner, id, o.pay === false ? {} : { payments: [{ methodId: w.methods.dinheiro, amountCents: a.total_cents + (sale?.total_cents ?? 0), idempotencyKey: key() }] });
  if (o.at) {
    await w.db.query("update attendances set finished_at=$2 where id=$1", [id, o.at]);
    await w.db.query("update product_sales set finished_at=$2 where attendance_id=$1", [id, o.at]);
    await w.db.tx((q) => refreshReturn(q, w.unitId, o.customerId ?? w.customerId));
  }
  return { id, ...r };
}
const asUser = (c: Ctx, granted: string[] = [], denied: string[] = []): Ctx => ({ ...c, perms: buildPerms(c.role, [...granted.map((permission) => ({ permission, granted: true })), ...denied.map((permission) => ({ permission, granted: false }))]) });

beforeEach(async () => {
  slot = 0;
  w = await makeWorld();
  await openCash(w.db, w.owner, { declaredCents: 0 });
}, 60000);

describe("recorrência", () => {
  it("calcula cada tipo de frequência", () => {
    expect(nextAfter({ kind: "dias", n: 25 }, "2026-11-01")).toBe("2026-11-26");
    expect(nextAfter({ kind: "semanas", n: 2 }, "2026-11-01")).toBe("2026-11-15");
    expect(nextAfter({ kind: "mensal", n: 1 }, "2026-01-31")).toBe("2026-02-28");
    expect(nextAfter({ kind: "dia_semana", dow: 3, n: 1 }, "2026-11-04")).toBe("2026-11-11"); // quarta → próxima quarta
    expect(nextAfter({ kind: "ordinal", ordinal: 1, dow: 3, n: 1 }, "2026-11-04")).toBe("2026-12-02");
    expect(nextAfter({ kind: "ordinal", ordinal: -1, dow: 5, n: 1 }, "2026-11-01")).toBe("2026-11-27");
    expect(occurrences({ kind: "mensal", n: 1 }, "2026-01-31", "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(nextReturn({ kind: "dia_semana", dow: 3, n: 1 }, "2026-11-03")).toBe("2026-11-11"); // terça: não sugere o dia seguinte
  });
});

describe("permissões individuais", () => {
  it("barbeiro não acessa o financeiro geral nem comissões da equipe", async () => {
    await expect(listPayables(w.db, w.barber, {} as never)).rejects.toThrow();
    await expect(byStaff(w.db, w.barber, period)).rejects.toThrow();
    await expect(totals(w.db, asUser(w.barber, ["finance.own"]), period, w.barber2StaffId)).rejects.toThrow(/suas próprias/);
    await expect(teamOverview(w.db, w.barber, period)).rejects.toThrow();
  });
  it("muda, revoga e registra histórico; vale na próxima requisição", async () => {
    await w.db.query("insert into sessions(id,user_id,unit_id,mfa_verified,expires_at) values ($1,$2,$3,true, now() + interval '1 hour')", [(await import("node:crypto")).createHash("sha256").update("tok").digest("hex"), w.barber.userId, w.unitId]);
    await setUserPermissions(w.db, w.owner, w.barber.userId, ["agenda.view_own", "products.view", "products.sell"]);
    const s = await getSession(w.db, "tok");
    expect(s!.ctx.perms.has("products.sell")).toBe(true);
    expect(s!.ctx.perms.has("customers.view")).toBe(false);
    expect(s!.ctx.perms.has("tasks.own")).toBe(true); // sempre presente
    await setUserPermissions(w.db, w.owner, w.barber.userId, ["agenda.view_own"]);
    expect((await getSession(w.db, "tok"))!.ctx.perms.has("products.sell")).toBe(false);
    const a = await getUserAccess(w.db, w.owner, w.barber.userId);
    expect(a.history.filter((h) => h.action === "PERMISSOES_ALTERADAS").length).toBe(2);
  });
  it("gerente com permissão de usuários não concede o que não tem, nem mexe no dono ou em si", async () => {
    const m = asUser(w.manager, ["users.manage"]);
    await expect(setUserPermissions(w.db, m, w.barber.userId, ["commissions.pay"])).rejects.toThrow(/não tem/);
    await expect(setUserPermissions(w.db, m, w.owner.userId, [])).rejects.toThrow(/administrador/);
    await expect(setUserPermissions(w.db, m, m.userId, [])).rejects.toThrow(/próprias/);
    await expect(setUserPermissions(w.db, w.barber, w.barber2.userId, [])).rejects.toThrow();
  });
  it("perfil salvo é aplicado e a agenda respeita criar/editar/cancelar em separado", async () => {
    const id = await saveProfile(w.db, w.owner, { name: "Só consulta", baseRole: "tecnico", permissions: ["agenda.view_own"] });
    await applyProfile(w.db, w.owner, w.barber.userId, id);
    const noCancel = asUser(w.barber, [], ["agenda.cancel"]);
    const ap = await createAppointment(w.db, noCancel, { customerId: w.customerId, staffId: w.barberStaffId, startsAt: atLocal(addDays(today, 2), "10:00"), serviceIds: [w.serviceId] });
    await expect(cancelAppointment(w.db, noCancel, ap, "motivo")).rejects.toThrow(/não permite/);
    await expect(createAppointment(w.db, asUser(w.barber, [], ["agenda.create"]), { customerId: w.customerId, staffId: w.barberStaffId, startsAt: atLocal(addDays(today, 2), "12:00"), serviceIds: [w.serviceId] })).rejects.toThrow();
  });
  it("permissões restritivas não afetam o proprietário", () => {
    expect(buildPerms("administrador", [{ permission: "users.manage", granted: false }]).has("users.manage")).toBe(true);
  });
});

describe("tarefas", () => {
  it("delega, notifica uma vez, conclui e exige aprovação quando configurado", async () => {
    await expect(createTask(w.db, w.barber, { title: "Limpar", assignees: [w.barber.userId] })).rejects.toThrow();
    const id = await createTask(w.db, w.manager, { title: "Higienizar equipamentos", assignees: [w.barber.userId], priority: "alta", requiresApproval: true, dueDate: addDays(today, 1) });
    expect((await listNotifications(w.db, w.barber)).rows.map((n) => n.kind)).toEqual(["tarefa_atribuida"]);
    expect((await listNotifications(w.db, w.barber2)).rows).toHaveLength(0);
    await expect(getTask(w.db, w.barber2, id)).rejects.toThrow(/não tem acesso/);
    await startTask(w.db, w.barber, id);
    expect((await completeTask(w.db, w.barber, id)).status).toBe("aguardando_aprovacao");
    await expect(reviewTask(w.db, w.barber, id, true)).rejects.toThrow();
    await reviewTask(w.db, w.manager, id, false, "faltou a cadeira 2");
    expect((await getTask(w.db, w.barber, id)).task.status).toBe("em_andamento");
    await completeTask(w.db, w.barber, id);
    await reviewTask(w.db, w.manager, id, true);
    expect((await getTask(w.db, w.barber, id)).task.status).toBe("concluida");
  });
  it("individual espera todos; coletiva conclui com um", async () => {
    const ind = await createTask(w.db, w.owner, { title: "Treinamento", assignees: [w.barber.userId, w.barber2.userId], mode: "individual" });
    expect((await completeTask(w.db, w.barber, ind)).status).toBe("em_andamento");
    expect((await getTask(w.db, w.owner, ind)).assignees.filter((a) => a.status === "concluida")).toHaveLength(1);
    expect((await completeTask(w.db, w.barber2, ind)).status).toBe("concluida");
    const col = await createTask(w.db, w.owner, { title: "Inventário", assignees: [w.barber.userId, w.barber2.userId], mode: "coletiva" });
    expect((await completeTask(w.db, w.barber, col)).status).toBe("concluida");
  });
  it("recorrente gera execuções separadas e sem duplicar", async () => {
    const id = await createTask(w.db, w.owner, { title: "Conferir materiais", assignees: [w.barber.userId], dueDate: today, recurrence: { kind: "dias", n: 1 } });
    await completeTask(w.db, w.barber, id);
    expect((await runTaskJobs(w.db, w.unitId)).generated).toBe(1); // amanhã
    expect((await runTaskJobs(w.db, w.unitId)).generated).toBe(0);
    expect((await getTask(w.db, w.owner, id)).task.status).toBe("concluida");
    expect((await listTasks(w.db, w.barber)).rows).toHaveLength(1);
  });
  it("avisa atraso uma vez, menciona e bloqueia subtarefa aberta", async () => {
    const id = await createTask(w.db, w.owner, { title: "Fechamento", assignees: [w.barber.userId], dueDate: addDays(today, -1), dueTime: "10:00" });
    expect((await runTaskJobs(w.db, w.unitId)).alerts).toBe(1);
    expect((await runTaskJobs(w.db, w.unitId)).alerts).toBe(0);
    await commentTask(w.db, w.owner, id, "veja isto", [w.barber.userId]);
    expect((await listNotifications(w.db, w.barber)).rows.map((n) => n.kind)).toContain("tarefa_mencao");
    await createTask(w.db, w.owner, { title: "Parte 1", assignees: [w.barber2.userId], parentId: id });
    await expect(completeTask(w.db, w.barber, id)).rejects.toThrow(/subtarefas/);
  });
  it("editar mantém responsáveis e avisa só quem entrou", async () => {
    const id = await createTask(w.db, w.owner, { title: "Organizar", assignees: [w.barber.userId] });
    await updateTask(w.db, w.owner, id, { title: "Organizar", priority: "normal", assignees: [w.barber.userId, w.barber2.userId] });
    expect((await unreadCount(w.db, w.barber))).toBe(1);
    expect((await unreadCount(w.db, w.barber2))).toBe(1);
    await markRead(w.db, w.barber);
    expect(await unreadCount(w.db, w.barber)).toBe(0);
    expect(await unreadCount(w.db, w.barber2)).toBe(1); // leitura é por pessoa
  });
});

describe("notificações push", () => {
  it("registra entrega, falha, silêncio e não mostra valores na tela bloqueada", async () => {
    expect(safeBody("Caixa fechado com diferença de R$ 1.234,56 (motivo interno).")).toBe("Caixa fechado com diferença de valor no app.");
    await w.db.query("update notifications set pushed_at=now()");
    await saveSubscription(w.db, w.barber.userId, { endpoint: "https://p/1", keys: { p256dh: "a", auth: "b" } });
    const send = (n: number) => notifyUsers(w.db.query, { unitId: w.unitId, userIds: [w.barber.userId], kind: "tarefa_x", message: "Oi R$ 10,00", url: "/tarefas", dedupe: `t${n}` });
    await send(1);
    expect(await notifyUsers(w.db.query, { unitId: w.unitId, userIds: [w.barber.userId], kind: "tarefa_x", message: "Oi", url: "/", dedupe: "t1" })).toBe(0);
    await flushPush(w.db, async () => { throw Object.assign(new Error("fora"), { statusCode: 500 }); });
    await send(2);
    const bodies: string[] = [];
    await flushPush(w.db, async (_s, p) => { bodies.push(p.body); });
    await savePrefs(w.db, w.barber.userId, { notify: { tarefas: false } });
    await send(3);
    await flushPush(w.db, async () => { throw new Error("não deveria enviar"); });
    expect(bodies).toEqual(["Oi valor no app"]);
    expect((await w.db.query<{ status: string }>("select status from notification_deliveries order by created_at")).map((r) => r.status)).toEqual(["falha", "enviado", "silenciado"]);
    expect((await listNotifications(w.db, w.barber)).rows).toHaveLength(3); // a central guarda tudo, com ou sem push
  });
});

describe("produtos e estoque", () => {
  let pomada: string, shampoo: string;
  beforeEach(async () => {
    pomada = await saveProduct(w.db, w.owner, { name: "Pomada", priceCents: 4500, trackStock: true, minStock: 1, commissionEnabled: true });
    shampoo = await saveProduct(w.db, w.owner, { name: "Shampoo", priceCents: 3500, trackStock: true, minStock: 0, commissionEnabled: false });
    for (const productId of [pomada, shampoo]) await adjustStock(w.db, w.owner, { productId, kind: "entrada", quantity: 5, note: "compra" });
  });
  const stock = async (id: string) => (await w.db.query<{ stock_qty: number }>("select stock_qty from products where id=$1", [id]))[0].stock_qty;

  it("serviço + produtos: uma cobrança, receitas separadas e estoque baixado", async () => {
    const a = await done(w.owner, w.barberStaffId, { products: [{ productId: pomada, quantity: 1 }, { productId: shampoo, quantity: 1 }] });
    const [r] = await w.db.query<{ amount_due_cents: number }>("select amount_due_cents from receivables where id=$1", [a.receivableId]);
    expect(r.amount_due_cents).toBe(6000 + 8000);
    expect(await stock(pomada)).toBe(4);
    const dre = await computeDre(w.db.query, w.unitId, period);
    expect(dre.grossRevenue).toBe(6000);
    expect(dre.lines.find((l) => l.key === "products_gross")!.cents).toBe(8000);
    expect(dre.netRevenue).toBe(14000);
    expect(dre.otherRevenue).toBe(0);
  });
  it("estoque insuficiente bloqueia e nada é gravado", async () => {
    await expect(sellProducts(w.db, w.owner, { staffId: w.barberStaffId, items: [{ productId: pomada, quantity: 9 }], idempotencyKey: key() })).rejects.toThrow(/Estoque insuficiente/);
    const id = await quickAttendance(w.db, w.owner, { customerId: w.customerId, staffId: w.barberStaffId, serviceIds: [w.serviceId] });
    await setAttendanceProducts(w.db, w.owner, id, { items: [{ productId: pomada, quantity: 5 }] });
    await adjustStock(w.db, w.owner, { productId: pomada, kind: "perda", quantity: 2, note: "quebra" });
    await expect(completeAttendance(w.db, w.owner, id)).rejects.toThrow(/Estoque insuficiente/);
    expect((await w.db.query("select 1 from receivables")).length).toBe(0);
    expect(await stock(pomada)).toBe(3);
  });
  it("venda avulsa é idempotente, com desconto e permissão", async () => {
    const k = key();
    const i = { staffId: w.barberStaffId, items: [{ productId: pomada, quantity: 2 }], discountCents: 1000, discountReason: "cliente fiel", idempotencyKey: k };
    const a = await sellProducts(w.db, w.owner, i), b = await sellProducts(w.db, w.owner, i);
    expect(b.duplicate).toBe(true);
    expect(b.saleId).toBe(a.saleId);
    expect(await stock(pomada)).toBe(3);
    await expect(sellProducts(w.db, w.barber, { staffId: w.barberStaffId, items: [{ productId: pomada, quantity: 1 }], idempotencyKey: key() })).rejects.toThrow();
    const seller = asUser(w.barber, ["products.sell"]);
    await expect(sellProducts(w.db, seller, { staffId: w.barber2StaffId, items: [{ productId: pomada, quantity: 1 }], idempotencyKey: key() })).rejects.toThrow(/seu nome/);
    await expect(sellProducts(w.db, seller, { staffId: w.barberStaffId, items: [{ productId: pomada, quantity: 1 }], discountCents: 100, discountReason: "xxx", idempotencyKey: key() })).rejects.toThrow(/administrador/);
    const dre = await computeDre(w.db.query, w.unitId, period);
    expect(dre.netRevenue).toBe(8000);
  });
  it("devolução parcial estorna a diferença, repõe o estoque e reduz a comissão", async () => {
    await saveRule(w.db, w.owner, { scope: "produto", productId: pomada, pctBps: 1000, base: "liquido", validFrom: today });
    const s = await sellProducts(w.db, w.owner, { staffId: w.barberStaffId, items: [{ productId: pomada, quantity: 2 }], payments: [{ methodId: w.methods.dinheiro, amountCents: 9000, idempotencyKey: key() }], idempotencyKey: key() });
    const [it] = await w.db.query<{ id: string }>("select id from product_sale_items where sale_id=$1", [s.saleId]);
    const k = key();
    await returnProduct(w.db, w.owner, { saleItemId: it.id, quantity: 1, restock: true, reason: "defeito", idempotencyKey: k });
    expect((await returnProduct(w.db, w.owner, { saleItemId: it.id, quantity: 1, restock: true, reason: "defeito", idempotencyKey: k })).duplicate).toBe(true);
    expect(await stock(pomada)).toBe(4);
    const [b] = await w.db.query<{ amount_due_cents: number; registered_cents: number }>("select amount_due_cents, registered_cents from receivable_balances where receivable_id=$1", [s.receivableId]);
    expect(b).toEqual({ amount_due_cents: 4500, registered_cents: 4500 });
    const t = await totals(w.db, w.owner, period, w.barberStaffId);
    expect(t.generated).toBe(900);
    expect(t.adjustments).toBe(-450);
    expect((await computeDre(w.db.query, w.unitId, period)).netRevenue).toBe(4500);
    await expect(returnProduct(w.db, w.owner, { saleItemId: it.id, quantity: 2, restock: true, reason: "outra", idempotencyKey: key() })).rejects.toThrow(/Só restam/);
    await expect(cancelReceivable(w.db, w.owner, s.receivableId, "teste")).rejects.toThrow();
  });
});

describe("comissões", () => {
  it("aplica a regra mais específica e guarda o que usou", async () => {
    await saveRule(w.db, w.owner, { scope: "servico", pctBps: 3000, base: "bruto", validFrom: today });
    await saveRule(w.db, w.owner, { scope: "servico", staffId: w.barberStaffId, pctBps: 4000, base: "bruto", validFrom: today });
    await saveRule(w.db, w.owner, { scope: "servico", staffId: w.barberStaffId, serviceId: w.service2Id, pctBps: 5000, base: "liquido", validFrom: today });
    await done(w.owner, w.barberStaffId, { services: [w.serviceId, w.service2Id], discount: 1000 });
    await done(w.owner, w.barber2StaffId);
    await done(w.owner, w.ownerStaffId); // dono não gera comissão pela regra geral
    const e = (await listEntries(w.db, w.owner, { period })).rows;
    expect(e).toHaveLength(3);
    const corte = e.find((x) => x.description === "Corte" && x.pct_bps === 4000)!, barba = e.find((x) => x.description === "Barba")!;
    expect(corte.amount_cents).toBe(2400);
    expect(barba.base_cents).toBe(3600); // 4000 − 40% do desconto de 1000
    expect(barba.amount_cents).toBe(1800);
    expect(e.find((x) => x.pct_bps === 3000)!.amount_cents).toBe(1800);
  });
  it("mudar o percentual não altera comissões já geradas", async () => {
    await saveRule(w.db, w.owner, { scope: "servico", pctBps: 3000, base: "bruto", validFrom: today });
    await done(w.owner, w.barberStaffId);
    await saveRule(w.db, w.owner, { scope: "servico", pctBps: 1000, base: "bruto", validFrom: today });
    await done(w.owner, w.barberStaffId);
    expect((await listEntries(w.db, w.owner, { period })).rows.map((x) => x.amount_cents).sort((a, b) => a - b)).toEqual([600, 1800]);
    await expect(saveRule(w.db, w.owner, { scope: "servico", pctBps: 1000, base: "bruto", validFrom: addDays(today, -1) })).rejects.toThrow(/passado/);
    await expect(saveRule(w.db, w.manager, { scope: "servico", pctBps: 1000, base: "bruto", validFrom: today })).rejects.toThrow();
  });
  it("sem regra não há comissão; exigível só com recebimento conferido", async () => {
    await done(w.owner, w.barberStaffId);
    await saveRule(w.db, w.owner, { scope: "servico", pctBps: 5000, base: "bruto", validFrom: today });
    const a = await done(w.owner, w.barberStaffId, { pay: false });
    let t = await totals(w.db, w.owner, period);
    expect(t).toMatchObject({ generated: 3000, pending: 3000, due: 0 });
    await expect(approveSettlement(w.db, w.owner, { staffId: w.barberStaffId, period })).rejects.toThrow(/exigíveis/);
    const { registerPayment } = await import("./services/payments");
    const p = await registerPayment(w.db, w.owner, { receivableId: a.receivableId, methodId: w.methods.pix, amountCents: 6000, idempotencyKey: key() });
    expect((await totals(w.db, w.owner, period)).due).toBe(0); // registrado ainda não conferido
    await confirmPayment(w.db, w.owner, p.id, "extrato");
    t = await totals(w.db, w.owner, period);
    expect(t).toMatchObject({ pending: 0, due: 3000 });
  });
  it("repasse: aprova, paga parcial, é custo na DRE, aparece para o barbeiro e não duplica", async () => {
    await saveRule(w.db, w.owner, { scope: "servico", pctBps: 5000, base: "bruto", validFrom: today });
    const a = await done(w.owner, w.barberStaffId);
    await done(w.owner, w.barberStaffId);
    const id = await approveSettlement(w.db, w.owner, { staffId: w.barberStaffId, period });
    await expect(approveSettlement(w.db, w.owner, { staffId: w.barberStaffId, period })).rejects.toThrow();
    const dre = await computeDre(w.db.query, w.unitId, period);
    expect(dre.netRevenue).toBe(12000);
    expect(dre.variableCosts).toBe(6000);
    const k = key();
    const pay = { id, amountCents: 2000, accountId: w.accounts.caixa, idempotencyKey: k };
    await paySettlement(w.db, w.owner, pay);
    expect((await paySettlement(w.db, w.owner, pay)).duplicate).toBe(true);
    const tech = asUser(w.barber, ["finance.own"]);
    let [s] = await listSettlements(w.db, tech);
    expect(s).toMatchObject({ state: "parcial", paid_cents: 2000, total_cents: 6000 });
    await expect(cancelSettlement(w.db, w.owner, id, "engano")).rejects.toThrow(/pagamento/);
    await expect(paySettlement(w.db, w.owner, { ...pay, amountCents: 5000, idempotencyKey: key() })).rejects.toThrow();
    await paySettlement(w.db, w.owner, { ...pay, amountCents: 4000, idempotencyKey: key() });
    [s] = await listSettlements(w.db, tech);
    expect(s.state).toBe("pago");
    expect(await listSettlements(w.db, asUser(w.barber2, ["finance.own"]))).toHaveLength(0);
    await expect(paySettlement(w.db, w.manager, pay)).rejects.toThrow();
    const [pb] = await w.db.query<{ payable_id: string }>("select payable_id from commission_settlements where id=$1", [id]);
    await expect(cancelPayable(w.db, w.owner, pb.payable_id, "teste")).rejects.toThrow();
    // estorno do recebimento depois do repasse vira divergência visível
    const [p] = await w.db.query<{ id: string }>("select id from payments where receivable_id=$1 and kind='recebimento'", [a.receivableId]);
    await reversePayment(w.db, w.owner, p.id, "cliente devolveu");
    expect(await divergences(w.db, w.owner)).toHaveLength(1);
    // e o cancelamento da cobrança gera ajuste negativo
    await cancelReceivable(w.db, w.owner, a.receivableId, "cancelada");
    expect((await totals(w.db, w.owner, period, w.barberStaffId)).adjustments).toBe(-3000);
  });
  it("cancelar cobrança cancela a comissão pendente; repasse sem pagamento pode ser desfeito", async () => {
    await saveRule(w.db, w.owner, { scope: "servico", pctBps: 5000, base: "bruto", validFrom: today });
    const a = await done(w.owner, w.barberStaffId, { pay: false });
    await cancelReceivable(w.db, w.owner, a.receivableId, "cortesia");
    expect((await listEntries(w.db, w.owner, { period })).rows[0].state).toBe("cancelada");
    await done(w.owner, w.barberStaffId);
    const id = await approveSettlement(w.db, w.owner, { staffId: w.barberStaffId, period });
    await cancelSettlement(w.db, w.owner, id, "refazer");
    expect((await totals(w.db, w.owner, period, w.barberStaffId)).due).toBe(3000);
    expect((await computeDre(w.db.query, w.unitId, period)).variableCosts).toBe(0);
  });
});

describe("retornos", () => {
  const row = async (id = w.customerId) => (await listReturns(w.db, w.owner, {})).rows.find((r) => r.customer_id === id)!;
  const visited = (days: number, customerId = w.customerId) => done(w.owner, w.barberStaffId, { customerId, at: atLocal(addDays(today, -days), "12:00") });

  it("regra padrão de 25 dias a partir do atendimento concluído", async () => {
    await visited(25);
    expect(await row()).toMatchObject({ due_date: today, bucket: "vencido", rule_source: "padrao", staff_name: "Barbeiro Um" });
    await visited(22, w.customer2Id);
    expect((await row(w.customer2Id)).bucket).toBe("proximo");
  });
  it.each([
    ["semanal", { kind: "semanas", n: 1 }, 7], ["quinzenal", { kind: "dias", n: 15 }, 15], ["personalizada", { kind: "dias", n: 40 }, 40],
  ] as const)("regra %s do cliente vale acima do padrão", async (_n, rule, days) => {
    await visited(5);
    await saveReturnRule(w.db, w.owner, { customerId: w.customerId, staffId: w.barberStaffId, rule: { kind: "dias", n: 99 } });
    expect((await row()).rule_source).toBe("profissional");
    await saveReturnRule(w.db, w.owner, { customerId: w.customerId, rule });
    expect(await row()).toMatchObject({ rule_source: "cliente", due_date: addDays(today, days - 5) });
  });
  it("regra mensal e sem acompanhamento", async () => {
    await visited(5);
    await saveReturnRule(w.db, w.owner, { customerId: w.customerId, rule: { kind: "mensal", n: 1 } });
    expect((await row()).due_date).toBe(nextAfter({ kind: "mensal", n: 1 }, addDays(today, -5)));
    await saveReturnRule(w.db, w.owner, { customerId: w.customerId, rule: null, noFollow: true });
    expect((await row()).bucket).toBe("sem_acompanhamento");
  });
  it("agendamento antecipado tira da lista; cancelado volta a contar do atendimento real", async () => {
    await visited(30);
    expect((await row()).bucket).toBe("vencido");
    const ap = await createAppointment(w.db, w.owner, { customerId: w.customerId, staffId: w.barberStaffId, startsAt: atLocal(addDays(today, 3), "10:00"), serviceIds: [w.serviceId] });
    expect((await row()).bucket).toBe("agendado");
    await cancelAppointment(w.db, w.owner, ap, "desistiu");
    expect(await row()).toMatchObject({ bucket: "vencido", due_date: addDays(today, -5) });
    await done(w.owner, w.barberStaffId);
    expect(await row()).toMatchObject({ bucket: "em_dia", due_date: addDays(today, 25) });
  });
  it("contato exige registro explícito, respeita intervalo, adiamento e oposição", async () => {
    await visited(40);
    await registerContact(w.db, w.barber, { customerId: w.customerId, outcome: "sem_resposta", idempotencyKey: key() });
    expect((await row()).bucket).toBe("contatado");
    await expect(registerContact(w.db, w.barber, { customerId: w.customerId, outcome: "contatado", idempotencyKey: key() })).rejects.toThrow(/menos de 7/);
    await w.db.query("update customer_return_status set last_contact_at=now() - interval '8 days'");
    expect((await row()).bucket).toBe("vencido");
    await snoozeReturn(w.db, w.barber, w.customerId, addDays(today, 5));
    expect((await row()).bucket).toBe("contatado");
    await w.db.query("update customer_return_status set snoozed_until=$1::date - 1", [today]);
    await registerContact(w.db, w.barber, { customerId: w.customerId, outcome: "contatado", idempotencyKey: key() }); // novo contato após o adiamento
    await saveContactPrefs(w.db, w.owner, { customerId: w.customerId, optOut: true, channel: "whatsapp" });
    expect((await row()).bucket).toBe("recusou");
    await expect(registerContact(w.db, w.barber, { customerId: w.customerId, outcome: "contatado", idempotencyKey: key() })).rejects.toThrow(/não receber/);
  });
  it("barbeiro só vê os seus; rotina avisa uma vez", async () => {
    await visited(40);
    expect((await listReturns(w.db, w.barber2, {})).rows).toHaveLength(0);
    await expect(registerContact(w.db, w.barber2, { customerId: w.customerId, outcome: "contatado", idempotencyKey: key() })).rejects.toThrow(/outro profissional/);
    expect((await runReturnJobs(w.db, w.unitId)).notified).toBe(1);
    expect((await runReturnJobs(w.db, w.unitId)).notified).toBe(0);
    expect((await listNotifications(w.db, w.barber)).rows.filter((n) => n.kind === "retorno_vencido")).toHaveLength(1);
  });
});

describe("agenda: calendário e séries", () => {
  const d1 = addDays(today, 7);
  const base = () => ({ customerId: w.customerId, staffId: w.barberStaffId, serviceIds: [w.serviceId], rule: { kind: "semanas" as const, n: 1 }, time: "10:00", startDate: d1, maxOccurrences: 4, confirmed: true, confirmedNote: "WhatsApp do cliente" });
  const apps = (status = "agendado") => w.db.query<{ id: string; starts_at: Date; series_id: string; staff_id: string }>("select id, starts_at, series_id, staff_id from appointments where status=$1 order by starts_at", [status]);

  it("arrastar e redimensionar validam conflito e permissão", async () => {
    const a = await createAppointment(w.db, w.owner, { customerId: w.customerId, staffId: w.barberStaffId, startsAt: atLocal(d1, "10:00"), serviceIds: [w.serviceId] });
    await createAppointment(w.db, w.owner, { customerId: w.customer2Id, staffId: w.barberStaffId, startsAt: atLocal(d1, "11:00"), serviceIds: [w.serviceId] });
    await rescheduleAppointment(w.db, w.barber, a, { startsAt: atLocal(d1, "10:00"), minutes: 60 });
    await expect(rescheduleAppointment(w.db, w.barber, a, { startsAt: atLocal(d1, "10:00"), minutes: 75 })).rejects.toThrow(/já (tem|está)/);
    await expect(rescheduleAppointment(w.db, w.barber2, a, { startsAt: atLocal(d1, "15:00") })).rejects.toThrow();
    await expect(rescheduleAppointment(w.db, w.barber, a, { startsAt: atLocal(d1, "15:00"), staffId: w.barber2StaffId })).rejects.toThrow();
  });
  it("só reserva com confirmação, sem duplicar, e registra conflitos", async () => {
    await expect(createSeries(w.db, w.owner, { ...base(), confirmed: false })).rejects.toThrow(/confirmação/);
    await createAppointment(w.db, w.owner, { customerId: w.customer2Id, staffId: w.barberStaffId, startsAt: atLocal(addDays(d1, 7), "10:00"), serviceIds: [w.serviceId] });
    const r = await createSeries(w.db, w.owner, base());
    expect(r.created).toBe(3);
    expect(r.conflicts).toEqual([expect.objectContaining({ date: addDays(d1, 7) })]);
    expect((await extendSeries(w.db, w.owner, r.id)).created).toBe(0);
  });
  it("edita uma, esta e as seguintes, e cancela a série sem tocar no passado", async () => {
    const r = await createSeries(w.db, w.owner, base());
    expect(r.created).toBe(4);
    let a = await apps();
    await rescheduleAppointment(w.db, w.owner, a[0].id, { startsAt: atLocal(d1, "14:00") }); // só esta
    expect((await updateSeries(w.db, w.owner, { appointmentId: a[2].id, scope: "seguintes", date: addDays(toYmd(a[2].starts_at), 1), time: "16:00" })).changed).toBe(2);
    a = await apps();
    expect(a.map((x) => x.starts_at.getTime())).toEqual([atLocal(d1, "14:00"), atLocal(addDays(d1, 7), "10:00"), atLocal(addDays(d1, 15), "16:00"), atLocal(addDays(d1, 22), "16:00")].map((x) => x.getTime()));
    expect(new Set(a.map((x) => x.series_id)).size).toBe(2);
    expect((await extendSeries(w.db, w.owner, a[3].series_id)).created).toBe(0);
    expect((await extendSeries(w.db, w.owner, a[0].series_id)).created).toBe(0);
    expect((await cancelSeries(w.db, w.owner, { appointmentId: a[3].id, scope: "todas", reason: "mudou de cidade" })).cancelled).toBe(2);
    expect(await apps()).toHaveLength(2);
  });
  it("conflito ao editar a série desfaz tudo", async () => {
    await createSeries(w.db, w.owner, base());
    await createAppointment(w.db, w.owner, { customerId: w.customer2Id, staffId: w.barberStaffId, startsAt: atLocal(addDays(d1, 14), "16:00"), serviceIds: [w.serviceId] });
    const before = await apps();
    await expect(updateSeries(w.db, w.owner, { appointmentId: before[0].id, scope: "todas", date: d1, time: "16:00" })).rejects.toThrow();
    expect((await apps()).map((x) => x.starts_at.getTime())).toEqual(before.map((x) => x.starts_at.getTime()));
  });
});

describe("conquistas", () => {
  const at = (ymd: string) => atLocal(ymd, "12:00");
  it("primeiro recorde é silencioso; superar avisa uma vez e mostra o anterior", async () => {
    await done(w.owner, w.barberStaffId, { at: at(addDays(today, -1)) });
    await processEvents(w.db);
    expect((await listNotifications(w.db, w.barber)).rows.filter((n) => n.kind === "recorde_pessoal")).toHaveLength(0);
    await done(w.owner, w.barberStaffId);
    await done(w.owner, w.barberStaffId);
    await processEvents(w.db);
    const n = (await listNotifications(w.db, w.barber)).rows.filter((x) => x.kind === "recorde_pessoal");
    expect(n.some((x) => /Maior faturamento diário/.test(x.message))).toBe(true);
    expect(await processEvents(w.db)).toEqual({ processed: 0, failed: 0 });
    const a = await getAchievements(w.db, w.barber);
    expect(a.cards.find((c) => c.def.metric === "faturamento_dia")).toMatchObject({ record: { value: 12000 }, previous: 6000 });
  });
  it("semana e mês em aberto ficam provisórios; fechados valem", async () => {
    await done(w.owner, w.barberStaffId);
    await w.db.tx((q) => evaluateRecords(q, w.unitId, w.barberStaffId));
    const c = (await getAchievements(w.db, w.barber)).cards.find((x) => x.def.metric === "faturamento_mes")!;
    expect(c.record).toBeNull();
    expect(c.provisional).toBe(true);
    await w.db.tx((q) => evaluateRecords(q, w.unitId, w.barberStaffId, addDays(today, 45)));
    const r = await w.db.query<{ metric: string }>("select metric from employee_records");
    expect(r.map((x) => x.metric)).toEqual(expect.arrayContaining(["faturamento_mes", "faturamento_semana"]));
  });
  it("cancelamento da cobrança corrige o recorde sem apagar o histórico", async () => {
    await done(w.owner, w.barberStaffId, { at: at(addDays(today, -1)) });
    await processEvents(w.db);
    await done(w.owner, w.barberStaffId, { pay: false });
    const x = await done(w.owner, w.barberStaffId, { pay: false });
    await processEvents(w.db);
    await cancelReceivable(w.db, w.owner, x.receivableId, "engano");
    await processEvents(w.db);
    const [r] = await w.db.query<{ value: number }>("select value from employee_records where metric='faturamento_dia'");
    expect(r.value).toBe(6000);
    expect((await w.db.query("select 1 from audit_logs where action='RECORDE_CORRIGIDO'")).length).toBeGreaterThan(0);
  });
  it("é privado: outro barbeiro não consulta", async () => {
    await expect(getAchievements(w.db, w.barber2, w.barberStaffId)).rejects.toThrow();
  });
});

describe("equipe, metas, busca, rotina e backup", () => {
  it("meta individual não muda comissão; estatística separa produção de remuneração", async () => {
    await saveRule(w.db, w.owner, { scope: "servico", pctBps: 5000, base: "bruto", validFrom: today });
    await done(w.owner, w.barberStaffId);
    await saveStaffGoal(w.db, w.owner, { staffId: w.barberStaffId, metric: "atendimentos", month: today.slice(0, 7), target: 10 });
    const tech = asUser(w.barber, ["finance.own"]);
    expect((await staffGoals(w.db, tech, w.barberStaffId, today.slice(0, 7)))[0]).toMatchObject({ value: 1, pct: 10 });
    expect((await staffStats(w.db, tech, period)).services).toBe(6000);
    expect((await totals(w.db, tech, period)).generated).toBe(3000);
    expect((await teamOverview(w.db, w.owner, period)).find((r) => r.staff_id === w.barberStaffId)).toMatchObject({ n: 1, services: 6000 });
    await expect(staffStats(w.db, tech, period, w.barber2StaffId)).rejects.toThrow();
  });
  it("busca respeita permissões", async () => {
    expect((await search(w.db, w.owner, "cliente")).length).toBe(2);
    expect(await search(w.db, asUser(w.barber, [], ["customers.view"]), "cliente")).toHaveLength(0);
  });
  it("rotina diária roda todos os módulos e é idempotente", async () => {
    await done(w.owner, w.barberStaffId);
    expect((await runDailyJobs(w.db, w.unitId)).skipped).toBe(false);
    expect((await runDailyJobs(w.db, w.unitId)).skipped).toBe(true);
  });
  it("backup inclui a V4 e restaura em banco vazio", async () => {
    await saveRule(w.db, w.owner, { scope: "servico", pctBps: 5000, base: "bruto", validFrom: today });
    const p = await saveProduct(w.db, w.owner, { name: "Óleo", priceCents: 3000, trackStock: false, minStock: 0, commissionEnabled: false });
    await done(w.owner, w.barberStaffId, { products: [{ productId: p, quantity: 1 }] });
    await approveSettlement(w.db, w.owner, { staffId: w.barberStaffId, period });
    await createTask(w.db, w.owner, { title: "Tarefa", assignees: [w.barber.userId] });
    await setUserPermissions(w.db, w.owner, w.barber.userId, ["agenda.view_own"]);
    const b = await exportBackup(w.db, w.owner);
    const other = await createDb({ dataDir: "memory://" });
    await restoreBackup(other, b.json, "dono@teste.com", "SenhaNova12345");
    for (const t of ["commission_entries", "product_sales", "tasks", "customer_return_status", "permission_overrides", "commission_settlements"]) {
      const [x] = await w.db.query<{ n: number }>(`select count(*)::bigint as n from ${t}`), [y] = await other.query<{ n: number }>(`select count(*)::bigint as n from ${t}`);
      expect([t, y.n]).toEqual([t, x.n]);
    }
  }, 60000);
});
void beforeAll;
