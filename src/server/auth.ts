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
}

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

async function mfaRequiredFor(q: Q, unitId: string, role: Role): Promise<boolean> {
  if (role !== "proprietario" && role !== "gerente") return false;
  const [s] = await q<{ mfa_required: boolean }>("select mfa_required from unit_settings where unit_id=$1", [unitId]);
  return s?.mfa_required ?? true;
}

export async function login(db: Db, email: string, password: string): Promise<LoginResult> {
  // Falhas precisam ser gravadas (contador de bloqueio e auditoria): por isso a transação devolve o erro em vez de lançá-lo,
  // senão o ROLLBACK desfaria o registro da tentativa.
  const out = await db.tx(async (q): Promise<{ error: DomainError } | { result: LoginResult }> => {
    const generic = new DomainError("bad_credentials", "E-mail ou senha incorretos.");
    const [u] = await q<{ id: string; password_hash: string; is_active: boolean; failed_attempts: number; locked_until: Date | null; mfa_enabled: boolean }>(
      "select id,password_hash,is_active,failed_attempts,locked_until,mfa_enabled from users where lower(email)=lower($1) for update",
      [email.trim()],
    );
    if (!u) {
      verifyPassword(password, "scrypt$00$00"); // custo aproximadamente constante
      return { error: generic };
    }
    if (u.locked_until && u.locked_until.getTime() > Date.now()) return { error: new DomainError("locked", "Muitas tentativas. Tente novamente em alguns minutos.") };
    if (!u.is_active || !verifyPassword(password, u.password_hash)) {
      const fails = u.failed_attempts + 1;
      const lock = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60000) : null;
      await q("update users set failed_attempts=$2, locked_until=$3 where id=$1", [u.id, lock ? 0 : fails, lock]);
      await audit(q, { userId: u.id }, "LOGIN_FALHA", "user", u.id, null, { tentativas: fails, bloqueado: !!lock });
      if (lock) await notifyLock(q, u.id);
      return { error: generic };
    }
    const [uu] = await q<{ unit_id: string; role: Role }>("select unit_id, role from user_units where user_id=$1 order by role limit 1", [u.id]);
    if (!uu) return { error: new DomainError("no_unit", "Usuário sem unidade vinculada.") };
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
    "insert into notifications(unit_id,kind,severity,message,ref_entity,ref_id) select unit_id,'login_bloqueado','atencao',$2,'user',$1 from user_units where role='proprietario'",
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
    if (!verifyTotp(s.secret, code)) {
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
