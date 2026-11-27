"use server";
import { getDb } from "@/server/db";
import { bool, int, optStr, requireSession, run, str } from "@/server/session";
import { parseBRL } from "@/lib/money";
import {
  cancelServiceOrder, createServiceOrder, deleteFinanceEntry, executeServiceOrder, saveFinanceEntry, saveQuote, saveReturn,
  setQuoteStatus, updateReturn, updateServiceOrder,
} from "@/server/services/eagle";

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
      unitPriceCents: str(fd, `item${i}_price`) ? parseBRL(str(fd, `item${i}_price`)) : null,
    }));
    const saved = await saveQuote(await getDb(), ctx, {
      id, customerId: str(fd, "customerId"), serviceAddress: optStr(fd, "serviceAddress"), validUntil: optStr(fd, "validUntil"),
      discountCents: parseBRL(str(fd, "discount")) ?? 0, paymentTerms: optStr(fd, "paymentTerms"), conditions: optStr(fd, "conditions"), notes: optStr(fd, "notes"), items,
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

// ───────── Ordens de Serviço ─────────
export async function createServiceOrderAction(fd: FormData) {
  const { ctx } = await requireSession();
  const appointmentId = str(fd, "appointmentId");
  await run(`/agenda/${appointmentId}`, async () => {
    const id = await createServiceOrder(await getDb(), ctx, appointmentId, { quoteId: optStr(fd, "quoteId") });
    return { to: `/os/${id}`, ok: "Ordem de serviço aberta." };
  });
}

export async function updateServiceOrderAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/os/${id}`, async () => {
    const w = str(fd, "warrantyDays");
    await updateServiceOrder(await getDb(), ctx, id, {
      pests: optStr(fd, "pests"), productsUsed: optStr(fd, "productsUsed"), areas: optStr(fd, "areas"), paymentMethod: optStr(fd, "paymentMethod"),
      paymentStatus: str(fd, "paymentStatus") || undefined, notes: optStr(fd, "notes"),
      customerConfirmed: bool(fd, "customerConfirmed"), technicianConfirmed: bool(fd, "technicianConfirmed"), warrantyDays: w ? int(fd, "warrantyDays") : null,
    });
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
