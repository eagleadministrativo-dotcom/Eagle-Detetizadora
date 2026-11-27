import crypto from "node:crypto";
import type { Db, Q } from "./db";
import { audit } from "./core";
import { DomainError } from "./errors";
import { buildPerms, type Ctx, type Role } from "./permissions";
import { SESSION_DAYS } from "./session-cookie";

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

// ---------- sessões ----------
const RENEW_AFTER_DAYS = 30;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export interface LoginResult {
  token: string;
  /** Entrou com senha provisória: não há sessão (token vazio); mandar link ao e-mail para criar a senha. */
  emailLink?: { purpose: "cadastro" | "senha"; email: string; inviteId?: string; userId?: string };
  /** Primeiro acesso: não há sessão (token vazio); mandar código ao e-mail para confirmar que é da pessoa. */
  emailCheck?: { email: string; userId: string };
}

// Senha: 3 erros bloqueiam por 10 minutos (e a tela oferece "esqueci a senha").
export const LOGIN_MAX_FAILS = 3;
export const LOGIN_LOCK_MINUTES = 10;
export const LOCKED_MSG = `Senha incorreta ${LOGIN_MAX_FAILS} vezes. Por segurança, novas tentativas ficam bloqueadas por ${LOGIN_LOCK_MINUTES} minutos. Você pode redefinir a senha pelo e-mail.`;
const stillLocked = (min: number) => { const m = Math.max(1, Math.ceil(min)); return `Acesso bloqueado por tentativas erradas. Tente de novo em ${m} minuto${m > 1 ? "s" : ""} ou redefina a senha pelo e-mail.`; };

/** Abre a sessão de um usuário já conferido (senha e, no primeiro acesso, e-mail). */
export async function createSession(q: Q, userId: string, unitId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await q("insert into sessions(id,user_id,unit_id,mfa_verified,expires_at) values ($1,$2,$3,true,$4)", [
    sha(token), userId, unitId, new Date(Date.now() + SESSION_DAYS * 86400000),
  ]);
  return token;
}

export async function login(db: Db, email: string, password: string): Promise<LoginResult> {
  // Falhas precisam ser gravadas (contador de bloqueio e auditoria): por isso a transação devolve o erro em vez de lançá-lo,
  // senão o ROLLBACK desfaria o registro da tentativa.
  const out = await db.tx(async (q): Promise<{ error: DomainError } | { result: LoginResult }> => {
    const generic = new DomainError("bad_credentials", "E-mail ou senha incorretos.");
    const [u] = await q<{ id: string; email: string; password_hash: string; is_active: boolean; failed_attempts: number; locked_until: Date | null; must_change_password: boolean; email_verified_at: Date | null }>(
      "select id,email,password_hash,is_active,failed_attempts,locked_until,must_change_password,email_verified_at from users where lower(email)=lower($1) for update",
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
      if (inv?.temp && verifyPassword(password, inv.temp)) return { result: { token: "", emailLink: { purpose: "cadastro", email: email.trim().toLowerCase(), inviteId: inv.id } } };
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
    await q("update users set failed_attempts=0, locked_until=null where id=$1", [u.id]);
    if (u.must_change_password) {
      // senha provisória: confirma o e-mail por link antes de liberar o acesso
      await audit(q, { userId: u.id, unitId: uu.unit_id }, "LOGIN_SENHA_PROVISORIA", "user", u.id);
      return { result: { token: "", emailLink: { purpose: "senha", email: u.email, userId: u.id } } };
    }
    if (!u.email_verified_at) {
      await audit(q, { userId: u.id, unitId: uu.unit_id }, "LOGIN_CONFIRMAR_EMAIL", "user", u.id);
      return { result: { token: "", emailCheck: { email: u.email, userId: u.id } } };
    }
    await q("update users set last_login_at=now() where id=$1", [u.id]);
    const token = await createSession(q, u.id, uu.unit_id);
    await audit(q, { userId: u.id, unitId: uu.unit_id }, "LOGIN", "user", u.id);
    return { result: { token } };
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

export interface SessionInfo {
  ctx: Ctx;
  user: { id: string; email: string; fullName: string };
  mfaVerified: boolean;
  token: string;
}

export async function getSession(db: Db, token: string | undefined): Promise<SessionInfo | null> {
  if (!token) return null;
  const rows = await db.query<{
    user_id: string; unit_id: string; mfa_verified: boolean; email: string; full_name: string; is_active: boolean; role: Role; staff_id: string | null; renew: boolean;
  }>(
    `select s.user_id, s.unit_id, s.mfa_verified, u.email, u.full_name, u.is_active, uu.role,
            (select id from staff st where st.user_id = u.id and st.unit_id = s.unit_id limit 1) as staff_id,
            s.expires_at < now() + make_interval(days => $2) as renew
     from sessions s
     join users u on u.id = s.user_id
     join user_units uu on uu.user_id = u.id and uu.unit_id = s.unit_id
     where s.id = $1 and s.expires_at > now()`,
    [sha(token), SESSION_DAYS - RENEW_AFTER_DAYS],
  );
  const r = rows[0];
  if (!r || !r.is_active) return null;
  // uso renova a sessão (no máximo uma escrita a cada 30 dias)
  if (r.renew) await db.query("update sessions set expires_at = now() + make_interval(days => $2) where id=$1", [sha(token), SESSION_DAYS]);
  const overrides = await db.query<{ permission: string; granted: boolean }>("select permission, granted from permission_overrides where user_id=$1 and unit_id=$2", [r.user_id, r.unit_id]);
  return {
    token,
    mfaVerified: r.mfa_verified,
    user: { id: r.user_id, email: r.email, fullName: r.full_name },
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
