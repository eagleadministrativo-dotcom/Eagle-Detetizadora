import crypto from "node:crypto";
import type { Db, Q } from "./db";
import { audit } from "./core";
import { DomainError } from "./errors";
import { buildPerms, type Ctx, type Role } from "./permissions";

// ---------- senha (scrypt) ----------
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}
export function checkPasswordStrength(pw: string) {
  if (pw.length < 10) throw new DomainError("weak_password", "A senha deve ter pelo menos 10 caracteres.");
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) throw new DomainError("weak_password", "A senha deve combinar letras e números.");
}

// ---------- TOTP (RFC 6238) ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const i = B32.indexOf(c);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));
export function totpAt(secret: string, timeMs: number, step = 30, digits = 6): string {
  const counter = Math.floor(timeMs / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = (((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 10 ** digits;
  return String(code).padStart(digits, "0");
}
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  for (const drift of [-1, 0, 1]) {
    if (totpAt(secret, now + drift * 30000) === c) return true;
  }
  return false;
}
export const totpUri = (secret: string, email: string) =>
  `otpauth://totp/MARFIM%20Studio%20OS:${encodeURIComponent(email)}?secret=${secret}&issuer=MARFIM%20Studio%20OS`;

// ---------- sessões ----------
const SESSION_HOURS = 12;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export interface LoginResult {
  token: string;
  needsMfa: boolean; // precisa informar código
  needsMfaSetup: boolean; // precisa cadastrar o autenticador
  /** Entrou com senha provisória: não há sessão (token vazio); mandar link ao e-mail para criar a senha. */
  emailLink?: { purpose: "cadastro" | "senha"; email: string; inviteId?: string; userId?: string };
}

// Senha: 3 erros bloqueiam por 10 minutos (e a tela oferece "esqueci a senha"). Código do autenticador: 5 erros, 15 minutos.
export const LOGIN_MAX_FAILS = 3;
export const LOGIN_LOCK_MINUTES = 10;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
export const LOCKED_MSG = `Senha incorreta ${LOGIN_MAX_FAILS} vezes. Por segurança, novas tentativas ficam bloqueadas por ${LOGIN_LOCK_MINUTES} minutos. Você pode redefinir a senha pelo e-mail.`;
const stillLocked = (min: number) => { const m = Math.max(1, Math.ceil(min)); return `Acesso bloqueado por tentativas erradas. Tente de novo em ${m} minuto${m > 1 ? "s" : ""} ou redefina a senha pelo e-mail.`; };

async function mfaRequiredFor(q: Q, unitId: string, role: Role): Promise<boolean> {
  if (role !== "administrador" && role !== "gerente") return false;
  const [s] = await q<{ mfa_required: boolean }>("select mfa_required from unit_settings where unit_id=$1", [unitId]);
  return s?.mfa_required ?? true;
}

export async function login(db: Db, email: string, password: string): Promise<LoginResult> {
  // Falhas precisam ser gravadas (contador de bloqueio e auditoria): por isso a transação devolve o erro em vez de lançá-lo,
  // senão o ROLLBACK desfaria o registro da tentativa.
  const out = await db.tx(async (q): Promise<{ error: DomainError } | { result: LoginResult }> => {
    const generic = new DomainError("bad_credentials", "E-mail ou senha incorretos.");
    const [u] = await q<{ id: string; email: string; password_hash: string; is_active: boolean; failed_attempts: number; locked_until: Date | null; mfa_enabled: boolean; must_change_password: boolean }>(
      "select id,email,password_hash,is_active,failed_attempts,locked_until,mfa_enabled,must_change_password from users where lower(email)=lower($1) for update",
      [email.trim()],
    );
    const locked = new DomainError("locked", LOCKED_MSG);
    if (!u) {
      const key = `login:email:${email.trim().toLowerCase().slice(0, 190)}`;
      const [cur] = await q<{ hits: number; left: number }>(`select hits, extract(epoch from window_start + make_interval(mins => $2) - now())::float / 60 as left from rate_limits where key=$1 and window_start > now() - make_interval(mins => $2)`, [key, LOGIN_LOCK_MINUTES]);
      if (cur && cur.hits >= LOGIN_MAX_FAILS) return { error: new DomainError("locked", stillLocked(cur.left)) };
      // convidado entrando com a senha provisória: sem sessão; o app manda um link ao e-mail para criar a senha
      const [inv] = await q<{ id: string; temp: string | null }>(
        `select i.id, s.temp_password_hash as temp from user_invites i join unit_settings s on s.unit_id=i.unit_id
         where lower(i.email)=lower($1) and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() order by i.created_at desc limit 1`, [email.trim()]);
      if (inv?.temp && verifyPassword(password, inv.temp)) return { result: { token: "", needsMfa: false, needsMfaSetup: false, emailLink: { purpose: "cadastro", email: email.trim().toLowerCase(), inviteId: inv.id } } };
      if (!inv?.temp) verifyPassword(password, "scrypt$00$00"); // custo aproximadamente constante
      // e-mail sem conta se comporta igual a uma conta real (bloqueia na 3ª), para não revelar quem tem acesso
      const [fl] = await q<{ hits: number; left: number }>(
        `insert into rate_limits(key, window_start, hits) values ($1, now(), 1)
         on conflict (key) do update set
           hits = case when rate_limits.window_start < now() - make_interval(mins => $2) then 1 else rate_limits.hits + 1 end,
           window_start = case when rate_limits.window_start < now() - make_interval(mins => $2) then now() else rate_limits.window_start end
         returning hits, extract(epoch from window_start + make_interval(mins => $2) - now())::float / 60 as left`, [key, LOGIN_LOCK_MINUTES]);
      return { error: fl.hits === LOGIN_MAX_FAILS ? locked : fl.hits > LOGIN_MAX_FAILS ? new DomainError("locked", stillLocked(fl.left)) : generic };
    }
    if (u.locked_until && u.locked_until.getTime() > Date.now()) return { error: new DomainError("locked", stillLocked((u.locked_until.getTime() - Date.now()) / 60000)) };
    if (!u.is_active || !verifyPassword(password, u.password_hash)) {
      const fails = u.failed_attempts + 1;
      const lock = fails >= LOGIN_MAX_FAILS ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60000) : null;
      await q("update users set failed_attempts=$2, locked_until=$3 where id=$1", [u.id, lock ? 0 : fails, lock]);
      await audit(q, { userId: u.id }, "LOGIN_FALHA", "user", u.id, null, { tentativas: fails, bloqueado: !!lock });
      if (lock) await notifyLock(q, u.id);
      return { error: lock ? locked : generic };
    }
    const [uu] = await q<{ unit_id: string; role: Role }>("select unit_id, role from user_units where user_id=$1 order by role limit 1", [u.id]);
    if (!uu) return { error: new DomainError("no_unit", "Usuário sem unidade vinculada.") };
    if (u.must_change_password) {
      // senha provisória: confirma o e-mail por link antes de liberar o acesso
      await q("update users set failed_attempts=0, locked_until=null where id=$1", [u.id]);
      await audit(q, { userId: u.id, unitId: uu.unit_id }, "LOGIN_SENHA_PROVISORIA", "user", u.id);
      return { result: { token: "", needsMfa: false, needsMfaSetup: false, emailLink: { purpose: "senha", email: u.email, userId: u.id } } };
    }
    await q("update users set failed_attempts=0, locked_until=null, last_login_at=now() where id=$1", [u.id]);
    const mfaReq = await mfaRequiredFor(q, uu.unit_id, uu.role);
    const needsMfa = u.mfa_enabled;
    const needsMfaSetup = mfaReq && !u.mfa_enabled;
    const token = crypto.randomBytes(32).toString("base64url");
    await q("insert into sessions(id,user_id,unit_id,mfa_verified,expires_at) values ($1,$2,$3,$4,$5)", [
      sha(token), u.id, uu.unit_id, !needsMfa && !needsMfaSetup, new Date(Date.now() + SESSION_HOURS * 3600000),
    ]);
    await audit(q, { userId: u.id, unitId: uu.unit_id }, "LOGIN", "user", u.id);
    return { result: { token, needsMfa, needsMfaSetup } };
  });
  if ("error" in out) throw out.error;
  return out.result;
}

async function notifyLock(q: Q, userId: string) {
  await q(
    "insert into notifications(unit_id,kind,severity,message,ref_entity,ref_id) select unit_id,'login_bloqueado','atencao',$2,'user',$1 from user_units where role='administrador'",
    [userId, "Conta bloqueada por tentativas de login repetidas."],
  );
}

export async function verifyMfaForSession(db: Db, token: string, code: string) {
  const out = await db.tx(async (q): Promise<DomainError | null> => {
    const [s] = await q<{ user_id: string; unit_id: string; secret: string | null; failed_attempts: number }>(
      "select s.user_id, s.unit_id, u.mfa_secret as secret, u.failed_attempts from sessions s join users u on u.id=s.user_id where s.id=$1 and s.expires_at>now() for update of u",
      [sha(token)],
    );
    if (!s || !s.secret) return new DomainError("no_session", "Sessão inválida.");
    const recovery = isRecoveryCode(code) ? await redeemRecoveryCode(q, s.user_id, code) : false;
    if (recovery) await audit(q, { userId: s.user_id, unitId: s.unit_id }, "MFA_CODIGO_RECUPERACAO", "user", s.user_id);
    if (!recovery && !verifyTotp(s.secret, code)) {
      const fails = s.failed_attempts + 1;
      const lock = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60000) : null;
      await q("update users set failed_attempts=$2, locked_until=$3 where id=$1", [s.user_id, lock ? 0 : fails, lock]);
      await audit(q, { userId: s.user_id, unitId: s.unit_id }, "MFA_FALHA", "user", s.user_id, null, { tentativas: fails, bloqueado: !!lock });
      if (lock) {
        await q("delete from sessions where user_id=$1", [s.user_id]);
        await notifyLock(q, s.user_id);
        return new DomainError("locked", "Muitas tentativas. Entre novamente em alguns minutos.");
      }
      return new DomainError("bad_mfa", "Código incorreto.");
    }
    await q("update users set failed_attempts=0 where id=$1", [s.user_id]);
    await q("update sessions set mfa_verified=true where id=$1", [sha(token)]);
    await audit(q, { userId: s.user_id, unitId: s.unit_id }, "MFA_OK", "user", s.user_id);
    return null;
  });
  if (out) throw out;
}

// ---------- códigos de recuperação ----------
/** Formato XXXX-XXXX (sem letras ambíguas). Guardados só como hash; cada um vale uma vez. */
const RC_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const normRc = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const isRecoveryCode = (c: string) => normRc(c).length === 8 && /[A-Z]/.test(normRc(c));
async function redeemRecoveryCode(q: Q, userId: string, code: string): Promise<boolean> {
  const r = await q("update mfa_recovery_codes set used_at=now() where id = (select id from mfa_recovery_codes where user_id=$1 and code_hash=$2 and used_at is null limit 1) returning id", [userId, sha(normRc(code))]);
  return r.length > 0;
}
/** Gera 8 códigos novos (os anteriores deixam de valer). Os valores só existem nesta resposta. */
export async function generateRecoveryCodes(db: Db, userId: string): Promise<string[]> {
  // o primeiro caractere é sempre letra: o código nunca se confunde com os 6 dígitos do autenticador
  const codes = Array.from({ length: 8 }, () => {
    const c = Array.from(crypto.randomBytes(8), (x, i) => (i === 0 ? RC_ALPHA[x % 24] : RC_ALPHA[x % RC_ALPHA.length])).join("");
    return `${c.slice(0, 4)}-${c.slice(4)}`;
  });
  await db.tx(async (q) => {
    const [u] = await q<{ mfa_enabled: boolean }>("select mfa_enabled from users where id=$1", [userId]);
    if (!u?.mfa_enabled) throw new DomainError("no_mfa", "Ative a verificação em duas etapas antes de gerar os códigos.");
    await q("delete from mfa_recovery_codes where user_id=$1", [userId]);
    for (const c of codes) await q("insert into mfa_recovery_codes(user_id, code_hash) values ($1,$2)", [userId, sha(normRc(c))]);
    await audit(q, { userId }, "MFA_CODIGOS_GERADOS", "user", userId, null, { quantidade: codes.length });
  });
  return codes;
}
export async function recoveryCodesLeft(db: Db, userId: string): Promise<number> {
  const [r] = await db.query<{ n: number }>("select count(*)::bigint as n from mfa_recovery_codes where user_id=$1 and used_at is null", [userId]);
  return r.n;
}

/** Etapa 1 do cadastro de autenticador: gera segredo (ainda inativo). */
export async function beginMfaSetup(db: Db, userId: string): Promise<string> {
  const secret = newTotpSecret();
  await db.query("update users set mfa_secret=$2, mfa_enabled=false where id=$1", [userId, secret]);
  return secret;
}
/** Etapa 2: confirma com um código válido e ativa. */
export async function completeMfaSetup(db: Db, token: string, userId: string, code: string) {
  await db.tx(async (q) => {
    const [u] = await q<{ mfa_secret: string | null }>("select mfa_secret from users where id=$1", [userId]);
    if (!u?.mfa_secret || !verifyTotp(u.mfa_secret, code)) throw new DomainError("bad_mfa", "Código incorreto. Confira o aplicativo autenticador.");
    await q("update users set mfa_enabled=true where id=$1", [userId]);
    await q("update sessions set mfa_verified=true where id=$1", [sha(token)]);
    await audit(q, { userId }, "MFA_ATIVADO", "user", userId);
  });
}

export interface SessionInfo {
  ctx: Ctx;
  user: { id: string; email: string; fullName: string; mfaEnabled: boolean };
  mfaVerified: boolean;
  token: string;
}

export async function getSession(db: Db, token: string | undefined): Promise<SessionInfo | null> {
  if (!token) return null;
  const rows = await db.query<{
    user_id: string; unit_id: string; mfa_verified: boolean; email: string; full_name: string; mfa_enabled: boolean; is_active: boolean; role: Role; staff_id: string | null;
  }>(
    `select s.user_id, s.unit_id, s.mfa_verified, u.email, u.full_name, u.mfa_enabled, u.is_active, uu.role,
            (select id from staff st where st.user_id = u.id and st.unit_id = s.unit_id limit 1) as staff_id
     from sessions s
     join users u on u.id = s.user_id
     join user_units uu on uu.user_id = u.id and uu.unit_id = s.unit_id
     where s.id = $1 and s.expires_at > now()`,
    [sha(token)],
  );
  const r = rows[0];
  if (!r || !r.is_active) return null;
  const overrides = await db.query<{ permission: string; granted: boolean }>("select permission, granted from permission_overrides where user_id=$1 and unit_id=$2", [r.user_id, r.unit_id]);
  return {
    token,
    mfaVerified: r.mfa_verified,
    user: { id: r.user_id, email: r.email, fullName: r.full_name, mfaEnabled: r.mfa_enabled },
    ctx: { userId: r.user_id, unitId: r.unit_id, role: r.role, perms: buildPerms(r.role, overrides), staffId: r.staff_id },
  };
}

export async function logout(db: Db, token: string) {
  await db.query("delete from sessions where id=$1", [sha(token)]);
}

export async function changePassword(db: Db, userId: string, current: string, next: string) {
  checkPasswordStrength(next);
  await db.tx(async (q) => {
    const [u] = await q<{ password_hash: string }>("select password_hash from users where id=$1", [userId]);
    if (!u || !verifyPassword(current, u.password_hash)) throw new DomainError("bad_credentials", "Senha atual incorreta.");
    await q("update users set password_hash=$2 where id=$1", [userId, hashPassword(next)]);
    await q("delete from sessions where user_id=$1", [userId]);
    await audit(q, { userId }, "SENHA_ALTERADA", "user", userId);
  });
}
