import { beforeEach, describe, expect, it } from "vitest";
import { addMonths, monthStart, todayYmd } from "@/lib/dates";
import { makeWorld, type World } from "./testkit";
import { buildPerms } from "./permissions";
import { listPurchases, markBought, purchaseSchedule, removePurchase, savePurchase, unmarkBought } from "./services/purchases";
import { computeDre } from "./services/reports";
import { payPayable } from "./services/finance";

let w: World;
let cat: string;
beforeEach(async () => {
  w = await makeWorld();
  [{ id: cat }] = await w.db.query<{ id: string }>("select id from financial_categories where unit_id=$1 and name='Outras despesas'", [w.unitId]);
}, 60000);
const t = todayYmd(), m0 = monthStart(t);

describe("compras", () => {
  it("parcelado no crédito vira uma despesa por fatura, no mês certo", async () => {
    const id = await savePurchase(w.db, w.owner, { name: "Máquina de corte", totalCents: 100000, payment: "credito", installments: 3 });
    expect((await listPurchases(w.db, w.owner, "pendente"))[0]).toMatchObject({ name: "Máquina de corte", installments: 3, status: "pendente" });
    expect((await markBought(w.db, w.owner, id, { firstDue: addMonths(m0, 1), categoryId: cat })).created).toBe(3);
    expect((await markBought(w.db, w.owner, id, { firstDue: addMonths(m0, 1), categoryId: cat })).created).toBe(0); // sem duplicar
    const p = await w.db.query<{ amount_cents: number; due: string; comp: string }>("select amount_cents, to_char(due_date,'YYYY-MM-DD') as due, to_char(competence_date,'YYYY-MM-DD') as comp from payables where status='ativo' order by due_date");
    expect(p.map((x) => x.amount_cents)).toEqual([33334, 33333, 33333]);
    expect(p.map((x) => x.comp)).toEqual([1, 2, 3].map((k) => addMonths(m0, k)));
    const dre = await computeDre(w.db.query, w.unitId, { start: addMonths(m0, 1), end: addMonths(m0, 2) });
    expect(dre.expenses).toBe(66667); // duas faturas no intervalo
    expect((await purchaseSchedule(w.db, w.owner)).map((x) => x.cents).slice(0, 4)).toEqual([0, 33334, 33333, 33333]);
  });
  it("à vista é uma despesa só; desmarcar cancela, mas não depois de pago", async () => {
    const id = await savePurchase(w.db, w.owner, { name: "Toalhas", totalCents: 12000, payment: "avista", installments: 5 });
    await markBought(w.db, w.owner, id, { firstDue: t, categoryId: cat });
    const [p] = await w.db.query<{ id: string; installment_total: number | null }>("select id, installment_total from payables where status='ativo'");
    expect(p.installment_total).toBeNull();
    await unmarkBought(w.db, w.owner, id);
    expect((await w.db.query("select 1 from payables where status='ativo'")).length).toBe(0);
    expect((await listPurchases(w.db, w.owner, "pendente"))).toHaveLength(1);
    await markBought(w.db, w.owner, id, { firstDue: t, categoryId: cat });
    const [q] = await w.db.query<{ id: string }>("select id from payables where status='ativo'");
    await payPayable(w.db, w.owner, { payableId: q.id, amountCents: 12000, accountId: w.accounts.banco, idempotencyKey: "pagar-toalhas" });
    await expect(unmarkBought(w.db, w.owner, id)).rejects.toThrow(/já foi paga/);
    await expect(removePurchase(w.db, w.owner, id)).rejects.toThrow();
  });
  it("só quem tem permissão usa a lista; marcar comprado exige lançar contas", async () => {
    await expect(savePurchase(w.db, w.barber, { name: "Pente", totalCents: 1000, payment: "avista" })).rejects.toThrow();
    const buyer = { ...w.manager, perms: buildPerms("vendedora_gestora", [{ permission: "purchases.manage", granted: true }]) };
    const id = await savePurchase(w.db, buyer, { name: "Pente", totalCents: 1000, payment: "avista" });
    await expect(markBought(w.db, buyer, id, { firstDue: t, categoryId: cat })).rejects.toThrow();
    await expect(savePurchase(w.db, w.owner, { name: "Xy", totalCents: 0, payment: "avista" })).rejects.toThrow();
    await expect(savePurchase(w.db, w.owner, { name: "Xy", totalCents: 100, payment: "credito", installments: 30 })).rejects.toThrow(/24/);
  });
});
