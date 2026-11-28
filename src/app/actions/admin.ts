"use server";
import { getDb } from "@/server/db";
import { requireSession, run, str, optStr, bool } from "@/server/session";
import { saveService, saveCategory, savePaymentMethod, saveChair, saveStaff, saveFinancialCategory, saveFinancialAccount, updateSettings, updateBusinessHours } from "@/server/services/catalog";
import { resetUserPassword, updateUser } from "@/server/services/bootstrap";
import { setUserModules, setInviteModules } from "@/server/services/access";
import { DomainError } from "@/server/errors";
import type { Role } from "@/server/permissions";
import { createInvite, resendInvite, revokeInvite, updateInvite } from "@/server/services/invites";
import { appUrl } from "@/server/mail";
import { atLocal } from "@/lib/dates";
import { parseBRL } from "@/lib/money";

const need$ = (fd: FormData, k: string, label: string) => {
  const v = parseBRL(str(fd, k));
  if (v == null) throw new DomainError("invalid", `${label} inválido. Use o formato 12,50.`);
  return v;
};

export async function saveServiceAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = optStr(fd, "id");
  await run(id ? `/admin/servicos/${id}` : "/admin/servicos/novo", async () => {
    const priceRaw = str(fd, "price");
    const validFrom = optStr(fd, "validFrom");
    const customFields = [0, 1, 2, 3, 4].map((i) => ({ label: str(fd, `cf_label${i}`), value: str(fd, `cf_value${i}`) })).filter((f) => f.label);
    const saved = await saveService(await getDb(), ctx, {
      id: id ?? undefined, name: str(fd, "name"), description: optStr(fd, "description"), categoryId: optStr(fd, "categoryId"), durationMinutes: Number(str(fd, "duration")), bufferMinutes: Number(str(fd, "buffer") || 0),
      color: optStr(fd, "color"), sortOrder: Number(str(fd, "sort") || 0), isActive: id ? bool(fd, "isActive") : true,
      priceCents: priceRaw ? need$(fd, "price", "Preço") : undefined, priceValidFrom: validFrom ? atLocal(validFrom, "00:00") : undefined,
      staffIds: fd.getAll("staffIds").map(String), customFields,
    });
    return { to: `/admin/servicos/${saved}`, ok: "Serviço salvo." };
  });
}

export async function saveServiceCategoryAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/servicos", async () => {
    await saveCategory(await getDb(), ctx, { id: optStr(fd, "id") ?? undefined, name: str(fd, "name"), sortOrder: Number(str(fd, "sort") || 0), isActive: optStr(fd, "id") ? bool(fd, "isActive") : true });
    return "Categoria salva.";
  });
}

export async function saveStaffAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/equipe", async () => {
    const schedules: { day: number; start: string; end: string }[] = [];
    for (let d = 0; d < 7; d++) {
      const a = str(fd, `s_${d}`), b = str(fd, `e_${d}`);
      if (a && b) schedules.push({ day: d, start: a, end: b });
    }
    const id = optStr(fd, "id");
    const db = await getDb();
    const staffId = await saveStaff(db, ctx, { id: id ?? undefined, name: str(fd, "name"), phone: optStr(fd, "phone"), contractType: optStr(fd, "contractType"), color: str(fd, "color") || "#8B6B4A", isActive: id ? bool(fd, "isActive") : true, schedules });
    const email = optStr(fd, "inviteEmail");
    if (!email) return "Profissional salvo.";
    const role = (str(fd, "role") || "tecnico") as Role;
    const r = await createInvite(db, ctx, { email, fullName: str(fd, "name"), role, staffId, permissions: fd.has("role") ? fd.getAll("perm").map(String) : null });
    return r.sent ? "Profissional salvo e convite enviado por e-mail." : `Profissional salvo e convite criado. O e-mail não foi enviado: passe o link ${appUrl()}/cadastro para a pessoa.`;
  });
}

export async function saveChairAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/cadeiras", async () => {
    const id = optStr(fd, "id");
    await saveChair(await getDb(), ctx, { id: id ?? undefined, name: str(fd, "name"), isActive: id ? bool(fd, "isActive") : true });
    return "Local salvo.";
  });
}

export async function saveBusinessHoursAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/cadeiras", async () => {
    const hours: Record<string, [string, string][]> = {};
    for (let d = 0; d < 7; d++) {
      const a = str(fd, `s_${d}`), b = str(fd, `e_${d}`);
      if (a && b) hours[String(d)] = [[a, b]];
    }
    await updateBusinessHours(await getDb(), ctx, hours);
    return "Horário de funcionamento salvo.";
  });
}

export async function savePaymentMethodAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/financeiro", async () => {
    const id = optStr(fd, "id");
    const fee = Number(str(fd, "fee").replace(",", ".") || 0);
    if (!Number.isFinite(fee)) throw new DomainError("invalid", "Taxa inválida.");
    await savePaymentMethod(await getDb(), ctx, {
      id: id ?? undefined, name: str(fd, "name"), kind: str(fd, "kind"), feePercent: fee, feeFixedCents: str(fd, "fixed") ? need$(fd, "fixed", "Taxa fixa") : 0,
      settlementDays: Number(str(fd, "days") || 0), accountId: optStr(fd, "accountId"), isActive: id ? bool(fd, "isActive") : true,
    });
    return "Forma de pagamento salva.";
  });
}

export async function saveFinCategoryAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/financeiro", async () => {
    const id = optStr(fd, "id");
    await saveFinancialCategory(await getDb(), ctx, { id: id ?? undefined, name: str(fd, "name"), kind: str(fd, "kind"), accountCode: optStr(fd, "code"), isActive: id ? bool(fd, "isActive") : true });
    return "Categoria salva.";
  });
}

export async function saveAccountAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/financeiro", async () => {
    const id = optStr(fd, "id");
    await saveFinancialAccount(await getDb(), ctx, { id: id ?? undefined, name: str(fd, "name"), kind: str(fd, "kind"), openingBalanceCents: str(fd, "opening") ? need$(fd, "opening", "Saldo inicial") : 0, isActive: id ? bool(fd, "isActive") : true });
    return "Conta salva.";
  });
}

export async function updateSettingsAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/configuracoes", async () => {
    const limitRaw = str(fd, "limit");
    await updateSettings(await getDb(), ctx, {
      discount_owner_only: bool(fd, "ownerOnly"),
      discount_limit_bps: limitRaw ? Math.round(Number(limitRaw.replace(",", ".")) * 100) : null,
      retroactive_edit_days: Number(str(fd, "retro") || 0),
      no_show_policy: str(fd, "noShow") === "cobrar_taxa" ? "cobrar_taxa" : "apenas_registrar",
      no_show_fee_cents: str(fd, "noShowFee") ? need$(fd, "noShowFee", "Taxa de não comparecimento") : null,
      tax_regime: optStr(fd, "tax"),
      customer_retention_months: str(fd, "retention") ? Number(str(fd, "retention")) : null,
    });
    return "Configurações salvas.";
  });
}

export async function inviteUserAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/usuarios", async () => {
    const profileId = str(fd, "profileId");
    const r = await createInvite(await getDb(), ctx, {
      email: str(fd, "email"), fullName: str(fd, "name"), role: str(fd, "role") as Role, staffId: optStr(fd, "staffId"),
      profileId: profileId || null, permissions: profileId ? null : fd.getAll("perm").map(String),
    });
    return r.sent ? "Convite enviado por e-mail. A pessoa cria o próprio acesso em Cadastrar." : `Convite criado, mas o e-mail não foi enviado. Passe o link ${appUrl()}/cadastro para a pessoa.`;
  });
}

export async function updateInviteAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/admin/usuarios/convite/${id}`, async () => {
    await updateInvite(await getDb(), ctx, id, { fullName: str(fd, "name"), role: str(fd, "role") as Role, staffId: optStr(fd, "staffId"), permissions: fd.getAll("perm").map(String) });
    return { to: "/admin/usuarios", ok: "Convite atualizado. Vale quando a pessoa criar o acesso; não precisa reenviar." };
  });
}

export async function revokeInviteAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/usuarios", async () => {
    await revokeInvite(await getDb(), ctx, str(fd, "id"));
    return "Convite cancelado.";
  });
}

export async function resendInviteAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/usuarios", async () => {
    const sent = await resendInvite(await getDb(), ctx, str(fd, "id"));
    return sent ? "Convite reenviado e renovado por 14 dias." : "Convite renovado por 14 dias, mas o e-mail não foi enviado.";
  });
}

export async function updateUserAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/usuarios", async () => {
    await updateUser(await getDb(), ctx, str(fd, "id"), { role: str(fd, "role") as Role, isActive: bool(fd, "isActive") });
    return "Usuário atualizado.";
  });
}

export async function resetPasswordAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/usuarios", async () => {
    await resetUserPassword(await getDb(), ctx, str(fd, "id"), str(fd, "password"));
    return "Senha redefinida e sessões do usuário encerradas.";
  });
}

export async function setUserModulesAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/usuarios", async () => {
    await setUserModules(await getDb(), ctx, str(fd, "userId"), fd.getAll("modules").map(String));
    return "Módulos atualizados.";
  });
}

export async function setInviteModulesAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/usuarios", async () => {
    await setInviteModules(await getDb(), ctx, str(fd, "inviteId"), fd.getAll("modules").map(String));
    return "Módulos do convite atualizados.";
  });
}
