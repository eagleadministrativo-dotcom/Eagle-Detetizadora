"use server";
import { getDb } from "@/server/db";
import { bool, int, optStr, requireSession, run, str } from "@/server/session";
import { registerContact, saveContactPrefs, saveReturnRule, saveReturnSettings, snoozeReturn } from "@/server/services/returns";
import { ruleFromForm } from "@/lib/recurrence";

const back = (fd: FormData) => str(fd, "back") || "/retornos";
export async function contactAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(back(fd), async () => {
    await registerContact(await getDb(), ctx, { customerId: str(fd, "customerId"), outcome: str(fd, "outcome") as "contatado", note: optStr(fd, "note"), optOut: bool(fd, "optOut"), idempotencyKey: str(fd, "key") });
    return "Contato registrado.";
  });
}
export async function snoozeAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(back(fd), async () => { await snoozeReturn(await getDb(), ctx, str(fd, "customerId"), str(fd, "until")); return "Contato adiado."; });
}
export async function returnRuleAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(back(fd), async () => {
    const f = str(fd, "freq");
    await saveReturnRule(await getDb(), ctx, { customerId: str(fd, "customerId"), staffId: optStr(fd, "staffId"), rule: ruleFromForm((k) => str(fd, k)), noFollow: bool(fd, "noFollow"), clear: !f && !bool(fd, "noFollow") });
    return "Regra de retorno salva.";
  });
}
export async function contactPrefsAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run(back(fd), async () => { await saveContactPrefs(await getDb(), ctx, { customerId: str(fd, "customerId"), optOut: bool(fd, "optOut"), channel: str(fd, "channel"), preferredStaffId: optStr(fd, "preferredStaffId") }); return "Preferências do cliente salvas."; });
}
export async function returnSettingsAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/configuracoes", async () => { await saveReturnSettings(await getDb(), ctx, { defaultDays: int(fd, "defaultDays"), gapDays: int(fd, "gapDays"), soonDays: int(fd, "soonDays"), notify: bool(fd, "notify") }); return "Regras de retorno salvas."; });
}
