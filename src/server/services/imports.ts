import type { Db, Q } from "../db";
import { audit, need } from "../core";
import type { Ctx } from "../permissions";
import { extractDocumentText, parseOrderText, parseQuoteText, type ParsedOrder } from "../documents/extract";
import { insertCustomerFile } from "./files";
import { createStandaloneOrder, quoteDefaults, saveQuote } from "./eagle";

const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
const COMBINING = /[̀-ͯ]/g;
const key = (v: string | null | undefined) => (v ?? "").normalize("NFD").replace(COMBINING, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Acha o cliente pelo CNPJ/CPF, nome (com ou sem acento) ou telefone; se não existir, cadastra com os dados do arquivo. */
async function findOrCreateCustomer(q: Q, ctx: Ctx, d: { name: string | null; phone: string | null; legalName?: string | null; tradeName?: string | null; document?: string | null; address?: string | null; cep?: string | null; contact?: string | null }): Promise<{ id: string; created: boolean }> {
  const doc = digits(d.document);
  const names = [d.name, d.tradeName, d.legalName].map(key).filter((x) => x.length >= 3);
  const rows = await q<{ id: string; name: string; cpf: string | null; phone: string | null; legal_name: string | null; trade_name: string | null }>(
    "select id, name, cpf, phone, legal_name, trade_name from customers where unit_id=$1", [ctx.unitId]);
  const hit = (doc.length >= 11 && rows.find((r) => digits(r.cpf) === doc))
    || rows.find((r) => [r.name, r.trade_name, r.legal_name].map(key).some((n) => n && names.includes(n)))
    || (d.phone && d.phone.length >= 10 && rows.find((r) => digits(r.phone) === d.phone));
  if (hit) {
    // completa o que faltar na ficha, sem sobrescrever o que já existe
    await q(
      `update customers set legal_name=coalesce(legal_name,$2), trade_name=coalesce(trade_name,$3), cpf=coalesce(cpf,$4), address=coalesce(address,$5), cep=coalesce(cep,$6),
         phone=coalesce(phone,$7), contact_name=coalesce(contact_name,$9), updated_at=now(), updated_by=$8 where id=$1`,
      [hit.id, d.legalName ?? null, d.tradeName ?? null, d.document ?? null, d.address ?? null, d.cep ?? null, d.phone ?? null, ctx.userId, d.contact ?? null]);
    return { id: hit.id, created: false };
  }
  const name = d.tradeName || d.name || d.legalName || "Cliente importado";
  const [r] = await q<{ id: string }>(
    "insert into customers(unit_id,name,phone,cpf,legal_name,trade_name,address,cep,contact_name,updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",
    [ctx.unitId, name, d.phone ?? null, d.document ?? null, d.legalName ?? null, d.tradeName ?? null, d.address ?? null, d.cep ?? null, d.contact ?? null, ctx.userId]);
  await audit(q, ctx, "CLIENTE_CRIADO", "customer", r.id, null, { name, origem: "importação de arquivo" });
  return { id: r.id, created: true };
}

export interface ImportResult { id: string; customerId: string; customerCreated: boolean }

export async function importServiceOrderFile(db: Db, ctx: Ctx, file: { name: string; mime: string; bytes: Buffer }): Promise<ImportResult & { parsed: ParsedOrder }> {
  need(ctx, "agenda.manage");
  need(ctx, "customers.manage");
  const parsed = parseOrderText(await extractDocumentText(file.name, file.mime, file.bytes));
  const { customer, fileId } = await db.tx(async (q) => {
    const customer = await findOrCreateCustomer(q, ctx, { name: parsed.customerName, phone: parsed.phone, contact: parsed.contact, legalName: parsed.legalName, tradeName: parsed.tradeName, document: parsed.document, address: parsed.address, cep: parsed.cep });
    const fileId = await insertCustomerFile(q, ctx, { customerId: customer.id, kind: "os", name: file.name, mime: file.mime, bytes: file.bytes });
    return { customer, fileId };
  });
  const id = await createStandaloneOrder(db, ctx, customer.id, {
    serviceDate: parsed.serviceDate, serviceTime: parsed.serviceTime, servicesText: parsed.servicesText, valueCents: parsed.valueCents, paymentMethod: parsed.paymentMethod,
    bank: parsed.bank, notes: parsed.notes, reportMonths: parsed.reportMonths, clientSituation: parsed.clientSituation, closingRef: parsed.closingRef,
    nfNumber: parsed.nfNumber, receiptNumber: parsed.receiptNumber, boleto: parsed.boleto, confirmedOn: parsed.confirmedOn,
    confirmedByCustomer: parsed.confirmedByCustomer, confirmedByEagle: parsed.confirmedByEagle,
  }, { fileId });
  return { id, customerId: customer.id, customerCreated: customer.created, parsed };
}

export async function importQuoteFile(db: Db, ctx: Ctx, file: { name: string; mime: string; bytes: Buffer }): Promise<ImportResult> {
  need(ctx, "quotes.manage");
  need(ctx, "customers.manage");
  const p = parseQuoteText(await extractDocumentText(file.name, file.mime, file.bytes));
  const { customer, fileId } = await db.tx(async (q) => {
    const customer = await findOrCreateCustomer(q, ctx, { name: p.customerName, phone: p.phone, contact: p.contact });
    const fileId = await insertCustomerFile(q, ctx, { customerId: customer.id, kind: "orcamento", name: file.name, mime: file.mime, bytes: file.bytes });
    return { customer, fileId };
  });
  const d = await quoteDefaults(db, ctx.unitId);
  // no modelo, a lista de produtos costuma ser imagem: sem lista no texto, entra a lista padrão de Configurações
  const products = p.productsText && p.productsText.length >= 200 ? p.productsText : d.productsText || p.productsText;
  const id = await saveQuote(db, ctx, {
    customerId: customer.id, issueDate: p.issueDate, fileId, valueCents: p.valueCents ?? 0, paymentTerms: p.paymentTerms ?? d.paymentTerms,
    servicesText: p.servicesText || "Serviços conforme arquivo importado.", applicationText: p.applicationText ?? d.applicationText, productsText: products,
    executionTime: p.executionTime ?? d.executionTime, validityText: p.validityText ?? d.validityText, includesText: p.includesText ?? d.includesText,
    schedulingText: p.schedulingText ?? d.schedulingText, attentionText: p.attentionText ?? d.attentionText, cancellationText: p.cancellationText ?? d.cancellationText,
    city: p.city ?? d.city, signatureName: d.signatureName, signatureRole: d.signatureRole, signaturePhone: d.signaturePhone,
  });
  return { id, customerId: customer.id, customerCreated: customer.created };
}
