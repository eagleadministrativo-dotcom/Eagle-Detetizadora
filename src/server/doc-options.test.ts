import { describe, it, expect, beforeAll } from "vitest";
import { composeOptions, matchOptions, pickedFrom, scheduledText, type Picked } from "@/lib/doc-options";
import { makeWorld, future, type World } from "./testkit";
import { deleteDocOption, listDocOptions, saveDocOption } from "./services/doc-options";
import { appointmentsWithoutOrder, createStandaloneOrder, getQuote, getServiceOrder, quoteDefaults, saveQuote } from "./services/eagle";
import { createAppointment } from "./services/agenda";

const opts = (...xs: [string, string | null][]) => xs.map(([text, group]) => ({ text, group }));

describe("montar textos a partir das opções", () => {
  it("aplicação vira lista com traço; produtos agrupados com a frase de abertura; acompanha vira frase", () => {
    expect(composeOptions("aplicacao", [{ t: "DESINSETIZAÇÃO PULVERIZADA." }, { t: "GEL." }])).toBe("- DESINSETIZAÇÃO PULVERIZADA.\n- GEL.");
    expect(composeOptions("produto", [{ t: "A", g: "Insetos" }, { t: "B", g: "Insetos" }, { t: "C", g: "Roedores" }], { intro: "Obs.: abaixo." }))
      .toBe("Obs.: abaixo.\n\nInsetos:\n• A\n• B\n\nRoedores:\n• C");
    expect(composeOptions("acompanha", [{ t: "Recibo" }, { t: "Nota fiscal" }, { t: "Boleto" }])).toBe("Recibo, Nota fiscal e Boleto.");
    expect(composeOptions("servico_os", [{ t: "Dedetização" }, { t: "limpeza de 2 caixas d'água" }])).toBe("Dedetização, limpeza de 2 caixas d'água.");
    expect(composeOptions("pagamento", [])).toBe("");
  });

  it("ao editar, marca as opções que estão no texto e guarda o que não é opção como texto anterior", () => {
    const list = opts(["A", "Insetos"], ["B", "Insetos"], ["C", "Roedores"]);
    const text = composeOptions("produto", [{ t: "A", g: "Insetos" }, { t: "C", g: "Roedores" }, { t: "Produto escrito à mão", raw: true }], { intro: "Obs.: abaixo." });
    const m = matchOptions("produto", text, list, "Obs.: abaixo.");
    expect([...m.checked].map((o) => o.text)).toEqual(["A", "C"]);
    expect(m.extra).toEqual(["Produto escrito à mão"]);

    const inc = opts(["Recibo", null], ["Nota fiscal", null], ["Laudo de potabilidade", null]);
    // texto do arquivo importado: o laudo escrito diferente da opção não se perde
    const imp = matchOptions("acompanha", "Laudos técnicos desinsetização e desratização, recibo, Nota fiscal e Boleto.", inc);
    expect([...imp.checked].map((o) => o.text)).toEqual(["Recibo", "Nota fiscal"]);
    expect(imp.extra).toEqual(["Laudos técnicos desinsetização e desratização", "Boleto"]);
    expect(composeOptions("acompanha", [{ t: "Recibo" }, { t: imp.extra[0], raw: true }])).toBe("Recibo e Laudos técnicos desinsetização e desratização.");
    expect(matchOptions("acompanha", "Tudo combinado por telefone.", inc).extra).toEqual(["Tudo combinado por telefone"]);
    expect(matchOptions("produto", "Obs: os produtos serão usados de acordo com a avaliação.", opts(["A", null]), "Obs.: outra frase.").extra).toEqual([]);
    expect(matchOptions("pagamento", "Pix na entrega", opts(["Pix", null])).checked.size).toBe(1);

    const os = matchOptions("servico_os", "Dedetização geral, desratização, limpeza 3 caixas.", opts(["Desratização", null], ["Dedetização", null]));
    expect([...os.checked].map((o) => o.text)).toEqual(["Desratização"]); // "Dedetização geral" não é a opção "Dedetização"
    expect(os.extra).toEqual(["Dedetização geral", "limpeza 3 caixas"]);
  });

  it("data marcada vira o texto do agendamento; valores inválidos do formulário são ignorados", () => {
    expect(scheduledText("2026-12-02", "09:00")).toBe("Agendado para 02/12/2026 (quarta-feira) às 09:00.");
    expect(scheduledText("2026-12-02")).toBe("Agendado para 02/12/2026 (quarta-feira).");
    expect(scheduledText("")).toBeNull();
    const p: Picked[] = pickedFrom([JSON.stringify({ t: "Recibo" }), "{quebrado", JSON.stringify({ t: "" }), JSON.stringify({ t: "X", g: "G", id: "1" })]);
    expect(p).toEqual([{ t: "Recibo", g: null, raw: false, id: null }, { t: "X", g: "G", raw: false, id: "1" }]);
  });
});

describe("opções cadastradas, orçamento e OS", () => {
  let w: World;
  beforeAll(async () => { w = await makeWorld(); });

  it("a unidade começa com as opções do modelo, uma vez só; o orçamento novo vem com as padrão", async () => {
    const all = await listDocOptions(w.db, w.unitId, { all: true });
    expect(all.filter((o) => o.kind === "produto")).toHaveLength(7);
    for (const o of all) await deleteDocOption(w.db, w.owner, o.id);
    expect(await listDocOptions(w.db, w.unitId, { all: true })).toEqual([]); // não volta sozinho depois de apagar

    await saveDocOption(w.db, w.owner, { kind: "acompanha", text: "Recibo", isDefault: true });
    await saveDocOption(w.db, w.owner, { kind: "acompanha", text: "Boleto", isDefault: true });
    const off = await saveDocOption(w.db, w.owner, { kind: "acompanha", text: "Laudo", isDefault: true });
    await saveDocOption(w.db, w.owner, { id: off, kind: "acompanha", text: "Laudo", isDefault: true, isActive: false });
    await saveDocOption(w.db, w.owner, { kind: "produto", groupLabel: "Roedores:", text: "Isca", isDefault: true });
    await expect(saveDocOption(w.db, w.owner, { kind: "cor", text: "Azul" })).rejects.toThrow(/inválido/);
    await expect(saveDocOption(w.db, w.barber, { kind: "acompanha", text: "X" })).rejects.toThrow(/permissão/);

    const d = await quoteDefaults(w.db, w.unitId);
    expect(d.includesText).toBe("Recibo e Boleto.");
    expect(d.productsText).toBe(`${d.productsIntro}\n\nRoedores:\n• Isca`);
  });

  it("orçamento guarda a data da mini agenda e os serviços marcados", async () => {
    const id = await saveQuote(w.db, w.owner, {
      customerId: w.customerId, servicesText: "Dedetização", valueCents: 50000, scheduledDate: "2026-12-02", scheduledTime: "09:00",
      schedulingText: scheduledText("2026-12-02", "09:00"), serviceIds: [w.serviceId, w.serviceId],
    });
    expect((await getQuote(w.db, w.owner, id))!.quote).toMatchObject({
      scheduled_date: "2026-12-02", scheduled_time: "09:00", service_ids: [w.serviceId], scheduling_text: "Agendado para 02/12/2026 (quarta-feira) às 09:00.",
    });
    await expect(saveQuote(w.db, w.owner, { customerId: w.customerId, servicesText: "X", valueCents: 1, scheduledDate: "02/12/2026" })).rejects.toThrow(/inválida/);
  });

  it("OS nova pelo agendamento do cliente já sai com a data, o horário e os serviços dele", async () => {
    const starts = future(48);
    const appt = await createAppointment(w.db, w.owner, { customerId: w.customerId, staffId: w.barberStaffId, chairId: w.chairs[0], startsAt: starts, serviceIds: [w.serviceId] });
    const open = await appointmentsWithoutOrder(w.db, w.owner);
    const a = open.find((x) => x.id === appt)!;
    expect(a).toMatchObject({ customer_id: w.customerId, service_ids: [w.serviceId], total_cents: 6000 });

    await expect(createStandaloneOrder(w.db, w.owner, w.customer2Id, {}, { appointmentId: appt })).rejects.toThrow(/outro cliente/);
    const os = await createStandaloneOrder(w.db, w.owner, w.customerId, { notes: "Portão azul" }, { appointmentId: appt });
    expect(await getServiceOrder(w.db, w.owner, os)).toMatchObject({ appointment_id: appt, service_date: a.date, service_time: a.time, services: "Corte", total_cents: 6000, notes: "Portão azul" });
    expect((await appointmentsWithoutOrder(w.db, w.owner)).some((x) => x.id === appt)).toBe(false);
    await expect(createStandaloneOrder(w.db, w.owner, w.customerId, {}, { appointmentId: appt })).rejects.toThrow(/já tem a OS/);
  });
});
