import crypto from "node:crypto";
import type { Db, Q } from "../db";
import { audit, need, requireText, requireUuid } from "../core";
import { checkPasswordStrength, hashPassword } from "../auth";
import { DomainError } from "../errors";
import { PERMISSIONS, ROLE_LABEL, ROLE_PERMISSIONS, type Ctx, type Permission, type Role } from "../permissions";
import { appUrl, mailHtml, sendMail } from "../mail";
import { assertRoleGrant } from "./bootstrap";
import { assertGrantable, clean } from "./access";
import { notifyUsers } from "./notify";

/**
 * Cadastro por convite e "esqueci a senha".
 * 1) Quem administra convida um e-mail com um perfil (Usuários e permissões, ou Equipe → profissional).
 * 2) A pessoa escolhe o perfil, informa o e-mail e recebe um código de 6 dígitos (válido por 15 minutos, 5 tentativas).
 * 3) Confirmado o código, ela cria a própria senha. Ninguém além dela conhece a senha.
 * A tela responde igual para e-mails com e sem convite/conta: não dá para descobrir quem tem acesso.
 */
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CODE_MIN = 15;
const MAX_CODE_TRIES = 5;
const MAX_SENDS = 5;
const RESEND_SEC = 45;
const FINISH_MIN = 20;

export type SignupChoice = "dono" | "barbeiro" | "admin";
export const SIGNUP_CHOICES: Record<SignupChoice, { label: string; sub: string; roles: Role[] }> = {
  dono: { label: "Dono de barbearia", sub: "Acesso total: equipe, financeiro e configurações.", roles: ["proprietario"] },
  barbeiro: { label: "Barbeiro colaborador", sub: "Sua agenda, seus atendimentos e seus resultados.", roles: ["barbeiro"] },
  admin: { label: "Administrador", sub: "Gestão do dia a dia: agenda, caixa, equipe e relatórios.", roles: ["gerente", "contador"] },
};
export const isChoice = (c: string): c is SignupChoice => c in SIGNUP_CHOICES;

export const maskEmail = (e: string) => {
  const [u, d] = e.split("@");
  return `${u.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, u.length - 2)))}@${d}`;
};
const normEmail = (e: string) => {
  const v = requireText(e, "E-mail").toLowerCase();
  if (!EMAIL_RE.test(v) || v.length > 200) throw new DomainError("invalid", "E-mail inválido.");
  return v;
};

// ---------- convites ----------
export interface InviteInput { email: string; fullName: string; role: Role; staffId?: string | null; profileId?: string | null; permissions?: string[] | null }
export interface InviteRow { id: string; email: string; full_name: string; role: Role; created_at: Date; expires_at: Date; accepted_at: Date | null; expired: boolean; staff_name: string | null; invited_by_name: string | null }

export async function createInvite(db: Db, ctx: Ctx, i: InviteInput): Promise<{ id: string; sent: boolean }> {
  need(ctx, "users.manage");
  const email = normEmail(i.email);
  const fullName = requireText(i.fullName, "Nome");
  let role = i.role;
  if (!(role in ROLE_PERMISSIONS)) throw new DomainError("invalid", "Perfil inválido.");
  let perms: Permission[] | null = null;
  const id = await db.tx(async (q) => {
    let profileId: string | null = null;
    if (i.profileId && role !== "proprietario") {
      const [p] = await q<{ base_role: Role; permissions: string[] }>("select base_role, permissions from access_profiles where id=$1 and unit_id=$2", [requireUuid(i.profileId, "Perfil"), ctx.unitId]);
      if (!p) throw new DomainError("not_found", "Perfil não encontrado.");
      role = p.base_role;
      perms = clean(p.permissions);
      profileId = i.profileId;
    } else if (i.permissions && role !== "proprietario") perms = clean(i.permissions);
    assertRoleGrant(ctx, role);
    if (perms) assertGrantable(ctx, perms, new Set());
    const [dup] = await q("select 1 from users where lower(email)=$1", [email]);
    if (dup) throw new DomainError("duplicate", "Já existe um acesso com este e-mail.");
    if (i.staffId) {
      const [s] = await q<{ user_id: string | null }>("select user_id from staff where id=$1 and unit_id=$2", [requireUuid(i.staffId, "Profissional"), ctx.unitId]);
      if (!s) throw new DomainError("not_found", "Profissional não encontrado.");
      if (s.user_id) throw new DomainError("duplicate", "Este profissional já tem acesso ao app.");
    }
    // convite novo substitui o anterior em aberto para o mesmo e-mail
    await q("update user_invites set revoked_at=now() where lower(email)=$1 and accepted_at is null and revoked_at is null", [email]);
    const [r] = await q<{ id: string }>(
      "insert into user_invites(unit_id,email,full_name,role,staff_id,profile_id,permissions,invited_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
      [ctx.unitId, email, fullName, role, i.staffId ?? null, profileId, perms, ctx.userId]);
    await audit(q, ctx, "CONVITE_CRIADO", "user_invite", r.id, null, { email, role, staffId: i.staffId ?? null });
    return r.id;
  });
  return { id, sent: await sendInviteMail(email, fullName, role) };
}

async function sendInviteMail(email: string, name: string, role: Role): Promise<boolean> {
  const choice = (Object.keys(SIGNUP_CHOICES) as SignupChoice[]).find((k) => SIGNUP_CHOICES[k].roles.includes(role))!;
  const link = `${appUrl()}/cadastro`;
  try {
    await sendMail({
      to: email,
      subject: "Seu convite para o MARFIM Studio OS",
      text: `Olá, ${name}!\n\nVocê foi convidado(a) para o MARFIM Studio OS como ${ROLE_LABEL[role]}.\n\nPara criar seu acesso, abra ${link}, toque em "${SIGNUP_CHOICES[choice].label}" e use este e-mail. Você vai receber um código para confirmar e depois cria a sua senha.\n\nO convite vale por 14 dias.`,
      html: mailHtml("Você foi convidado(a)", [`Olá, ${name}!`, `Você foi convidado(a) para o MARFIM Studio OS como ${ROLE_LABEL[role]}.`, `Para criar seu acesso, abra ${link}, toque em "${SIGNUP_CHOICES[choice].label}" e use este e-mail. Você recebe um código para confirmar e depois cria a sua senha.`, "O convite vale por 14 dias."]),
    });
    return true;
  } catch (e) {
    console.error("[convite] e-mail não enviado:", (e as Error).message);
    return false;
  }
}

export async function listInvites(db: Db, ctx: Ctx): Promise<InviteRow[]> {
  need(ctx, "users.manage");
  return db.query<InviteRow>(
    `select i.id, i.email, i.full_name, i.role, i.created_at, i.expires_at, i.accepted_at, (i.expires_at < now()) as expired, s.name as staff_name, u.full_name as invited_by_name
     from user_invites i left join staff s on s.id=i.staff_id left join users u on u.id=i.invited_by
     where i.unit_id=$1 and i.revoked_at is null and (i.accepted_at is null or i.accepted_at > now() - interval '7 days')
     order by i.accepted_at nulls first, i.created_at desc`, [ctx.unitId]);
}

export async function revokeInvite(db: Db, ctx: Ctx, id: string) {
  need(ctx, "users.manage");
  await db.tx(async (q) => {
    const r = await q("update user_invites set revoked_at=now() where id=$1 and unit_id=$2 and accepted_at is null and revoked_at is null returning email", [requireUuid(id, "Convite"), ctx.unitId]);
    if (!r.length) throw new DomainError("not_found", "Convite não encontrado ou já usado.");
    await q("delete from email_codes where invite_id=$1", [id]);
    await audit(q, ctx, "CONVITE_CANCELADO", "user_invite", id, r[0]);
  });
}

/** Reenvia o e-mail do convite e renova o prazo de 14 dias. */
export async function resendInvite(db: Db, ctx: Ctx, id: string): Promise<boolean> {
  need(ctx, "users.manage");
  const [i] = await db.query<{ email: string; full_name: string; role: Role }>(
    "update user_invites set expires_at=now() + interval '14 days' where id=$1 and unit_id=$2 and accepted_at is null and revoked_at is null returning email, full_name, role", [requireUuid(id, "Convite"), ctx.unitId]);
  if (!i) throw new DomainError("not_found", "Convite não encontrado ou já usado.");
  return sendInviteMail(i.email, i.full_name, i.role);
}

// ---------- código por e-mail ----------
type Purpose = "cadastro" | "senha";
interface FlowRow { id: string; purpose: Purpose; email: string; invite_id: string | null; user_id: string | null; code_hash: string | null; attempts: number; sends: number; last_sent_at: Date | null; expires_at: Date; verified_at: Date | null; used_at: Date | null }

const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

async function sendCode(email: string, purpose: Purpose, code: string) {
  const what = purpose === "cadastro" ? "criar seu acesso" : "redefinir sua senha";
  await sendMail({
    to: email,
    subject: `${code} é o seu código MARFIM`,
    text: `Seu código para ${what} no MARFIM Studio OS é: ${code}\n\nEle vale por ${CODE_MIN} minutos. Se você não pediu, ignore este e-mail.`,
    html: mailHtml(purpose === "cadastro" ? "Confirme seu e-mail" : "Redefinir senha", [`Use o código abaixo para ${what}. Ele vale por ${CODE_MIN} minutos.`], code),
  });
}

/** Abre o fluxo e devolve o identificador (vai em cookie). Só envia código se houver convite/conta. */
async function openFlow(db: Db, purpose: Purpose, email: string, target: { inviteId?: string; userId?: string } | null): Promise<string> {
  const flow = crypto.randomBytes(32).toString("base64url");
  const code = target ? newCode() : null;
  const [r] = await db.query<{ id: string }>(
    `insert into email_codes(purpose,email,invite_id,user_id,flow_hash,sends,last_sent_at,expires_at)
     values ($1,$2,$3,$4,$5,$6,now(),now() + make_interval(mins => $7)) returning id`,
    [purpose, email, target?.inviteId ?? null, target?.userId ?? null, sha(flow), code ? 1 : 0, CODE_MIN]);
  if (code) {
    await db.query("update email_codes set code_hash=$2 where id=$1", [r.id, sha(`${r.id}:${code}`)]);
    try {
      await sendCode(email, purpose, code);
    } catch (e) {
      await db.query("delete from email_codes where id=$1", [r.id]);
      throw e;
    }
  }
  return flow;
}

export async function startSignup(db: Db, choice: string, emailIn: string): Promise<string> {
  if (!isChoice(choice)) throw new DomainError("invalid", "Escolha o tipo de acesso.");
  const email = normEmail(emailIn);
  const [inv] = await db.query<{ id: string }>(
    "select id from user_invites where lower(email)=$1 and role = any($2) and accepted_at is null and revoked_at is null and expires_at > now() and not exists (select 1 from users u where lower(u.email)=$1)",
    [email, SIGNUP_CHOICES[choice].roles]);
  return openFlow(db, "cadastro", email, inv ? { inviteId: inv.id } : null);
}

export async function startPasswordReset(db: Db, emailIn: string): Promise<string> {
  const email = normEmail(emailIn);
  const [u] = await db.query<{ id: string }>("select id from users where lower(email)=$1 and is_active", [email]);
  return openFlow(db, "senha", email, u ? { userId: u.id } : null);
}

async function flowRow(q: Q, flow: string | undefined, lock = false): Promise<FlowRow | null> {
  if (!flow) return null;
  const [r] = await q<FlowRow>(`select * from email_codes where flow_hash=$1 and used_at is null and created_at > now() - interval '1 hour'${lock ? " for update" : ""}`, [sha(flow)]);
  return r ?? null;
}

export interface FlowInfo { purpose: Purpose; email: string; verified: boolean; fullName: string | null; role: Role | null; canResendIn: number }
export async function flowInfo(db: Db, flow: string | undefined): Promise<FlowInfo | null> {
  const r = await flowRow(db.query, flow);
  if (!r) return null;
  const [inv] = r.invite_id ? await db.query<{ full_name: string; role: Role }>("select full_name, role from user_invites where id=$1", [r.invite_id]) : [];
  const since = r.last_sent_at ? (Date.now() - new Date(r.last_sent_at).getTime()) / 1000 : RESEND_SEC;
  return { purpose: r.purpose, email: maskEmail(r.email), verified: !!r.verified_at, fullName: inv?.full_name ?? null, role: inv?.role ?? null, canResendIn: Math.max(0, Math.ceil(RESEND_SEC - since)) };
}

export async function resendCode(db: Db, flow: string | undefined) {
  await db.tx(async (q) => {
    const r = await flowRow(q, flow, true);
    if (!r) throw new DomainError("expired", "Este pedido expirou. Comece de novo.");
    if (r.verified_at) return;
    if (r.last_sent_at && Date.now() - new Date(r.last_sent_at).getTime() < RESEND_SEC * 1000) throw new DomainError("wait", "Aguarde alguns segundos antes de pedir outro código.");
    if (!r.code_hash && !r.invite_id && !r.user_id) { await q("update email_codes set last_sent_at=now() where id=$1", [r.id]); return; } // sem convite/conta: nada a enviar
    if (r.sends >= MAX_SENDS) throw new DomainError("too_many", "Limite de reenvios atingido. Comece de novo em alguns minutos.");
    const code = newCode();
    await q("update email_codes set code_hash=$2, attempts=0, sends=sends+1, last_sent_at=now(), expires_at=now() + make_interval(mins => $3) where id=$1", [r.id, sha(`${r.id}:${code}`), CODE_MIN]);
    await sendCode(r.email, r.purpose, code);
  });
}

export async function verifyCode(db: Db, flow: string | undefined, codeIn: string): Promise<Purpose> {
  const code = codeIn.replace(/\D/g, "");
  const out = await db.tx(async (q): Promise<DomainError | Purpose> => {
    const r = await flowRow(q, flow, true);
    if (!r) return new DomainError("expired", "Este pedido expirou. Comece de novo.");
    if (r.verified_at) return r.purpose;
    if (r.attempts >= MAX_CODE_TRIES) return new DomainError("too_many", "Código errado muitas vezes. Peça um novo código.");
    if (new Date(r.expires_at).getTime() < Date.now()) return new DomainError("expired", "O código expirou. Peça um novo código.");
    const ok = !!r.code_hash && code.length === 6 && crypto.timingSafeEqual(Buffer.from(r.code_hash), Buffer.from(sha(`${r.id}:${code}`)));
    if (!ok) {
      // a tentativa errada fica gravada: por isso a transação devolve o erro em vez de lançar
      await q("update email_codes set attempts=attempts+1 where id=$1", [r.id]);
      const left = MAX_CODE_TRIES - r.attempts - 1;
      return new DomainError("bad_code", left > 0 ? `Código incorreto. ${left === 1 ? "Resta 1 tentativa" : `Restam ${left} tentativas`}.` : "Código errado muitas vezes. Peça um novo código.");
    }
    await q("update email_codes set verified_at=now() where id=$1", [r.id]);
    return r.purpose;
  });
  if (out instanceof DomainError) throw out;
  return out;
}

async function verifiedRow(q: Q, flow: string | undefined, purpose: Purpose) {
  const r = await flowRow(q, flow, true);
  if (!r || r.purpose !== purpose || !r.verified_at) throw new DomainError("expired", "Confirme o código enviado ao seu e-mail primeiro.");
  if (Date.now() - new Date(r.verified_at).getTime() > FINISH_MIN * 60000) throw new DomainError("expired", "O tempo para concluir acabou. Comece de novo.");
  return r;
}

/** Conclui o cadastro: cria o usuário com o perfil do convite e a senha escolhida pela própria pessoa. Devolve o e-mail. */
export async function finishSignup(db: Db, flow: string | undefined, i: { fullName: string; password: string }): Promise<string> {
  checkPasswordStrength(i.password);
  const fullName = requireText(i.fullName, "Seu nome");
  return db.tx(async (q) => {
    const r = await verifiedRow(q, flow, "cadastro");
    const [inv] = await q<{ id: string; unit_id: string; email: string; role: Role; staff_id: string | null; profile_id: string | null; permissions: string[] | null; invited_by: string | null }>(
      "select * from user_invites where id=$1 and accepted_at is null and revoked_at is null and expires_at > now() for update", [r.invite_id]);
    if (!inv) throw new DomainError("expired", "Este convite não está mais válido. Peça um novo convite.");
    const [dup] = await q("select 1 from users where lower(email)=lower($1)", [inv.email]);
    if (dup) throw new DomainError("duplicate", "Já existe um acesso com este e-mail. Use Entrar.");
    const [u] = await q<{ id: string }>("insert into users(email,full_name,password_hash) values ($1,$2,$3) returning id", [inv.email.toLowerCase(), fullName, hashPassword(i.password)]);
    await q("insert into user_units(user_id,unit_id,role,profile_id) values ($1,$2,$3,$4)", [u.id, inv.unit_id, inv.role, inv.profile_id]);
    if (inv.permissions && inv.role !== "proprietario") {
      const want = new Set<string>(inv.permissions);
      want.add("tasks.own");
      for (const p of PERMISSIONS) {
        if (p === "tasks.own") continue;
        const base = ROLE_PERMISSIONS[inv.role].has(p), on = want.has(p);
        if (base !== on) await q("insert into permission_overrides(user_id,unit_id,permission,granted) values ($1,$2,$3,$4)", [u.id, inv.unit_id, p, on]);
      }
    }
    if (inv.staff_id) await q("update staff set user_id=$1 where id=$2 and unit_id=$3 and user_id is null", [u.id, inv.staff_id, inv.unit_id]);
    await q("update user_invites set accepted_at=now(), accepted_user_id=$2 where id=$1", [inv.id, u.id]);
    await q("update email_codes set used_at=now() where id=$1", [r.id]);
    await audit(q, { userId: u.id, unitId: inv.unit_id }, "CONVITE_ACEITO", "user", u.id, null, { email: inv.email, role: inv.role, inviteId: inv.id });
    if (inv.invited_by) await notifyUsers(q, { unitId: inv.unit_id, userIds: [inv.invited_by], kind: "acesso_convite_aceito", message: `${fullName} criou o acesso (${ROLE_LABEL[inv.role]}).`, url: "/admin/usuarios", dedupe: `convite:${inv.id}` });
    return inv.email;
  });
}

/** Conclui o "esqueci a senha": troca a senha, desbloqueia a conta e encerra as sessões abertas. A verificação em duas etapas continua valendo. */
export async function finishPasswordReset(db: Db, flow: string | undefined, password: string): Promise<string> {
  checkPasswordStrength(password);
  return db.tx(async (q) => {
    const r = await verifiedRow(q, flow, "senha");
    const [u] = await q<{ id: string; email: string }>("update users set password_hash=$2, failed_attempts=0, locked_until=null where id=$1 and is_active returning id, email", [r.user_id, hashPassword(password)]);
    if (!u) throw new DomainError("expired", "Conta não encontrada ou inativa.");
    await q("delete from sessions where user_id=$1", [u.id]);
    await q("update email_codes set used_at=now() where id=$1", [r.id]);
    await audit(q, { userId: u.id }, "SENHA_REDEFINIDA_EMAIL", "user", u.id);
    return u.email;
  });
}
