"use server";
import { getDb } from "@/server/db";
import { requireSession, run, str, optStr, int } from "@/server/session";
import { DomainError } from "@/server/errors";
import { saveReturn, updateReturnStatus, saveQuote, saveServiceOrder, saveFinanceEntry } from "@/server/services/eagle";
import { parseBRL } from "@/lib/money";

// ───────── Retornos ─────────
export async function saveReturnAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/retornos", async () => {
    const id = await saveReturn(await getDb(), ctx, {
      customerId: str(fd, "customerId"),
      originAppointmentId: optStr(fd, "originAppointmentId") ?? undefined,
      kind: (str(fd, "kind") as any) || "outro",
      dueDate: str(fd, "dueDate"),
      notes: optStr(fd, "notes") ?? undefined,
    });
    return { to: `/retornos/${id}`, ok: "Retorno criado." };
  });
}

export async function updateReturnStatusAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/retornos", async () => {
    await updateReturnStatus(await getDb(), ctx, str(fd, "id"), (str(fd, "status") as any) || "pendente");
    return "Status atualizado.";
  });
}

// ───────── Orçamentos ─────────
export async function saveQuoteAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/orcamentos", async () => {
    const items: any[] = [];
    let i = 0;
    while (fd.get(`items[${i}][description]`)) {
      items.push({
        serviceId: optStr(fd, `items[${i}][serviceId]`),
        description: str(fd, `items[${i}][description]`),
        quantity: parseFloat(str(fd, `items[${i}][quantity]`) || "1"),
        unitPriceCents: Math.round((parseBRL(str(fd, `items[${i}][unitPrice]`)) || 0) * 100),
      });
      i++;
    }

    if (!items.length) throw new DomainError("invalid", "Orçamento deve ter pelo menos um item.");

    const id = await saveQuote(await getDb(), ctx, {
      id: optStr(fd, "id") ?? undefined,
      customerId: str(fd, "customerId"),
      serviceAddress: optStr(fd, "serviceAddress") ?? undefined,
      issueDate: optStr(fd, "issueDate") ?? undefined,
      validUntil: optStr(fd, "validUntil") ?? undefined,
      discountCents: Math.round((parseBRL(str(fd, "discount") || "0") || 0) * 100),
      paymentTerms: optStr(fd, "paymentTerms") ?? undefined,
      conditions: optStr(fd, "conditions") ?? undefined,
      notes: optStr(fd, "notes") ?? undefined,
      items,
    });
    return { to: `/orcamentos/${id}`, ok: "Orçamento salvo." };
  });
}

// ───────── Ordens de Serviço ─────────
export async function saveServiceOrderAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/os", async () => {
    const id = await saveServiceOrder(await getDb(), ctx, str(fd, "appointmentId"), {
      quoteId: optStr(fd, "quoteId") ?? undefined,
      pests: optStr(fd, "pests") ?? undefined,
      productsUsed: optStr(fd, "productsUsed") ?? undefined,
      areas: optStr(fd, "areas") ?? undefined,
      paymentMethod: optStr(fd, "paymentMethod") ?? undefined,
      notes: optStr(fd, "notes") ?? undefined,
      warrantyDays: int(fd, "warrantyDays"),
    });
    return { to: `/os/${id}`, ok: "OS criada." };
  });
}

// ───────── Financeiro ─────────
export async function saveFinanceEntryAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/financeiro", async () => {
    const kind = str(fd, "kind") === "gasto" ? "gasto" : "receita";
    const id = await saveFinanceEntry(await getDb(), ctx, {
      kind,
      category: str(fd, "category"),
      description: str(fd, "description"),
      amountCents: Math.round((parseBRL(str(fd, "amount")) || 0) * 100),
      entryDate: str(fd, "entryDate"),
    });
    return { to: "/financeiro", ok: "Lançamento salvo." };
  });
}
