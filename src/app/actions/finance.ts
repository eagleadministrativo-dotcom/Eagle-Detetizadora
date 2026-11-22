"use server";
import { getDb } from "@/server/db";
import { requireSession, run, str, optStr } from "@/server/session";
import { addCashCorrection, addCashMovement, closeCash, openCash } from "@/server/services/cash";
import { addCapitalEntry, cancelPayable, createPayable, payPayable, reversePayablePayment, saveGoal } from "@/server/services/finance";
import { closePeriod, reopenPeriod } from "@/server/services/closure";
import { createManualReceivable } from "@/server/services/payments";
import { DomainError } from "@/server/errors";
import { parseBRL } from "@/lib/money";

const cents = (fd: FormData, k: string, label = "Valor") => {
  const v = parseBRL(str(fd, k));
  if (v == null) throw new DomainError("invalid", `${label} inválido. Use o formato 12,50.`);
  return v;
};

export async function openCashAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/financeiro/caixa", async () => {
    const raw = str(fd, "declared");
    const id = await openCash(await getDb(), ctx, { declaredCents: raw ? cents(fd, "declared", "Saldo inicial") : 0 });
    return { to: `/financeiro/caixa/${id}`, ok: "Caixa aberto." };
  });
}

export async function cashMovementAction(fd: FormData) {
  const { ctx } = await requireSession();
  const back = str(fd, "back") || "/financeiro/caixa";
  await run(back, async () => {
    await addCashMovement(await getDb(), ctx, { kind: str(fd, "kind") === "sangria" ? "sangria" : "suprimento", amountCents: cents(fd, "amount"), description: str(fd, "description"), idempotencyKey: str(fd, "key") });
    return "Movimentação registrada.";
  });
}

export async function closeCashAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/financeiro/caixa/${id}`, async () => {
    const declared: Record<string, number> = {};
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith("m_") || typeof v !== "string") continue;
      const c = parseBRL(v);
      if (c == null) throw new DomainError("invalid", "Valor contado inválido. Use o formato 12,50.");
      declared[k.slice(2)] = c;
    }
    const r = await closeCash(await getDb(), ctx, id, { declared, justification: optStr(fd, "justification") ?? undefined });
    return r.anyDiff ? "Caixa fechado com diferença registrada." : "Caixa fechado sem diferenças.";
  });
}

export async function cashCorrectionAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/financeiro/caixa/${id}`, async () => {
    await addCashCorrection(await getDb(), ctx, id, str(fd, "note"));
    return "Correção registrada no histórico.";
  });
}

export async function createPayableAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/financeiro/pagar", async () => {
    const n = Number(str(fd, "installments")) || 1;
    const ids = await createPayable(await getDb(), ctx, {
      categoryId: str(fd, "categoryId"), description: str(fd, "description"), supplier: optStr(fd, "supplier"), amountCents: cents(fd, "amount", "Valor total"), dueDate: str(fd, "dueDate"),
      competenceDate: optStr(fd, "competenceDate"), recurrence: (optStr(fd, "recurrence") as "mensal" | "trimestral" | "anual" | null), installments: n, notes: optStr(fd, "notes"),
    });
    return ids.length > 1 ? `${ids.length} parcelas criadas.` : "Conta cadastrada.";
  });
}

export async function payPayableAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "payableId");
  await run(`/financeiro/pagar/${id}`, async () => {
    const r = await payPayable(await getDb(), ctx, { payableId: id, amountCents: cents(fd, "amount"), accountId: str(fd, "accountId"), idempotencyKey: str(fd, "key"), evidence: optStr(fd, "evidence") });
    return r.duplicate ? "Este pagamento já havia sido registrado (nada foi duplicado)." : "Pagamento registrado.";
  });
}

export async function reversePayablePaymentAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "payableId");
  await run(`/financeiro/pagar/${id}`, async () => {
    await reversePayablePayment(await getDb(), ctx, str(fd, "id"), str(fd, "reason"));
    return "Pagamento estornado.";
  });
}

export async function cancelPayableAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/financeiro/pagar/${id}`, async () => {
    await cancelPayable(await getDb(), ctx, id, str(fd, "reason"));
    return { to: "/financeiro/pagar", ok: "Conta cancelada." };
  });
}

export async function manualReceivableAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/financeiro/receber", async () => {
    await createManualReceivable(await getDb(), ctx, { customerId: optStr(fd, "customerId"), description: str(fd, "description"), amountCents: cents(fd, "amount"), dueDate: str(fd, "dueDate") });
    return "Cobrança avulsa criada.";
  });
}

export async function capitalAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/financeiro/fluxo", async () => {
    await addCapitalEntry(await getDb(), ctx, {
      kind: str(fd, "kind") === "emprestimo" ? "emprestimo" : "aporte", amountCents: cents(fd, "amount"), entryDate: str(fd, "entryDate"), accountId: optStr(fd, "accountId"), description: str(fd, "description"), idempotencyKey: str(fd, "key"),
    });
    return "Lançamento registrado (não conta como receita).";
  });
}

export async function saveGoalAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/financeiro/metas", async () => {
    await saveGoal(await getDb(), ctx, {
      id: optStr(fd, "id") ?? undefined, kind: str(fd, "kind") as "receita" | "resultado" | "reserva", name: str(fd, "name"), targetCents: cents(fd, "target", "Valor da meta"),
      periodStart: optStr(fd, "start"), periodEnd: optStr(fd, "end"), isActive: fd.get("inactive") !== "on",
    });
    return "Meta salva.";
  });
}

export async function closePeriodAction(fd: FormData) {
  const { ctx } = await requireSession();
  const p = { start: str(fd, "start"), end: str(fd, "end") };
  await run(`/financeiro/fechamento?de=${p.start}&ate=${p.end}`, async () => {
    await closePeriod(await getDb(), ctx, p);
    return "Período fechado e relatório versionado guardado.";
  });
}

export async function reopenPeriodAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/financeiro/fechamento", async () => {
    await reopenPeriod(await getDb(), ctx, str(fd, "id"), str(fd, "reason"));
    return "Período reaberto.";
  });
}
