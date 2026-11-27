import { describe, it, expect, beforeAll } from "vitest";
import { makeWorld, future, type World } from "./testkit";
import { createAppointment } from "./services/agenda";
import {
  cancelServiceOrder, createServiceOrder, deleteFinanceEntry, executeServiceOrder, getQuote, getReturn, getServiceOrder, listFinanceEntries,
  listReturns, listServiceOrders, saveFinanceEntry, saveQuote, saveReturn, setQuoteStatus, updateReturn, updateServiceOrder,
} from "./services/eagle";
import { addDays, todayYmd } from "@/lib/dates";

let w: World;
const msg = async (p: Promise<unknown>) => p.then(() => "OK", (e) => (e as Error).message);
beforeAll(async () => { w = await makeWorld(); });

describe("retornos", () => {
  it("quem gerencia cria e vê todos; o técnico vê e atualiza só os seus, sem mudar data nem técnico", async () => {
    const mine = await saveReturn(w.db, w.owner, { customerId: w.customerId, kind: "manutencao", dueDate: addDays(todayYmd(), 30), staffId: w.barberStaffId, notes: "Trimestral" });
    const other = await saveReturn(w.db, w.owner, { customerId: w.customer2Id, kind: "garantia", dueDate: addDays(todayYmd(), 10), staffId: w.barber2StaffId });
    expect(await msg(saveReturn(w.db, w.barber, { customerId: w.customerId, kind: "outro", dueDate: todayYmd() }))).toMatch(/permissão/);
    expect(await msg(saveReturn(w.db, w.owner, { customerId: w.customerId, kind: "outro", dueDate: "31/12/2026" }))).toMatch(/inválida/);

    expect((await listReturns(w.db, w.owner)).rows.map((r) => r.id)).toEqual(expect.arrayContaining([mine, other]));
    const seen = (await listReturns(w.db, w.barber)).rows.map((r) => r.id);
    expect(seen).toContain(mine);
    expect(seen).not.toContain(other);
    expect(await msg(getReturn(w.db, w.barber, other))).toMatch(/permissão/);

    await updateReturn(w.db, w.barber, mine, { status: "agendado", notes: "Cliente pediu de manhã" });
    expect(await getReturn(w.db, w.barber, mine)).toMatchObject({ status: "agendado", notes: "Cliente pediu de manhã", kind: "manutencao" });
    expect(await msg(updateReturn(w.db, w.barber, mine, { dueDate: todayYmd() }))).toMatch(/Só quem gerencia/);
    expect(await msg(updateReturn(w.db, w.barber, other, { status: "concluido" }))).toMatch(/permissão/);
    expect(await msg(updateReturn(w.db, w.owner, mine, { status: "sumido" }))).toMatch(/inválida/);
  });
});

describe("orçamentos", () => {
  it("item com serviço usa nome e preço do serviço; desconto; numeração sequencial; aprovado não edita", async () => {
    const id = await saveQuote(w.db, w.owner, {
      customerId: w.customerId, discountCents: 1000, validUntil: addDays(todayYmd(), 15),
      items: [{ serviceId: w.serviceId, quantity: 2 }, { description: "Taxa de deslocamento", unitPriceCents: 2500 }, { description: "" }],
    });
    const q1 = (await getQuote(w.db, w.owner, id))!;
    expect(q1.items.map((i) => [i.description, i.quantity, i.unit_price_cents])).toEqual([["Corte", 2, 6000], ["Taxa de deslocamento", 1, 2500]]);
    expect(q1.quote).toMatchObject({ status: "rascunho", items_cents: 14500, total_cents: 13500 });
    const id2 = await saveQuote(w.db, w.owner, { customerId: w.customer2Id, items: [{ description: "Inspeção", unitPriceCents: 10000 }] });
    expect((await getQuote(w.db, w.owner, id2))!.quote.number).toBe(q1.quote.number + 1);

    expect(await msg(saveQuote(w.db, w.owner, { customerId: w.customerId, items: [{ description: "Sem preço" }] }))).toMatch(/Informe o valor/);
    expect(await msg(saveQuote(w.db, w.owner, { customerId: w.customerId, items: [] }))).toMatch(/pelo menos um item/);
    expect(await msg(saveQuote(w.db, w.barber, { customerId: w.customerId, items: [{ description: "X", unitPriceCents: 1 }] }))).toMatch(/permissão/);

    await setQuoteStatus(w.db, w.owner, id, "aprovado");
    expect(await msg(saveQuote(w.db, w.owner, { id, customerId: w.customerId, items: [{ description: "Outro", unitPriceCents: 1 }] }))).toMatch(/não pode ser editado/);
    await setQuoteStatus(w.db, w.owner, id, "rascunho");
    await saveQuote(w.db, w.owner, { id, customerId: w.customerId, items: [{ description: "Revisado", unitPriceCents: 9900 }] });
    expect((await getQuote(w.db, w.owner, id))!.quote.total_cents).toBe(9900);
  });
});

describe("ordens de serviço", () => {
  it("uma por agendamento; técnico preenche a própria; concluir exige confirmação e cria o retorno de garantia", async () => {
    await w.db.query("update services set warranty_days=90 where id=$1", [w.serviceId]);
    const appt = await createAppointment(w.db, w.owner, { customerId: w.customerId, staffId: w.barberStaffId, chairId: w.chairs[0], startsAt: future(30), serviceIds: [w.serviceId] });
    expect(await msg(createServiceOrder(w.db, w.barber2, appt))).toMatch(/permissão/);
    const os = await createServiceOrder(w.db, w.barber, appt);
    expect(await createServiceOrder(w.db, w.owner, appt)).toBe(os); // a mesma, não duplica
    expect(await getServiceOrder(w.db, w.barber, os)).toMatchObject({ status: "aberta", warranty_days: 90, services: "Corte", total_cents: 6000, staff_id: w.barberStaffId });
    expect((await listServiceOrders(w.db, w.barber2)).rows.some((r) => r.id === os)).toBe(false);

    await updateServiceOrder(w.db, w.barber, os, { pests: "Baratas", productsUsed: "Gel inseticida", areas: "Cozinha", paymentStatus: "pago", warrantyDays: 60 });
    expect(await msg(executeServiceOrder(w.db, w.barber, os))).toMatch(/confirmação do técnico/);
    await updateServiceOrder(w.db, w.barber, os, { pests: "Baratas", productsUsed: "Gel inseticida", areas: "Cozinha", paymentStatus: "pago", warrantyDays: 60, technicianConfirmed: true, customerConfirmed: true });
    const ret = await executeServiceOrder(w.db, w.barber, os);
    expect(ret).toBeTruthy();
    expect(await getReturn(w.db, w.owner, ret!)).toMatchObject({ kind: "garantia", status: "pendente", due_date: addDays(todayYmd(), 60), staff_id: w.barberStaffId, service_order_id: os });
    expect(await msg(updateServiceOrder(w.db, w.barber, os, { pests: "Ratos" }))).toMatch(/Só a OS aberta/);
    expect(await msg(executeServiceOrder(w.db, w.barber, os))).toMatch(/já foi encerrada/);
  });

  it("cancelar exige quem gerencia a agenda e um motivo", async () => {
    const appt = await createAppointment(w.db, w.owner, { customerId: w.customer2Id, staffId: w.barberStaffId, chairId: w.chairs[0], startsAt: future(54), serviceIds: [w.serviceId] });
    const os = await createServiceOrder(w.db, w.owner, appt);
    expect(await msg(cancelServiceOrder(w.db, w.barber, os, "desistiu"))).toMatch(/Só quem gerencia/);
    expect(await msg(cancelServiceOrder(w.db, w.owner, os, ""))).toMatch(/Motivo/);
    await cancelServiceOrder(w.db, w.owner, os, "Cliente desistiu");
    expect(await getServiceOrder(w.db, w.owner, os)).toMatchObject({ status: "cancelada" });
  });
});

describe("lançamentos do financeiro", () => {
  it("guarda o valor em centavos, soma por tipo e categoria e exclui com registro", async () => {
    const m = { start: todayYmd().slice(0, 8) + "01", end: addDays(todayYmd(), 1) };
    const a = await saveFinanceEntry(w.db, w.owner, { kind: "receita", category: "Contrato", description: "Manutenção mensal", amountCents: 15000, entryDate: todayYmd() });
    await saveFinanceEntry(w.db, w.owner, { kind: "gasto", category: "Produtos", description: "Inseticida", amountCents: 4000, entryDate: todayYmd() });
    expect(await msg(saveFinanceEntry(w.db, w.owner, { kind: "receita", category: "X", description: "Y", amountCents: 0, entryDate: todayYmd() }))).toMatch(/maior que zero/);
    expect(await msg(saveFinanceEntry(w.db, w.barber, { kind: "receita", category: "X", description: "Y", amountCents: 100, entryDate: todayYmd() }))).toMatch(/permissão/);
    const r = await listFinanceEntries(w.db, w.owner, m);
    expect(r).toMatchObject({ income: 15000, expense: 4000, balance: 11000 });
    expect(r.categories[0]).toMatchObject({ kind: "receita", category: "Contrato", cents: 15000 });
    await deleteFinanceEntry(w.db, w.owner, a);
    expect((await listFinanceEntries(w.db, w.owner, m)).income).toBe(0);
    expect((await w.db.query("select 1 from audit_logs where action='LANCAMENTO_EXCLUIDO'")).length).toBe(1);
  });
});
