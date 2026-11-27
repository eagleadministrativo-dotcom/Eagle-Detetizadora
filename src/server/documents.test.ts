import { describe, it, expect, beforeAll } from "vitest";
import { parseOrderText, parseQuoteText, extractDocumentText, parseDateBR, splitPhone } from "./documents/extract";
import { orderDocx, quoteDocx } from "./documents/docx";
import { makeWorld, type World } from "./testkit";
import { getQuote, getServiceOrder, saveQuote, createStandaloneOrder } from "./services/eagle";
import { importQuoteFile, importServiceOrderFile } from "./services/imports";
import { listCustomerFiles, getCustomerFile } from "./services/files";
import { docDateWithWeekday, docLongDate } from "@/lib/doc-format";

// texto no formato dos modelos da Eagle (dados fictícios)
const OS_TEXT = `ORDEM DE SERVIÇO:
CLIENTE: Padaria Sol Nascente FONE: (41) 99123-4567 Marta
DATA: 06/10/26 - Terça feira HORÁRIO: 17:30hs
SERVIÇOS:
- Dedetização geral, desratização, limpeza 2 caixas d'agua de 1000 litros.
DADOS DO CLIENTE:
Razão Social: PADARIA SOL NASCENTE LTDA.
Fantasia: Padaria Sol Nascente
CNPJ/CPF: 11.222.333/0001-81
Endereço/Completo: Rua das Flores, 10 - Centro, Colombo/Pr.
Cep. 83400-000
VALOR R$ 1.250,50
FORMA DE PAGAMENTO: Boleto 10 dias Banco: Inter
__________________________________________________________
Observações gerais:
Cliente pediu aplicação após o expediente.
Laudo: 6/meses
Situação do Cliente: ( ) Cl Novo ( ) Retorno (x) Indicação ( ) Repasse
Data Fechamento serviço: Out 26
Nº NF: 555
Nº recibo: 12
Boleto: 998877
Serviço Confirmado Data: Set 26 Resp. Conf. Cliente: Marta Resp. Eagle: Iva`;

const QUOTE_TEXT = `ORÇAMENTO:
CLIENTE: CONDOMÍNIO EDIFÍCIO AURORA
FONE: (41) 3333-2222 - Síndico João
SERVIÇOS A SEREM REALIZADOS:
Dedetização \\ Controle de insetos rasteiros nas áreas comuns.
Desratização \\ Manutenção de porta-iscas.
FORMAS DE APLICAÇÃO:
- DESINSETIZAÇÃO PULVERIZADA.
DESCRIÇÃO DOS PRODUTOS:
Obs: os produtos serão usados de acordo com a avaliação técnica.
VALOR: R$2200,00
FORMAS DE PAGAMENTO: Boleto com vencimento a combinar.
PRAZO DE EXECUÇÃO DOS SERVIÇOS: Aproximadamente meio dia.
VALIDADE DO ORÇAMENTO: 30 Dias
Acompanha: Laudos técnicos, recibo e nota fiscal.
Agendamento: Assim que aprovado.
Atenção: Os serviços devem ser acompanhados por um responsável.
Obs: Cancelamento com no mínimo 24hrs de antecedência.
Eagle Dedetizadora, Controle Integrado de Pragas Urbanas e Serviços.
Teremos satisfação em atendê-los.
Vitória Oliveira Gerente Comercial.
Colombo, 17 de Setembro de 2026`;

describe("leitura dos modelos", () => {
  it("OS: lê cliente, fone, data, serviços, dados fiscais, valor, laudo, situação e fechamento", () => {
    expect(parseOrderText(OS_TEXT)).toEqual({
      customerName: "Padaria Sol Nascente", phone: "41991234567", contact: "Marta", serviceDate: "2026-10-06", serviceTime: "17:30",
      servicesText: "Dedetização geral, desratização, limpeza 2 caixas d'agua de 1000 litros.",
      legalName: "PADARIA SOL NASCENTE LTDA.", tradeName: "Padaria Sol Nascente", document: "11.222.333/0001-81",
      address: "Rua das Flores, 10 - Centro, Colombo/Pr.", cep: "83400-000", valueCents: 125050, paymentMethod: "Boleto 10 dias", bank: "Inter",
      notes: "Cliente pediu aplicação após o expediente.", reportMonths: 6, clientSituation: "indicacao", closingRef: "Out 26", nfNumber: "555",
      receiptNumber: "12", boleto: "998877", confirmedOn: "Set 26", confirmedByCustomer: "Marta", confirmedByEagle: "Iva",
    });
  });

  it("orçamento: lê os blocos, o valor, a cidade e a data do fecho", () => {
    const p = parseQuoteText(QUOTE_TEXT);
    expect(p).toMatchObject({
      customerName: "CONDOMÍNIO EDIFÍCIO AURORA", phone: "4133332222", contact: "Síndico João", valueCents: 220000,
      applicationText: "DESINSETIZAÇÃO PULVERIZADA.", paymentTerms: "Boleto com vencimento a combinar.", executionTime: "Aproximadamente meio dia.",
      validityText: "30 Dias", includesText: "Laudos técnicos, recibo e nota fiscal.", schedulingText: "Assim que aprovado.",
      attentionText: "Os serviços devem ser acompanhados por um responsável.", cancellationText: "Cancelamento com no mínimo 24hrs de antecedência.",
      city: "Colombo", issueDate: "2026-09-17",
    });
    expect(p.servicesText).toBe("Dedetização \\ Controle de insetos rasteiros nas áreas comuns.\nDesratização \\ Manutenção de porta-iscas.");
  });

  it("datas, telefone e formatos do documento", () => {
    expect(parseDateBR("06/10/2026")).toBe("2026-10-06");
    expect(parseDateBR("31/13/26")).toBeNull();
    expect(splitPhone("(41) 99890-9790 Rose")).toEqual({ phone: "41998909790", contact: "Rose" });
    expect(docDateWithWeekday("2026-10-06")).toBe("06/10/26 - Terça-feira");
    expect(docLongDate("2026-09-17")).toBe("17 de Setembro de 2026");
  });

  it("recusa arquivo que não é Word nem PDF", async () => {
    await expect(extractDocumentText("planilha.xlsx", "application/vnd.ms-excel", Buffer.from("x"))).rejects.toThrow(/docx.*pdf/i);
  });
});

describe("documentos em Word e importação", () => {
  let w: World;
  beforeAll(async () => { w = await makeWorld(); });

  it("a OS gerada em Word volta igual ao ser importada, e o original fica na ficha do cliente", async () => {
    await w.db.query("update customers set legal_name='CLIENTE A LTDA.', trade_name='Cliente A', cpf='12.345.678/0001-90', address='Rua Um, 1 - Centro, Colombo/PR', cep='83400-100' where id=$1", [w.customerId]);
    const os = await createStandaloneOrder(w.db, w.owner, w.customerId, {
      serviceDate: "2026-10-06", serviceTime: "08:30", servicesText: "Dedetização geral e limpeza de caixa d'água", valueCents: 40000, paymentMethod: "Pix",
      bank: "Inter", notes: "Portão lateral", reportMonths: 6, clientSituation: "retorno", nfNumber: "901", confirmedByEagle: "Iva",
    });
    const bytes = await orderDocx((await getServiceOrder(w.db, w.owner, os))!);
    expect(bytes.subarray(0, 2).toString()).toBe("PK"); // .docx é um zip

    const r = await importServiceOrderFile(w.db, w.owner, { name: "OS antiga.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes });
    expect(r.customerId).toBe(w.customerId); // achou pelo CNPJ, não duplicou
    expect(r.customerCreated).toBe(false);
    expect(await getServiceOrder(w.db, w.owner, r.id)).toMatchObject({
      service_date: "2026-10-06", service_time: "08:30", services: "Dedetização geral e limpeza de caixa d'água", total_cents: 40000,
      payment_method: "Pix", bank: "Inter", notes: "Portão lateral", report_months: 6, client_situation: "retorno", nf_number: "901", confirmed_by_eagle: "Iva", status: "aberta",
    });
    const files = await listCustomerFiles(w.db, w.owner, w.customerId);
    expect(files[0]).toMatchObject({ kind: "os", name: "OS antiga.docx" });
    expect((await getCustomerFile(w.db, w.owner, files[0].id))!.bytes.equals(bytes)).toBe(true);
  });

  it("orçamento: Word gerado e importado de volta cadastra o cliente novo e mantém os textos", async () => {
    const id = await saveQuote(w.db, w.owner, {
      customerId: w.customer2Id, servicesText: "Desratização das áreas externas", applicationText: "Iscas em caixas de segurança", valueCents: 85000,
      paymentTerms: "Pix", executionTime: "2 horas", validityText: "15 dias", attentionText: "Acompanhar a equipe", city: "Curitiba", issueDate: "2026-11-20",
    });
    const data = (await getQuote(w.db, w.owner, id))!;
    expect(data.quote.doc_value_cents).toBe(85000);
    const bytes = await quoteDocx(data.quote, { quote_closing: "Eagle Dedetizadora, Controle Integrado de Pragas Urbanas e Serviços." }, data.items);
    await w.db.query("update customers set name='Outro nome', phone=null where id=$1", [w.customer2Id]); // força cadastrar cliente novo
    const r = await importQuoteFile(w.db, w.owner, { name: "orcamento.docx", mime: "", bytes });
    expect(r.customerCreated).toBe(true);
    expect((await getQuote(w.db, w.owner, r.id))!.quote).toMatchObject({
      customer_name: "Cliente B", services_text: "Desratização das áreas externas", application_text: "Iscas em caixas de segurança", doc_value_cents: 85000,
      payment_terms: "Pix", execution_time: "2 horas", validity_text: "15 dias", attention_text: "Acompanhar a equipe", city: "Curitiba", issue_date: "2026-11-20", status: "rascunho",
    });
  });

  it("orçamento só com texto exige valor; importar exige permissão", async () => {
    await expect(saveQuote(w.db, w.owner, { customerId: w.customerId, servicesText: "Algo" })).rejects.toThrow(/Informe o valor/);
    await expect(importServiceOrderFile(w.db, w.barber, { name: "a.docx", mime: "", bytes: Buffer.from("x") })).rejects.toThrow(/permissão/);
  });
});
