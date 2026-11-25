import { describe, it, expect, beforeAll } from "vitest";
import { makeWorld, future, key, type World } from "./testkit";
import { createAppointment, cancelAppointment, rescheduleAppointment, listAppointments, markNoShow } from "./services/agenda";
import { startAttendance, completeAttendance, applyDiscount, getAttendance, quickAttendance } from "./services/attendance";
import { registerPayment, confirmPayment, settlePayment, reversePayment, getReceivable, listReceivables } from "./services/payments";
import { openCash, closeCash, addCashMovement, expectedByMethod, findOpenSession } from "./services/cash";
import { setServicePrice, updateSettings } from "./services/catalog";
import { listPayables } from "./services/finance";

let w: World;
beforeAll(async () => {
  w = await makeWorld();
});

const msg = async (p: Promise<unknown>) => p.then(() => "OK", (e) => (e as Error).message);

describe("agenda", () => {
  it("barra conflito de cadeira e de profissional, inclusive sobreposição parcial", async () => {
    const t = future(48);
    await createAppointment(w.db, w.owner, { customerId: w.customerId, staffId: w.barberStaffId, chairId: w.chairs[0], startsAt: t, serviceIds: [w.serviceId] });
    // mesma cadeira, outro barbeiro, sobreposição parcial
    expect(await msg(createAppointment(w.db, w.owner, { customerId: w.customer2Id, staffId: w.barber2StaffId, chairId: w.chairs[0], startsAt: new Date(t.getTime() + 15 * 60000), serviceIds: [w.serviceId] }))).toMatch(/Cadeira 1 já está ocupada/);
    // mesmo barbeiro, outra cadeira
    expect(await msg(createAppointment(w.db, w.owner, { customerId: w.customer2Id, staffId: w.barberStaffId, chairId: w.chairs[1], startsAt: new Date(t.getTime() + 15 * 60000), serviceIds: [w.serviceId] }))).toMatch(/já tem atendimento/);
    // outro barbeiro + outra cadeira: ok
    await createAppointment(w.db, w.owner, { customerId: w.customer2Id, staffId: w.barber2StaffId, chairId: w.chairs[1], startsAt: t, serviceIds: [w.serviceId] });
    // sem cadeira informada e ambas ocupadas
    expect(await msg(createAppointment(w.db, w.owner, { customerId: w.customerId, staffId: w.ownerStaffId, startsAt: t, serviceIds: [w.serviceId] }))).toMatch(/ocupada/);
  });

  it("duas tentativas simultâneas no mesmo horário: apenas uma vence", async () => {
    const t = future(72);
    const r = await Promise.allSettled([
      createAppointment(w.db, w.owner, { customerId: w.customerId, staffId: w.barberStaffId, chairId: w.chairs[0], startsAt: t, serviceIds: [w.serviceId] }),
      createAppointment(w.db, w.manager, { customerId: w.customer2Id, staffId: w.barber2StaffId, chairId: w.chairs[0], startsAt: t, serviceIds: [w.serviceId] }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
  });

  it("barbeiro só mexe na própria agenda; cancelar exige motivo e libera o horário", async () => {
    const t = future(96);
    expect(await msg(createAppointment(w.db, w.barber, { customerId: w.customerId, staffId: w.barber2StaffId, chairId: w.chairs[0], startsAt: t, serviceIds: [w.serviceId] }))).toMatch(/própria agenda/);
    const id = await createAppointment(w.db, w.barber, { customerId: w.customerId, staffId: w.barberStaffId, chairId: w.chairs[0], startsAt: t, serviceIds: [w.serviceId] });
    expect(await msg(cancelAppointment(w.db, w.barber, id, ""))).toMatch(/Motivo/);
    await cancelAppointment(w.db, w.barber, id, "Cliente desmarcou");
    await createAppointment(w.db, w.owner, { customerId: w.customer2Id, staffId: w.barberStaffId, chairId: w.chairs[0], startsAt: t, serviceIds: [w.serviceId] });
  });

  it("não agenda no passado sem permissão retroativa; barbeiro não vê agenda alheia", async () => {
    expect(await msg(createAppointment(w.db, w.barber, { customerId: w.customerId, staffId: w.barberStaffId, chairId: w.chairs[0], startsAt: future(-5), serviceIds: [w.serviceId] }))).toMatch(/passado/);
    const range = { from: future(-1), to: future(500) };
    const mine = await listAppointments(w.db, w.barber, range);
    expect(mine.every((a) => a.staff_id === w.barberStaffId)).toBe(true);
    const all = await listAppointments(w.db, w.owner, range);
    expect(all.length).toBeGreaterThan(mine.length);
  });

  it("reagendar valida conflito", async () => {
    const t = future(120);
    const a = await createAppointment(w.db, w.owner, { customerId: w.customerId, staffId: w.barberStaffId, chairId: w.chairs[0], startsAt: t, serviceIds: [w.serviceId] });
    await createAppointment(w.db, w.owner, { customerId: w.customer2Id, staffId: w.barber2StaffId, chairId: w.chairs[1], startsAt: future(121), serviceIds: [w.serviceId] });
    expect(await msg(rescheduleAppointment(w.db, w.owner, a, { startsAt: future(121), chairId: w.chairs[1] }))).toMatch(/ocupada/);
    await rescheduleAppointment(w.db, w.owner, a, { startsAt: future(130) });
  });
});

describe("ausências", () => {
  it("só marca ausência depois do horário; política pode cobrar taxa (e vira cobrança avulsa)", async () => {
    const future1 = await createAppointment(w.db, w.owner, { customerId: w.customerId, staffId: w.ownerStaffId, chairId: w.chairs[0], startsAt: future(200), serviceIds: [w.serviceId] });
    expect(await msg(markNoShow(w.db, w.owner, future1))).toMatch(/ainda não passou/);
    const past = await createAppointment(w.db, w.owner, { customerId: w.customerId, staffId: w.ownerStaffId, chairId: w.chairs[0], startsAt: future(-100), serviceIds: [w.serviceId] });
    await markNoShow(w.db, w.owner, past);
    expect(await msg(markNoShow(w.db, w.owner, past))).toMatch(/Agendado/);
    const none = await w.db.query<{ n: number }>("select count(*)::bigint as n from receivables where description like 'Taxa%'");
    expect(none[0].n).toBe(0); // padrão: apenas registrar
    await updateSettings(w.db, w.owner, { no_show_policy: "cobrar_taxa", no_show_fee_cents: 1500 });
    const past2 = await createAppointment(w.db, w.owner, { customerId: w.customer2Id, staffId: w.ownerStaffId, chairId: w.chairs[0], startsAt: future(-90), serviceIds: [w.serviceId] });
    await markNoShow(w.db, w.owner, past2);
    const fee = await w.db.query<{ amount_due_cents: number }>("select amount_due_cents from receivables where description like 'Taxa%'");
    expect(fee).toHaveLength(1);
    expect(fee[0].amount_due_cents).toBe(1500);
    // o horário da ausência volta a ficar livre para novo agendamento
    await createAppointment(w.db, w.owner, { customerId: w.customerId, staffId: w.ownerStaffId, chairId: w.chairs[0], startsAt: future(-90), serviceIds: [w.serviceId] });
  });
});

describe("atendimento, cobrança e caixa", () => {
  it("concluir sem pagamento gera cobrança pendente (uma única vez)", async () => {
    const att = await quickAttendance(w.db, w.owner, { customerId: w.customerId, staffId: w.ownerStaffId, serviceIds: [w.serviceId, w.service2Id], startsAt: future(-20) });
    const { receivableId } = await completeAttendance(w.db, w.owner, att);
    const { receivable } = await getReceivable(w.db, w.owner, receivableId);
    expect(receivable.amount_due_cents).toBe(10000);
    expect(receivable.pay_status).toBe("pendente");
    expect(await msg(completeAttendance(w.db, w.owner, att))).toMatch(/já foi concluído/);
    const n = await w.db.query<{ n: number }>("select count(*) as n from receivables where attendance_id=$1", [att]);
    expect(n[0].n).toBe(1);
  });

  it("pagamento: dinheiro exige caixa; pix nasce registrado; confirmar exige evidência; liquidar depois", async () => {
    const att = await quickAttendance(w.db, w.owner, { customerId: w.customer2Id, staffId: w.barber2StaffId, serviceIds: [w.serviceId, w.service2Id], startsAt: future(-19) });
    const { receivableId } = await completeAttendance(w.db, w.owner, att);
    expect(await msg(registerPayment(w.db, w.owner, { receivableId, methodId: w.methods.dinheiro, amountCents: 1000, idempotencyKey: key() }))).toMatch(/Abra o caixa/);

    const cashId = await openCash(w.db, w.owner, { declaredCents: 5000 });
    expect(await msg(openCash(w.db, w.owner, { declaredCents: 0 }))).toMatch(/Já existe um caixa aberto/);
    const k1 = key();
    const p1 = await registerPayment(w.db, w.owner, { receivableId, methodId: w.methods.dinheiro, amountCents: 3000, idempotencyKey: k1 });
    const again = await registerPayment(w.db, w.owner, { receivableId, methodId: w.methods.dinheiro, amountCents: 3000, idempotencyKey: k1 });
    expect(again.duplicate).toBe(true);
    expect(again.id).toBe(p1.id);
    const pix = await registerPayment(w.db, w.owner, { receivableId, methodId: w.methods.pix, amountCents: 5000, idempotencyKey: key(), reference: "E2E123" });

    expect(await msg(registerPayment(w.db, w.owner, { receivableId, methodId: w.methods.pix, amountCents: 5000, idempotencyKey: key() }))).toMatch(/excede o saldo/);

    let r = (await getReceivable(w.db, w.owner, receivableId)).receivable;
    expect(r.pay_status).toBe("parcialmente_recebido");
    expect(r.registered_cents).toBe(8000);
    expect(r.confirmed_cents).toBe(3000); // pix ainda não confirmado
    expect(r.conc_status).toBe("parcialmente_conciliado");

    expect(await msg(confirmPayment(w.db, w.owner, pix.id, ""))).toMatch(/Evidência/);
    expect(await msg(settlePayment(w.db, w.owner, pix.id))).toMatch(/Confirme o pagamento/);
    await confirmPayment(w.db, w.owner, pix.id, "Extrato 22/11 linha 14");
    await settlePayment(w.db, w.owner, pix.id);
    r = (await getReceivable(w.db, w.owner, receivableId)).receivable;
    expect(r.confirmed_cents).toBe(8000);
    expect(r.settled_cents).toBe(5000);

    // fechamento de caixa
    const totals = await expectedByMethod(w.db.query, cashId);
    expect(totals.find((t) => t.kind === "dinheiro")!.expected_cents).toBe(8000); // 5000 inicial + 3000
    expect(totals.find((t) => t.kind === "pix")!.expected_cents).toBe(5000);
    const dinheiro = w.methods.dinheiro, pixM = w.methods.pix;
    expect(await msg(closeCash(w.db, w.owner, cashId, { declared: { [dinheiro]: 7500, [pixM]: 5000 } }))).toMatch(/justificativa/);
    expect(await msg(closeCash(w.db, w.owner, cashId, { declared: { [dinheiro]: 7500 } }))).toMatch(/Informe o valor contado/);
    const res = await closeCash(w.db, w.owner, cashId, { declared: { [dinheiro]: 7500, [pixM]: 5000 }, justification: "Troco dado a mais" });
    expect(res.diff).toBe(-500);
    expect(await findOpenSession(w.db.query, w.unitId)).toBeNull();
  });

  it("estorno: só uma vez, cria registro próprio e devolve o saldo à cobrança", async () => {
    const att = await quickAttendance(w.db, w.owner, { customerId: w.customerId, staffId: w.ownerStaffId, serviceIds: [w.serviceId], startsAt: future(-18) });
    const { receivableId } = await completeAttendance(w.db, w.owner, att);
    const p = await registerPayment(w.db, w.owner, { receivableId, methodId: w.methods.pix, amountCents: 6000, idempotencyKey: key() });
    expect(await msg(reversePayment(w.db, w.manager, p.id, "erro"))).toMatch(/permissão/);
    await reversePayment(w.db, w.owner, p.id, "Pix devolvido ao cliente");
    expect(await msg(reversePayment(w.db, w.owner, p.id, "de novo"))).toMatch(/já foi estornado/);
    const r = (await getReceivable(w.db, w.owner, receivableId)).receivable;
    expect(r.registered_cents).toBe(0);
    expect(r.pay_status).toBe("pendente");
  });

  it("desconto respeita permissão e limite; sangria não excede o dinheiro", async () => {
    const att = await quickAttendance(w.db, w.barber, { customerId: w.customerId, staffId: w.barberStaffId, serviceIds: [w.serviceId], startsAt: future(1) });
    expect(await msg(applyDiscount(w.db, w.barber, att, { discountCents: 500, reason: "fidelidade" }))).toMatch(/administrador/);
    await applyDiscount(w.db, w.owner, att, { discountCents: 1000, reason: "Cliente fiel" });
    const { attendance } = await getAttendance(w.db, w.owner, att);
    expect(attendance.total_cents).toBe(5000);
    expect(await msg(applyDiscount(w.db, w.owner, att, { discountCents: 9999, reason: "x y z" }))).toMatch(/maior que o total/);

    const cashId = await openCash(w.db, w.owner, { declaredCents: 1000 });
    expect(await msg(addCashMovement(w.db, w.owner, { kind: "sangria", amountCents: 2000, description: "Retirada", idempotencyKey: key() }))).toMatch(/maior que o dinheiro/);
    await addCashMovement(w.db, w.owner, { kind: "sangria", amountCents: 500, description: "Retirada", idempotencyKey: key() });
    await closeCash(w.db, w.owner, cashId, { declared: Object.fromEntries((await expectedByMethod(w.db.query, cashId)).map((t) => [t.method_id, t.expected_cents])) });
  });

  it("mudança de preço não altera atendimentos já registrados", async () => {
    const att = await quickAttendance(w.db, w.owner, { customerId: w.customerId, staffId: w.ownerStaffId, serviceIds: [w.serviceId], startsAt: future(-17) });
    await setServicePrice(w.db, w.owner, w.serviceId, 9000, null);
    const { items } = await getAttendance(w.db, w.owner, att);
    expect(items[0].unit_price_cents).toBe(6000);
    const att2 = await quickAttendance(w.db, w.owner, { customerId: w.customer2Id, staffId: w.barber2StaffId, serviceIds: [w.serviceId], startsAt: future(-16) });
    expect((await getAttendance(w.db, w.owner, att2)).items[0].unit_price_cents).toBe(9000);
  });

  it("perfis: barbeiro sem acesso ao financeiro; pagamento só com permissão individual", async () => {
    expect(await msg(listPayables(w.db, w.barber))).toMatch(/permissão/);
    expect(await msg(listPayables(w.db, w.accountant))).toBe("OK");
    const att = await quickAttendance(w.db, w.barber, { customerId: w.customerId, staffId: w.barberStaffId, serviceIds: [w.service2Id], startsAt: future(3) });
    const { receivableId } = await completeAttendance(w.db, w.barber, att);
    expect(await msg(registerPayment(w.db, w.barber, { receivableId, methodId: w.methods.pix, amountCents: 4000, idempotencyKey: key() }))).toMatch(/permissão/);
    const { ctxFor } = await import("./testkit");
    const barberPay = ctxFor(w.barber.userId, w.unitId, "tecnico", w.barberStaffId, [{ permission: "payments.register", granted: true }]);
    await registerPayment(w.db, barberPay, { receivableId, methodId: w.methods.pix, amountCents: 4000, idempotencyKey: key() });
    const rec = await listReceivables(w.db, w.barber, {});
    expect(rec.rows.every((r) => r.staff_name === "Barbeiro Um")).toBe(true);
    void startAttendance;
  });
});
