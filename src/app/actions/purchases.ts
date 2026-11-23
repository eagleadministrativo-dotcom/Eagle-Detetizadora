"use server";
import { getDb } from "@/server/db";
import { int, optStr, requireSession, run, str } from "@/server/session";
import { markBought, removePurchase, savePurchase, unmarkBought } from "@/server/services/purchases";
import { DomainError } from "@/server/errors";
import { parseBRL } from "@/lib/money";

const back = (fd: FormData) => (str(fd, "back") === "compradas" ? "/compras?v=compradas" : "/compras");
export async function savePurchaseAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(back(fd), async () => {
    const total = parseBRL(str(fd, "total"));
    if (total == null) throw new DomainError("invalid", "Valor inválido. Use o formato 120,00.");
    const credit = str(fd, "payment") === "credito";
    await savePurchase(await getDb(), ctx, { id: optStr(fd, "id"), name: str(fd, "name"), notes: optStr(fd, "notes"), quantity: int(fd, "quantity") || 1, totalCents: total, payment: credit ? "credito" : "avista", installments: credit ? int(fd, "installments") || 1 : 1, firstDue: optStr(fd, "firstDue"), categoryId: optStr(fd, "categoryId"), priority: (str(fd, "priority") || "normal") as "normal" });
    return optStr(fd, "id") ? "Compra atualizada." : "Adicionada à lista.";
  });
}
export async function boughtAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/compras", async () => {
    const r = await markBought(await getDb(), ctx, str(fd, "id"), { firstDue: str(fd, "firstDue"), categoryId: str(fd, "categoryId") });
    return r.created ? `Marcado como comprado. ${r.created === 1 ? "A despesa foi lançada" : `${r.created} parcelas foram lançadas`} em Contas a pagar.` : "Já estava marcado como comprado.";
  });
}
export async function unboughtAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/compras?v=compradas", async () => { await unmarkBought(await getDb(), ctx, str(fd, "id")); return "Compra voltou para a lista. As parcelas foram canceladas."; });
}
export async function removePurchaseAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/compras", async () => { await removePurchase(await getDb(), ctx, str(fd, "id")); return "Removida da lista."; });
}
