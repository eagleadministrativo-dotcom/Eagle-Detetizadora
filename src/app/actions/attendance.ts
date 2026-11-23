"use server";
import { after } from "next/server";
import { getDb, type Db } from "@/server/db";
import { processEvents } from "@/server/services/events";
import { flushPush } from "@/server/services/push";
import { requireSession, run, str, optStr } from "@/server/session";
import { applyDiscount, cancelAttendance, completeAttendance, setAttendanceServices } from "@/server/services/attendance";
import { cancelReceivable, confirmPayment, flagDivergence, registerPayment, reversePayment, settlePayment } from "@/server/services/payments";
import { DomainError } from "@/server/errors";
import { parseBRL } from "@/lib/money";

const follow = (db: Db) => after(async () => { await processEvents(db).catch((e) => console.error("[eventos]", e)); await flushPush(db).catch((e) => console.error("[push]", e)); });

function money(fd: FormData, k: string, label = "Valor") {
  const v = parseBRL(str(fd, k));
  if (v == null) throw new DomainError("invalid", `${label} inválido. Use o formato 12,50.`);
  return v;
}

export async function setServicesAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/atendimentos/${id}`, async () => {
    await setAttendanceServices(await getDb(), ctx, id, fd.getAll("services").map(String));
    return "Serviços atualizados.";
  });
}

export async function discountAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/atendimentos/${id}`, async () => {
    const raw = str(fd, "discount");
    await applyDiscount(await getDb(), ctx, id, { discountCents: raw ? money(fd, "discount", "Desconto") : 0, reason: str(fd, "reason") });
    return "Desconto atualizado.";
  });
}

/** Conclui e, se houver valores informados, registra os pagamentos na mesma operação. Chaves de idempotência vêm do formulário. */
export async function completeAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/atendimentos/${id}`, async () => {
    const payments = [];
    for (let i = 0; i < 3; i++) {
      const raw = str(fd, `amount${i}`);
      if (!raw) continue;
      payments.push({ methodId: str(fd, `method${i}`), amountCents: money(fd, `amount${i}`), idempotencyKey: str(fd, `key${i}`), reference: optStr(fd, `ref${i}`) });
    }
    const db = await getDb();
    await completeAttendance(db, ctx, id, { payments });
    follow(db);
    return { to: `/atendimentos/${id}`, ok: payments.length ? "Atendimento concluído e pagamento registrado." : "Atendimento concluído. Cobrança criada como pendente." };
  });
}

export async function cancelAttendanceAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/atendimentos/${id}`, async () => {
    await cancelAttendance(await getDb(), ctx, id, str(fd, "reason"));
    return { to: "/atendimentos", ok: "Atendimento cancelado." };
  });
}

export async function registerPaymentAction(fd: FormData) {
  const { ctx } = await requireSession();
  const back = str(fd, "back") || "/financeiro/receber";
  await run(back, async () => {
    const r = await registerPayment(await getDb(), ctx, {
      receivableId: str(fd, "receivableId"), methodId: str(fd, "methodId"), amountCents: money(fd, "amount"), idempotencyKey: str(fd, "key"), reference: optStr(fd, "reference"), notes: optStr(fd, "notes"),
    });
    return r.duplicate ? "Este pagamento já havia sido registrado (nada foi duplicado)." : "Pagamento registrado.";
  });
}

export async function confirmPaymentAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(str(fd, "back") || "/financeiro/conciliacao", async () => {
    await confirmPayment(await getDb(), ctx, str(fd, "id"), str(fd, "evidence"));
    return "Pagamento conferido.";
  });
}
export async function settlePaymentAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(str(fd, "back") || "/financeiro/conciliacao", async () => {
    await settlePayment(await getDb(), ctx, str(fd, "id"));
    return "Liquidação registrada.";
  });
}
export async function divergenceAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(str(fd, "back") || "/financeiro/conciliacao", async () => {
    await flagDivergence(await getDb(), ctx, str(fd, "id"), str(fd, "note"));
    return "Divergência registrada.";
  });
}
export async function reversePaymentAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(str(fd, "back") || "/financeiro/receber", async () => {
    await reversePayment(await getDb(), ctx, str(fd, "id"), str(fd, "reason"));
    return "Pagamento estornado.";
  });
}
export async function cancelReceivableAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/financeiro/receber/${id}`, async () => {
    const db = await getDb();
    await cancelReceivable(db, ctx, id, str(fd, "reason"));
    follow(db);
    return "Cobrança cancelada.";
  });
}

export async function completeLaterAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/atendimentos/${id}`, async () => {
    const db = await getDb();
    await completeAttendance(db, ctx, id, {});
    follow(db);
    return "Atendimento concluído. Cobrança criada como pendente.";
  });
}
