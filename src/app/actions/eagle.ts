"use server";
import { getDb } from "@/server/db";
import { bool, optStr, requireSession, run, str } from "@/server/session";
import { DomainError } from "@/server/errors";
import { parseBRL } from "@/lib/money";
import {
  cancelServiceOrder, createServiceOrder, createStandaloneOrder, deleteFinanceEntry, executeServiceOrder, saveFinanceEntry, saveQuote, saveReturn,
  setQuoteStatus, updateReturn, updateServiceOrder, saveDocumentSettings, DOC_SETTING_COLS, quoteDefaults, type OrderFields,
} from "@/server/services/eagle";
import { composeOptions, pickedFrom, scheduledText } from "@/lib/doc-options";
import { deleteDocOption, saveDocOption } from "@/server/services/doc-options";
import { importQuoteFile, importServiceOrderFile } from "@/server/services/imports";
import { addCustomerFile, deleteCustomerFile, type CustomerFileKind } from "@/server/services/files";

const money = (fd: FormData, k: string) => (str(fd, k) ? parseBRL(str(fd, k)) : null);
const intOrNull = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (!v) return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new DomainError("invalid", "Use apenas números inteiros.");
  return n;
};
async function fileFrom(fd: FormData, k = "file") {
  const f = fd.get(k);
  if (!(f instanceof File) || f.size === 0) throw new DomainError("invalid", "Escolha um arquivo.");
  return { name: f.name, mime: f.type, bytes: Buffer.from(await f.arrayBuffer()) };
}

// ───────── Retornos ─────────
export async function saveReturnAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/retornos/novo", async () => {
    const id = await saveReturn(await getDb(), ctx, {
      customerId: str(fd, "customerId"), kind: str(fd, "kind"), dueDate: str(fd, "dueDate"), staffId: optStr(fd, "staffId"), notes: optStr(fd, "notes"),
    });
    return { to: `/retornos/${id}`, ok: "Retorno criado." };
  });
}

export async function updateReturnAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/retornos/${id}`, async () => {
    const patch: Parameters<typeof updateReturn>[3] = {};
    if (fd.has("status")) patch.status = str(fd, "status");
    if (fd.has("dueDate")) patch.dueDate = str(fd, "dueDate");
    if (fd.has("staffId")) patch.staffId = optStr(fd, "staffId");
    if (fd.has("notes")) patch.notes = optStr(fd, "notes");
    await updateReturn(await getDb(), ctx, id, patch);
    return "Retorno atualizado.";
  });
}

// ───────── Orçamentos ─────────
const ITEM_ROWS = 8;

export async function saveQuoteAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = optStr(fd, "id");
  await run(id ? `/orcamentos/${id}/editar` : "/orcamentos/novo", async () => {
    const items = Array.from({ length: ITEM_ROWS }, (_, i) => ({
      serviceId: optStr(fd, `item${i}_service`),
      description: optStr(fd, `item${i}_description`),
      quantity: Number(str(fd, `item${i}_quantity`).replace(",", ".")) || null,
      unitPriceCents: money(fd, `item${i}_price`),
    }));
    const db = await getDb();
    // textos montados a partir das opções marcadas
    const svc = pickedFrom(fd.getAll("svc"));
    const servicesText = [composeOptions("servico", svc), optStr(fd, "servicesDetails")].filter(Boolean).join("\n");
    const listed = (field: string, kind: "aplicacao" | "produto" | "acompanha", intro?: string) => composeOptions(kind, pickedFrom(fd.getAll(field)), { intro }) || null;
    const intro = (await quoteDefaults(db, ctx.unitId)).productsIntro;
    const scheduledDate = optStr(fd, "scheduledDate");
    const scheduledTime = optStr(fd, "scheduledTime");
    const saved = await saveQuote(db, ctx, {
      id, customerId: str(fd, "customerId"), serviceAddress: optStr(fd, "serviceAddress"), issueDate: optStr(fd, "issueDate"), validUntil: optStr(fd, "validUntil"),
      discountCents: money(fd, "discount") ?? 0, valueCents: money(fd, "value"), paymentTerms: optStr(fd, "paymentTerms"), conditions: optStr(fd, "conditions"), notes: optStr(fd, "notes"),
      servicesText, applicationText: listed("opt_aplicacao", "aplicacao"), productsText: listed("opt_produto", "produto", intro), executionTime: optStr(fd, "executionTime"),
      validityText: optStr(fd, "validityText"), includesText: listed("opt_acompanha", "acompanha"),
      schedulingText: scheduledText(scheduledDate, scheduledTime) ?? optStr(fd, "schedulingText"), scheduledDate, scheduledTime,
      serviceIds: svc.map((p) => p.id).filter((x): x is string => !!x),
      attentionText: optStr(fd, "attentionText"), cancellationText: optStr(fd, "cancellationText"), signatureName: optStr(fd, "signatureName"), signatureRole: optStr(fd, "signatureRole"),
      signaturePhone: optStr(fd, "signaturePhone"), city: optStr(fd, "city"), items,
    });
    return { to: `/orcamentos/${saved}`, ok: "Orçamento salvo." };
  });
}

export async function quoteStatusAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/orcamentos/${id}`, async () => {
    await setQuoteStatus(await getDb(), ctx, id, str(fd, "status"));
    return "Situação do orçamento atualizada.";
  });
}

export async function importQuoteAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/orcamentos", async () => {
    const r = await importQuoteFile(await getDb(), ctx, await fileFrom(fd));
    return { to: `/orcamentos/${r.id}/editar`, ok: `Arquivo importado${r.customerCreated ? " e cliente cadastrado" : ""}. Confira os campos e salve.` };
  });
}

// ───────── Ordens de Serviço ─────────
function orderFields(fd: FormData): OrderFields {
  // serviços marcados + detalhes viram a frase da OS ("Dedetização, desratização, limpeza de 2 caixas d'água.")
  const details = optStr(fd, "servicesDetails");
  const services = composeOptions("servico_os", [...pickedFrom(fd.getAll("svc_os")), ...(details ? [{ t: details }] : [])]);
  return {
    serviceDate: optStr(fd, "serviceDate"), serviceTime: optStr(fd, "serviceTime"), servicesText: services || optStr(fd, "servicesText"), valueCents: money(fd, "value"),
    paymentMethod: optStr(fd, "paymentMethod"), bank: optStr(fd, "bank"), notes: optStr(fd, "notes"), reportMonths: intOrNull(fd, "reportMonths"),
    clientSituation: optStr(fd, "clientSituation"), closingRef: optStr(fd, "closingRef"), nfNumber: optStr(fd, "nfNumber"), receiptNumber: optStr(fd, "receiptNumber"),
    boleto: optStr(fd, "boleto"), confirmedOn: optStr(fd, "confirmedOn"), confirmedByCustomer: optStr(fd, "confirmedByCustomer"), confirmedByEagle: optStr(fd, "confirmedByEagle"),
    pests: optStr(fd, "pests"), productsUsed: optStr(fd, "productsUsed"), areas: optStr(fd, "areas"), paymentStatus: str(fd, "paymentStatus") || undefined,
    customerConfirmed: bool(fd, "customerConfirmed"), technicianConfirmed: bool(fd, "technicianConfirmed"), warrantyDays: intOrNull(fd, "warrantyDays"),
  };
}

export async function createServiceOrderAction(fd: FormData) {
  const { ctx } = await requireSession();
  const appointmentId = str(fd, "appointmentId");
  await run(`/agenda/${appointmentId}`, async () => {
    const id = await createServiceOrder(await getDb(), ctx, appointmentId, { quoteId: optStr(fd, "quoteId") });
    return { to: `/os/${id}`, ok: "Ordem de serviço aberta." };
  });
}

export async function createStandaloneOrderAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/os/nova", async () => {
    const id = await createStandaloneOrder(await getDb(), ctx, str(fd, "customerId"), orderFields(fd), { appointmentId: optStr(fd, "appointmentId") });
    return { to: `/os/${id}`, ok: "Ordem de serviço criada." };
  });
}

export async function updateServiceOrderAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/os/${id}`, async () => {
    await updateServiceOrder(await getDb(), ctx, id, orderFields(fd));
    return "Ordem de serviço salva.";
  });
}

export async function executeServiceOrderAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/os/${id}`, async () => {
    const ret = await executeServiceOrder(await getDb(), ctx, id);
    return ret ? "Ordem de serviço concluída. O retorno de garantia foi criado." : "Ordem de serviço concluída.";
  });
}

export async function cancelServiceOrderAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/os/${id}`, async () => {
    await cancelServiceOrder(await getDb(), ctx, id, str(fd, "reason"));
    return "Ordem de serviço cancelada.";
  });
}

export async function importServiceOrderAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/os", async () => {
    const r = await importServiceOrderFile(await getDb(), ctx, await fileFrom(fd));
    return { to: `/os/${r.id}`, ok: `Arquivo importado${r.customerCreated ? " e cliente cadastrado" : ""}. Confira os campos e salve.` };
  });
}

// ───────── Arquivos da ficha do cliente ─────────
export async function addCustomerFileAction(fd: FormData) {
  const { ctx } = await requireSession();
  const customerId = str(fd, "customerId");
  await run(`/clientes/${customerId}`, async () => {
    const f = await fileFrom(fd);
    const kind = (["os", "orcamento", "outro"].includes(str(fd, "kind")) ? str(fd, "kind") : "outro") as CustomerFileKind;
    await addCustomerFile(await getDb(), ctx, { customerId, kind, ...f });
    return "Arquivo anexado à ficha.";
  });
}

export async function deleteCustomerFileAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(`/clientes/${str(fd, "customerId")}`, async () => {
    await deleteCustomerFile(await getDb(), ctx, str(fd, "id"));
    return "Arquivo excluído.";
  });
}

// ───────── Configurações dos documentos ─────────
export async function saveDocumentSettingsAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/configuracoes", async () => {
    const values = Object.fromEntries(DOC_SETTING_COLS.filter((c) => fd.has(c)).map((c) => [c, optStr(fd, c)]));
    await saveDocumentSettings(await getDb(), ctx, values);
    return "Dados da empresa e textos do orçamento salvos.";
  });
}

// ───────── Opções do orçamento e da OS (Serviços e preços) ─────────
export async function saveDocOptionAction(fd: FormData) {
  const { ctx } = await requireSession();
  const kind = str(fd, "kind");
  await run("/admin/servicos", async () => {
    const sort = str(fd, "sort");
    await saveDocOption(await getDb(), ctx, {
      id: optStr(fd, "id"), kind, groupLabel: optStr(fd, "group"), text: str(fd, "text"), sortOrder: sort ? Number(sort) : null,
      isDefault: bool(fd, "isDefault"), isActive: fd.has("id") ? bool(fd, "isActive") : true,
    });
    return backToOptions(kind, optStr(fd, "id") ? "Opção salva." : "Opção adicionada.");
  });
}

export async function deleteDocOptionAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/servicos", async () => {
    await deleteDocOption(await getDb(), ctx, str(fd, "id"));
    return backToOptions(str(fd, "kind"), "Opção excluída.");
  });
}
/** Volta para a mesma lista de opções na página (âncora depois da mensagem). */
const backToOptions = (kind: string, ok: string) => ({ to: `/admin/servicos?ok=${encodeURIComponent(ok)}&aberto=${encodeURIComponent(kind)}#op-${encodeURIComponent(kind)}` });

// ───────── Financeiro ─────────
export async function saveFinanceEntryAction(fd: FormData) {
  const { ctx } = await requireSession();
  const back = `/financeiro?m=${encodeURIComponent(str(fd, "m"))}`;
  await run(back, async () => {
    await saveFinanceEntry(await getDb(), ctx, {
      kind: str(fd, "kind"), category: str(fd, "category"), description: str(fd, "description"), amountCents: parseBRL(str(fd, "amount")), entryDate: str(fd, "entryDate"),
    });
    return "Lançamento salvo.";
  });
}

export async function deleteFinanceEntryAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(`/financeiro?m=${encodeURIComponent(str(fd, "m"))}`, async () => {
    await deleteFinanceEntry(await getDb(), ctx, str(fd, "id"));
    return "Lançamento excluído.";
  });
}
