"use server";
import { after } from "next/server";
import { flushPush } from "@/server/services/push";
import { getDb } from "@/server/db";
import { requireSession, run, str, optStr } from "@/server/session";
import { cancelAppointment, createAppointment, createBlock, cancelBlock, markNoShow, rescheduleAppointment } from "@/server/services/agenda";
import { quickAttendance, startAttendance } from "@/server/services/attendance";
import { saveCustomer } from "@/server/services/customers";
import { DomainError } from "@/server/errors";
import { atLocal } from "@/lib/dates";

/** Envia o push logo após a resposta, sem atrasar a tela. */
function pushNow(db: Awaited<ReturnType<typeof getDb>>) {
  after(() => flushPush(db).catch((e) => console.error("[push]", e)));
}

function startsAt(fd: FormData) {
  const d = str(fd, "date"), t = str(fd, "time");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) throw new DomainError("invalid", "Informe data e hora válidas.");
  return atLocal(d, t);
}

/** Campos devolvidos na URL quando a operação falha, para o formulário não perder o que foi preenchido. */
function keep(fd: FormData, base: Record<string, string>) {
  const p = new URLSearchParams(base);
  const cust = str(fd, "customerId");
  if (cust) p.set("cust", cust);
  if (str(fd, "staffId")) p.set("s", str(fd, "staffId"));
  if (str(fd, "chairId")) p.set("c", str(fd, "chairId"));
  const svc = fd.getAll("services").map(String).join(",");
  if (svc) p.set("svc", svc);
  return p.toString();
}

async function resolveCustomer(fd: FormData, ctx: Awaited<ReturnType<typeof requireSession>>["ctx"]) {
  const existing = str(fd, "customerId");
  if (existing) return existing;
  const name = str(fd, "newName");
  if (!name) throw new DomainError("invalid", "Escolha um cliente ou informe o nome de um novo cliente.");
  return saveCustomer(await getDb(), ctx, { name, phone: optStr(fd, "newPhone") });
}

export async function createAppointmentAction(fd: FormData) {
  const { ctx } = await requireSession();
  const back = `/agenda/novo?${keep(fd, { d: str(fd, "date"), t: str(fd, "time") })}`;
  await run(back, async () => {
    const db = await getDb();
    const customerId = await resolveCustomer(fd, ctx);
    await createAppointment(db, ctx, {
      customerId, staffId: str(fd, "staffId"), chairId: optStr(fd, "chairId"), startsAt: startsAt(fd), serviceIds: fd.getAll("services").map(String), notes: optStr(fd, "notes"),
    });
    pushNow(db);
    return { to: `/agenda?d=${str(fd, "date")}`, ok: "Agendamento criado." };
  });
}

export async function quickAttendanceAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(`/agenda/novo?${keep(fd, { imediato: "1" })}`, async () => {
    const db = await getDb();
    const customerId = await resolveCustomer(fd, ctx);
    const id = await quickAttendance(db, ctx, { customerId, staffId: str(fd, "staffId"), chairId: optStr(fd, "chairId"), serviceIds: fd.getAll("services").map(String) });
    return { to: `/atendimentos/${id}`, ok: "Atendimento iniciado." };
  });
}

export async function startAttendanceAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/agenda/${id}`, async () => {
    const att = await startAttendance(await getDb(), ctx, id);
    return { to: `/atendimentos/${att}`, ok: "Atendimento iniciado." };
  });
}

export async function cancelAppointmentAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/agenda/${id}`, async () => {
    const db = await getDb();
    await cancelAppointment(db, ctx, id, str(fd, "reason"));
    pushNow(db);
    return { to: "/agenda", ok: "Agendamento cancelado." };
  });
}

export async function noShowAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/agenda/${id}`, async () => {
    await markNoShow(await getDb(), ctx, id);
    return "Marcado como não compareceu.";
  });
}

export async function rescheduleAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/agenda/${id}`, async () => {
    const db = await getDb();
    await rescheduleAppointment(db, ctx, id, { startsAt: startsAt(fd), staffId: optStr(fd, "staffId") ?? undefined, chairId: optStr(fd, "chairId") ?? undefined, reason: optStr(fd, "reason") ?? undefined });
    pushNow(db);
    return "Agendamento reagendado.";
  });
}

export async function createBlockAction(fd: FormData) {
  const { ctx } = await requireSession();
  const d = str(fd, "date");
  await run(`/agenda?d=${d}`, async () => {
    const s = atLocal(d, str(fd, "from")), e = atLocal(str(fd, "dateTo") || d, str(fd, "to"));
    await createBlock(await getDb(), ctx, { chairId: optStr(fd, "chairId"), staffId: optStr(fd, "staffId"), startsAt: s, endsAt: e, reason: str(fd, "reason") });
    return "Horário bloqueado.";
  });
}

export async function removeBlockAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(`/agenda?d=${str(fd, "d")}`, async () => {
    await cancelBlock(await getDb(), ctx, str(fd, "id"));
    return "Bloqueio removido.";
  });
}
