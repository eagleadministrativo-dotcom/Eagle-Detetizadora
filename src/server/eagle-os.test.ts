import { describe, it, expect, beforeAll } from "vitest";
import { makeWorld, type World } from "./testkit";
import {
  createOrderFromQuote, createStandaloneOrder, executeServiceOrderFull, getReturn, getServiceOrder, saveQuote, setOrderPayment, setQuoteStatus,
  updateServiceOrder, validUntilFrom, addOrderFile, listOrderFiles, getOrderImage, setOrderSigner,
} from "./services/eagle";
import { orderTotals, orderBreakdowns, quoteTotals, receivableOrders, runEagleJobs } from "./services/eagle-stats";
import { getCustomer, listCustomers, saveCustomer } from "./services/customers";
import { addDays, addMonths, monthEnd, monthStart, todayYmd } from "@/lib/dates";

let w: World;
const msg = async (p: Promise<unknown>) => p.then(() => "OK", (e) => (e as Error).message);
beforeAll(async () => { w = await makeWorld(); });
const today = todayYmd();

describe("OS concluída entra no financeiro, no painel e na ficha", () => {
  it("concluir conta a garantia da data do serviço, cria a renovação do laudo e o valor vira faturado e a receber", async () => {
    const served = addDays(today, -5);
    const os = await createStandaloneOrder(w.db, w.owner, w.customerId, { serviceDate: served, servicesText: "Desinsetização, Desratização.", valueCents: 50000, warrantyDays: 90, reportMonths: 6 });
    await updateServiceOrder(w.db, w.owner, os, { serviceDate: served, servicesText: "Desinsetização, Desratização.", valueCents: 50000, warrantyDays: 90, reportMonths: 6, technicianConfirmed: true });
    const before = await orderTotals(w.db, w.owner, { start: monthStart(served), end: today });
    const r = await executeServiceOrderFull(w.db, w.owner, os);
    expect(await getReturn(w.db, w.owner, r.warrantyId!)).toMatchObject({ kind: "garantia", due_date: addDays(served, 90), service_order_id: os });
    expect(await getReturn(w.db, w.owner, r.renewalId!)).toMatchObject({ kind: "manutencao", due_date: addDays(addMonths(served, 6), -15), service_order_id: os });

    const after = await orderTotals(w.db, w.owner, { start: monthStart(served), end: today });
    expect(after.done - before.done).toBe(1);
    expect(after.billed - before.billed).toBe(50000);
    expect(after.unpaid - before.unpaid).toBe(50000);
    expect((await receivableOrders(w.db, w.owner)).rows.map((x) => x.id)).toContain(os);

    await setOrderPayment(w.db, w.owner, os, "pago", "Pix");
    const paid = await orderTotals(w.db, w.owner, { start: monthStart(served), end: today });
    expect(paid.paid - before.paid).toBe(50000);
    expect((await receivableOrders(w.db, w.owner)).rows.map((x) => x.id)).not.toContain(os);
    expect(await getServiceOrder(w.db, w.owner, os)).toMatchObject({ payment_status: "pago", payment_method: "Pix", status: "executada" });
    expect(await msg(setOrderPayment(w.db, w.barber, os, "pendente"))).toMatch(/permissão/);

    const br = await orderBreakdowns(w.db, w.owner, { start: served, end: served });
    expect(br.byService.map((s) => s.label)).toEqual(expect.arrayContaining(["Desinsetização", "Desratização"]));
    expect(br.byService.reduce((a, s) => a + s.cents, 0)).toBe(50000);

    const { customer } = await getCustomer(w.db, w.owner, w.customerId);
    expect(customer.visits).toBeGreaterThanOrEqual(1);
    expect(customer.total_spent_cents).toBeGreaterThanOrEqual(50000);
  });

  it("OS concluída marca o agendamento como concluído", async () => {
    const [ap] = await w.db.query<{ id: string }>(
      `insert into appointments(unit_id,customer_id,staff_id,chair_id,starts_at,ends_at,status) values ($1,$2,$3,$4, now() - interval '2 hours', now() - interval '1 hour','agendado') returning id`,
      [w.unitId, w.customer2Id, w.barberStaffId, w.chairs[0]]);
    const os = await createStandaloneOrder(w.db, w.owner, w.customer2Id, { valueCents: 1000, technicianConfirmed: true }, { appointmentId: ap.id });
    await updateServiceOrder(w.db, w.owner, os, { valueCents: 1000, technicianConfirmed: true });
    await executeServiceOrderFull(w.db, w.owner, os);
    const [a] = await w.db.query<{ status: string }>("select status from appointments where id=$1", [ap.id]);
    expect(a.status).toBe("concluido");
  });
});

describe("orçamento", () => {
  it("vence em sai da validade; aprovado gera a OS com serviços, valor e data, sem duplicar", async () => {
    expect(validUntilFrom("Validade da proposta: 15 dias.", "2026-11-27")).toBe("2026-12-12");
    expect(validUntilFrom("A combinar", "2026-11-27")).toBeNull();
    const id = await saveQuote(w.db, w.owner, {
      customerId: w.customerId, servicesText: "Dedetização geral\nDescupinização", valueCents: 120000, validityText: "Validade: 30 dias", issueDate: today,
      scheduledDate: addDays(today, 3), scheduledTime: "09:00", serviceIds: [w.serviceId],
    });
    const [q] = await w.db.query<{ valid_until: string }>("select to_char(valid_until,'YYYY-MM-DD') as valid_until from quotes where id=$1", [id]);
    expect(q.valid_until).toBe(addDays(today, 30));
    expect(await msg(createOrderFromQuote(w.db, w.owner, id))).toMatch(/aprovado/);
    await setQuoteStatus(w.db, w.owner, id, "aprovado");
    const os = await createOrderFromQuote(w.db, w.owner, id);
    expect(await createOrderFromQuote(w.db, w.owner, id)).toBe(os);
    expect(await getServiceOrder(w.db, w.owner, os)).toMatchObject({ quote_id: id, services: "Dedetização geral, Descupinização.", total_cents: 120000, service_date: addDays(today, 3), service_time: "09:00" });
    const qt = await quoteTotals(w.db, w.owner, { start: monthStart(today), end: monthEnd(today) });
    expect(qt!.approved).toBeGreaterThanOrEqual(1);
  });
});

describe("busca de clientes", () => {
  it("acha sem acento, por telefone com hífen, por fantasia e por CNPJ", async () => {
    await saveCustomer(w.db, w.owner, { name: "Cei Centopéia", phone: "41 99890-9790", tradeName: "Escola Centopéia", cpf: "12.345.678/0001-90" });
    const ids = async (s: string) => (await listCustomers(w.db, w.owner, { search: s })).rows.map((r) => r.name);
    expect(await ids("centopeia")).toContain("Cei Centopéia");
    expect(await ids("99890-9790")).toContain("Cei Centopéia");
    expect(await ids("(41) 99890")).toContain("Cei Centopéia");
    expect(await ids("escola")).toContain("Cei Centopéia");
    expect(await ids("12345678")).toContain("Cei Centopéia");
    expect(await ids("zzz-inexistente")).toEqual([]);
  });
});

describe("fotos e assinatura", () => {
  it("guarda só imagens, a assinatura nova substitui a anterior e marca quem assinou", async () => {
    const os = await createStandaloneOrder(w.db, w.owner, w.customerId, { serviceDate: today, valueCents: 100 });
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    expect(await msg(addOrderFile(w.db, w.owner, os, { kind: "foto", name: "x.pdf", mime: "application/pdf", bytes: png }))).toMatch(/foto/);
    const photo = await addOrderFile(w.db, w.owner, os, { kind: "foto", name: "Antes - cozinha.jpg", mime: "image/jpeg", bytes: png });
    await addOrderFile(w.db, w.owner, os, { kind: "assinatura", name: "Assinatura - Rose.png", mime: "image/png", bytes: png });
    await addOrderFile(w.db, w.owner, os, { kind: "assinatura", name: "Assinatura - Rose 2.png", mime: "image/png", bytes: png });
    await setOrderSigner(w.db, w.owner, os, "Rose");
    const files = await listOrderFiles(w.db, w.owner, os);
    expect(files.filter((f) => f.kind === "assinatura")).toHaveLength(1);
    expect((await getOrderImage(w.db, w.owner, photo))?.mime).toBe("image/jpeg");
    expect(await getServiceOrder(w.db, w.owner, os)).toMatchObject({ confirmed_by_customer: "Rose", customer_confirmed: true });
    expect(await msg(addOrderFile(w.db, w.barber2, os, { kind: "foto", name: "a.jpg", mime: "image/jpeg", bytes: png }))).toMatch(/permissão/);
  });
});

describe("avisos diários", () => {
  it("avisa orçamento vencendo e retorno vencendo hoje, sem repetir", async () => {
    const qid = await saveQuote(w.db, w.owner, { customerId: w.customer2Id, servicesText: "Dedetização", valueCents: 1000, validUntil: addDays(today, 3) });
    await w.db.query("insert into service_returns(unit_id,customer_id,kind,due_date,staff_id) values ($1,$2,'garantia',$3,$4)", [w.unitId, w.customer2Id, today, w.barberStaffId]);
    const first = await runEagleJobs(w.db, w.unitId, today);
    expect(first.quotes).toBeGreaterThanOrEqual(1);
    expect(first.returns).toBeGreaterThanOrEqual(1);
    const again = await runEagleJobs(w.db, w.unitId, today);
    expect(again).toMatchObject({ quotes: 0, returns: 0 });
    const [n] = await w.db.query<{ n: number }>("select count(*)::int as n from notifications where ref_id=$1 and kind='orcamento_vencendo'", [qid]);
    expect(n.n).toBe(1);
  });
});
