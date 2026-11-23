"use server";
import { after } from "next/server";
import { getDb, type Db } from "@/server/db";
import { bool, int, optStr, requireSession, run, str } from "@/server/session";
import { adjustStock, returnProduct, saveProduct, sellProducts, setAttendanceProducts } from "@/server/services/products";
import { processEvents } from "@/server/services/events";
import { flushPush } from "@/server/services/push";
import { DomainError } from "@/server/errors";
import { parseBRL } from "@/lib/money";

const follow = (db: Db) => after(async () => { await processEvents(db).catch((e) => console.error("[eventos]", e)); await flushPush(db).catch((e) => console.error("[push]", e)); });
const brl = (fd: FormData, k: string, label: string, empty = false) => {
  const raw = str(fd, k);
  if (!raw && empty) return 0;
  const v = parseBRL(raw);
  if (v == null) throw new DomainError("invalid", `${label} inválido. Use o formato 12,50.`);
  return v;
};
function lines(fd: FormData) {
  const ids = fd.getAll("productId").map(String), qty = fd.getAll("productQty").map((v) => Number.parseInt(String(v), 10));
  return ids.map((productId, i) => ({ productId, quantity: qty[i] }));
}
export async function saveProductAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = optStr(fd, "id");
  await run(id ? `/produtos/${id}` : "/produtos", async () => {
    await saveProduct(await getDb(), ctx, { id, name: str(fd, "name"), sku: optStr(fd, "sku"), description: optStr(fd, "description"), priceCents: brl(fd, "price", "Preço"), trackStock: bool(fd, "trackStock"), minStock: int(fd, "minStock") || 0, commissionEnabled: bool(fd, "commission"), isActive: id ? bool(fd, "isActive") : true });
    return id ? "Produto atualizado." : "Produto cadastrado.";
  });
}
export async function stockAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/produtos/${id}`, async () => {
    const db = await getDb();
    await adjustStock(db, ctx, { productId: id, kind: str(fd, "kind") as "entrada" | "ajuste" | "perda", quantity: int(fd, "qty"), note: str(fd, "note") });
    follow(db);
    return "Estoque atualizado.";
  });
}
export async function attendanceProductsAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/atendimentos/${id}`, async () => {
    await setAttendanceProducts(await getDb(), ctx, id, { items: lines(fd), discountCents: brl(fd, "productDiscount", "Desconto", true), discountReason: optStr(fd, "productReason") });
    return "Produtos do atendimento atualizados.";
  });
}
export async function sellAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/produtos/vender", async () => {
    const db = await getDb();
    const amount = str(fd, "amount") ? brl(fd, "amount", "Valor recebido") : 0;
    const r = await sellProducts(db, ctx, {
      staffId: str(fd, "staffId"), customerId: optStr(fd, "customerId"), items: lines(fd), discountCents: brl(fd, "productDiscount", "Desconto", true), discountReason: optStr(fd, "productReason"), idempotencyKey: str(fd, "key"),
      payments: amount ? [{ methodId: str(fd, "methodId"), amountCents: amount, idempotencyKey: `${str(fd, "key")}-pay` }] : [],
    });
    follow(db);
    return { to: `/produtos/vendas/${r.saleId}`, ok: r.duplicate ? "Esta venda já havia sido registrada." : "Venda registrada." };
  });
}
export async function returnProductAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(`/produtos/vendas/${str(fd, "saleId")}`, async () => {
    const db = await getDb();
    await returnProduct(db, ctx, { saleItemId: str(fd, "itemId"), quantity: int(fd, "qty"), restock: bool(fd, "restock"), reason: str(fd, "reason"), idempotencyKey: str(fd, "key") });
    follow(db);
    return "Devolução registrada.";
  });
}
