"use server";
import { after } from "next/server";
import { getDb } from "@/server/db";
import { optStr, requireSession, run, str } from "@/server/session";
import { addAdjustment, approveSettlement, cancelSettlement, endRule, paySettlement, saveRule, setTrigger } from "@/server/services/commissions";
import { removeStaffGoal, saveStaffGoal, type GoalMetric } from "@/server/services/team";
import { flushPush } from "@/server/services/push";
import { DomainError } from "@/server/errors";
import { parseBRL } from "@/lib/money";

const money = (v: string, label: string) => { const n = parseBRL(v.replace("-", "")); if (n == null) throw new DomainError("invalid", `${label} inválido.`); return v.trim().startsWith("-") ? -n : n; };
export async function saveRuleAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/comissoes/regras", async () => {
    const [kind, id] = str(fd, "target").split(":");
    const pct = Number(str(fd, "pct").replace(",", "."));
    if (!Number.isFinite(pct)) throw new DomainError("invalid", "Percentual inválido.");
    await saveRule(await getDb(), ctx, { scope: str(fd, "scope") === "produto" ? "produto" : "servico", staffId: optStr(fd, "staffId"), serviceId: kind === "s" ? id : null, categoryId: kind === "c" ? id : null, productId: kind === "p" ? id : null, pctBps: Math.round(pct * 100), base: str(fd, "base") as "bruto", validFrom: str(fd, "validFrom"), note: optStr(fd, "note") });
    return "Regra salva. Vale para as próximas operações; o que já foi gerado não muda.";
  });
}
export async function endRuleAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/comissoes/regras", async () => { await endRule(await getDb(), ctx, str(fd, "id")); return "Regra encerrada."; });
}
export async function triggerAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/comissoes/regras", async () => { await setTrigger(await getDb(), ctx, str(fd, "trigger")); return "Política salva."; });
}
const period = (fd: FormData) => ({ start: str(fd, "de"), end: str(fd, "ate") });
const list = (fd: FormData) => `/comissoes?de=${str(fd, "de")}&ate=${str(fd, "ate")}`;
export async function approveAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(list(fd), async () => {
    const db = await getDb();
    const id = await approveSettlement(db, ctx, { staffId: str(fd, "staffId"), period: period(fd), note: optStr(fd, "note") });
    after(() => flushPush(db).catch((e) => console.error("[push]", e)));
    return { to: `/comissoes/${id}`, ok: "Repasse aprovado." };
  });
}
export async function adjustAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(list(fd), async () => { await addAdjustment(await getDb(), ctx, { staffId: str(fd, "staffId"), amountCents: money(str(fd, "amount"), "Valor"), reason: str(fd, "reason") }); return "Ajuste registrado."; });
}
export async function paySettlementAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/comissoes/${id}`, async () => {
    const db = await getDb();
    const f = fd.get("file");
    const file = f instanceof File && f.size > 0 ? { name: f.name, mime: f.type, bytes: new Uint8Array(await f.arrayBuffer()) } : null;
    const r = await paySettlement(db, ctx, { id, amountCents: money(str(fd, "amount"), "Valor"), accountId: str(fd, "accountId"), idempotencyKey: str(fd, "key"), evidence: optStr(fd, "evidence"), file });
    after(() => flushPush(db).catch((e) => console.error("[push]", e)));
    return r.duplicate ? "Este pagamento já havia sido registrado." : "Pagamento registrado.";
  });
}
export async function cancelSettlementAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(`/comissoes/${str(fd, "id")}`, async () => { await cancelSettlement(await getDb(), ctx, str(fd, "id"), str(fd, "reason")); return "Repasse cancelado. Os valores voltaram a ficar exigíveis."; });
}
export async function staffGoalAction(fd: FormData) {
  const { ctx } = await requireSession();
  const back = str(fd, "back") || "/equipe";
  await run(back, async () => {
    const metric = str(fd, "metric") as GoalMetric;
    const raw = str(fd, "target");
    const target = ["receita_servicos", "vendas_produtos", "ticket_medio"].includes(metric) ? money(raw, "Meta") : Number.parseInt(raw, 10);
    await saveStaffGoal(await getDb(), ctx, { staffId: str(fd, "staffId"), metric, month: str(fd, "month"), target });
    return "Meta salva.";
  });
}
export async function removeGoalAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(str(fd, "back") || "/equipe", async () => { await removeStaffGoal(await getDb(), ctx, str(fd, "id")); return "Meta removida."; });
}
