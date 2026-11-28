import { describe, it, expect, beforeAll } from "vitest";
import { makeWorld, future, type World } from "./testkit";
import { createAppointment, listAppointments, setAppointmentTeam } from "./services/agenda";
import {
  createOrderFromQuote, createServiceOrder, createStandaloneOrder, executeServiceOrderFull, getReturn, getServiceOrder, saveQuote, setOrderPayment, setQuoteStatus,
  updateServiceOrder, validUntilFrom, addOrderFile, listOrderFiles, getOrderImage, setOrderSigner,
} from "./services/eagle";
import { orderTotals, orderBreakdowns, quoteTotals, receivableOrders, runEagleJobs } from "./services/eagle-stats";
import { getCustomer, listCustomers, saveCustomer } from "./services/customers";
import { createInvite, getInvite, pendingInvitesByStaff, updateInvite } from "./services/invites";
import { customerHistory, historySummary, listHistory } from "./services/history";
import { saveStaff } from "./services/catalog";
import { getUserAccess, setUserAccess } from "./services/access";
import { ROLE_DEFAULTS } from "./permissions";
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

describe("endereço do agendamento", () => {
  it("ficha sem endereço recebe o digitado; endereço diferente vale só para o agendamento e vai para a OS", async () => {
    const cid = await saveCustomer(w.db, w.owner, { name: "Cliente Sem Endereço" });
    const a1 = await createAppointment(w.db, w.owner, { customerId: cid, staffId: w.barberStaffId, startsAt: future(200), serviceIds: [w.serviceId], address: "  Rua A,  10 - Centro " });
    expect((await getCustomer(w.db, w.owner, cid)).customer.address).toBe("Rua A, 10 - Centro");
    const a2 = await createAppointment(w.db, w.owner, { customerId: cid, staffId: w.barberStaffId, startsAt: future(220), serviceIds: [w.serviceId], address: "Galpão, Rua B, 99" });
    const rows = await listAppointments(w.db, w.owner, { from: new Date(Date.now()), to: new Date(Date.now() + 400 * 3600000) });
    expect(rows.find((r) => r.id === a1)?.address).toBe("Rua A, 10 - Centro");
    expect(rows.find((r) => r.id === a2)?.address).toBe("Galpão, Rua B, 99");
    expect((await getCustomer(w.db, w.owner, cid)).customer.address).toBe("Rua A, 10 - Centro");
    const os = await createStandaloneOrder(w.db, w.owner, cid, { valueCents: 100 }, { appointmentId: a2 });
    expect((await getServiceOrder(w.db, w.owner, os))?.service_address).toBe("Galpão, Rua B, 99");
  });
});

describe("serviço com mais de um técnico", () => {
  it("aparece na agenda do acompanhante, ele abre e conclui a OS, e fica ocupado no horário", async () => {
    const starts = future(300);
    const id = await createAppointment(w.db, w.owner, { customerId: w.customerId, staffId: w.barberStaffId, startsAt: starts, serviceIds: [w.serviceId], helperIds: [w.barber2StaffId, w.barberStaffId] });
    const range = { from: new Date(starts.getTime() - 3600000), to: new Date(starts.getTime() + 3600000) };
    const mine = await listAppointments(w.db, w.barber2, range);
    expect(mine.map((a) => a.id)).toContain(id);
    const row = mine.find((a) => a.id === id)!;
    expect(row.helper_ids).toEqual([w.barber2StaffId]);
    expect(row.staff_name.split(", ")).toHaveLength(2);
    expect(row.customer_phone).not.toBeUndefined();
    // o acompanhante não pode ser marcado em outro serviço no mesmo horário
    expect(await msg(createAppointment(w.db, w.owner, { customerId: w.customer2Id, staffId: w.barber2StaffId, startsAt: starts, serviceIds: [w.serviceId] }))).toMatch(/já tem atendimento/);
    // ele abre a OS do serviço e conclui
    const os = await createServiceOrder(w.db, w.barber2, id);
    await updateServiceOrder(w.db, w.barber2, os, { valueCents: 100, technicianConfirmed: true });
    expect((await getServiceOrder(w.db, w.barber2, os))?.helper_ids).toEqual([w.barber2StaffId]);
    // tirar da equipe libera o horário dele
    await setAppointmentTeam(w.db, w.owner, id, []);
    expect((await listAppointments(w.db, w.barber2, range)).map((a) => a.id)).not.toContain(id);
    expect(await msg(setAppointmentTeam(w.db, w.barber2, id, [w.barber2StaffId]))).toMatch(/gerencia/);
  });
});

describe("cargo e acesso por pessoa", () => {
  it("convite guarda o acesso marcado, pode ser editado antes de aceito, e a pessoa tem cargo e acesso trocados depois", async () => {
    const { id } = await createInvite(w.db, w.owner, { email: "acesso@teste.local", fullName: "Pessoa Acesso", role: "tecnico", permissions: ["agenda.view_own", "agenda.manage_own", "quotes.view"] });
    let inv = await getInvite(w.db, w.owner, id);
    expect(inv?.permissions).toEqual(expect.arrayContaining(["quotes.view", "agenda.view_own"]));
    expect(inv?.permissions).not.toContain("returns.own"); // desmarcado, mesmo sendo padrão do técnico
    await updateInvite(w.db, w.owner, id, { fullName: "Pessoa Acesso", role: "vendedor", permissions: ["customers.view", "quotes.manage"] });
    inv = await getInvite(w.db, w.owner, id);
    expect(inv).toMatchObject({ role: "vendedor" });
    expect(inv?.permissions).toEqual(expect.arrayContaining(["customers.view", "quotes.manage", "payments.register"])); // payments: fora da lista, segue o cargo
    expect(await msg(updateInvite(w.db, w.barber, id, { fullName: "x", role: "tecnico", permissions: [] }))).toMatch(/permissão|acesso/i);

    // usuário existente: troca de cargo e acesso de uma vez
    const uid = w.barber2.userId;
    await setUserAccess(w.db, w.owner, uid, "gerente", ["finance.view", "agenda.view_all"]);
    const a = await getUserAccess(w.db, w.owner, uid);
    expect(a.user.role).toBe("gerente");
    expect(a.perms.has("finance.view")).toBe(true);
    expect(a.perms.has("customers.manage")).toBe(false); // padrão do gerente, mas desmarcado
    await setUserAccess(w.db, w.owner, uid, "tecnico", ROLE_DEFAULTS.tecnico);
    expect((await getUserAccess(w.db, w.owner, uid)).perms.has("finance.view")).toBe(false);
    expect(await msg(setUserAccess(w.db, w.owner, w.owner.userId, "tecnico", []))).toMatch(/próprio/);
  });
});

describe("histórico de serviços da planilha", () => {
  it("aparece na ficha, na lista com filtros e no resumo por ano; o técnico não vê", async () => {
    const c = await saveCustomer(w.db, w.owner, { name: "Cliente Planilha", phone: "41999990000" });
    const ins = "insert into service_history(unit_id,customer_id,service_date,description,amount_cents,payment_kind,source,source_ref) values ($1,$2,$3,$4,$5,$6,'teste',$7) on conflict do nothing";
    await w.db.query(ins, [w.owner.unitId, c, "2021-03-10", "DD, DR, LIMP CAIXA", 55000, "pix", "a"]);
    await w.db.query(ins, [w.owner.unitId, c, "2023-07-01", "DEDETIZAÇÃO GERAL", 20000, "boleto", "b"]);
    await w.db.query(ins, [w.owner.unitId, c, "2023-07-01", "repetida", 1, "boleto", "b"]); // mesma linha não entra de novo
    const mine = await customerHistory(w.db, w.owner, c);
    expect(mine.map((h) => h.description)).toEqual(["DEDETIZAÇÃO GERAL", "DD, DR, LIMP CAIXA"]);
    expect((await listHistory(w.db, w.owner, { year: 2021 })).rows.map((h) => h.customer_name)).toContain("Cliente Planilha");
    const byQ = await listHistory(w.db, w.owner, { q: "limp caixa" });
    expect(byQ.count).toBe(1);
    expect(byQ.totalCents).toBe(55000);
    expect((await listHistory(w.db, w.owner, { q: "99990000" })).count).toBe(2);
    const sum = await historySummary(w.db, w.owner);
    expect(sum.years.find((y) => y.year === 2023)?.total).toBe(20000);
    expect(await msg(listHistory(w.db, w.barber, {}))).toMatch(/permissão/i);
  });
});

describe("convite pela Equipe", () => {
  it("convites pendentes aparecem por técnico para editar o cargo", async () => {
    const staff3 = await saveStaff(w.db, w.owner, { name: "Técnico Convite", color: "#123456", isActive: true, schedules: [] });
    const { id } = await createInvite(w.db, w.owner, { email: "equipe.convite@teste.local", fullName: "Técnico Convite", role: "tecnico", staffId: staff3 });
    const map = await pendingInvitesByStaff(w.db, w.owner);
    expect(map.get(staff3)?.id).toBe(id);
    await updateInvite(w.db, w.owner, id, { fullName: "Técnico Convite", role: "vendedor", staffId: staff3, permissions: ["customers.view"] });
    expect((await pendingInvitesByStaff(w.db, w.owner)).get(staff3)?.role).toBe("vendedor");
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
