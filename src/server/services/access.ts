import type { Db, Q } from "../db";
import { audit, can, need, requireText, requireUuid } from "../core";
import { DomainError, ForbiddenError } from "../errors";
import { PERMISSIONS, ROLE_PERMISSIONS, buildPerms, type Ctx, type Permission, type Role } from "../permissions";

const VALID = new Set<string>(PERMISSIONS);
const clean = (list: string[]) => [...new Set(list.filter((p) => VALID.has(p)))] as Permission[];

/** Ninguém concede o que não tem; o proprietário tem tudo. */
function assertGrantable(ctx: Ctx, wanted: Permission[], had: Set<string>) {
  const extra = wanted.filter((p) => !had.has(p) && p !== "tasks.own" && !can(ctx, p));
  if (extra.length) throw new ForbiddenError("Você não pode conceder um acesso que você mesmo não tem.");
}

async function target(q: Q, ctx: Ctx, userId: string) {
  const [u] = await q<{ role: Role }>("select role from user_units where user_id=$1 and unit_id=$2 for update", [requireUuid(userId, "Usuário"), ctx.unitId]);
  if (!u) throw new DomainError("not_found", "Usuário não encontrado.");
  if (u.role === "proprietario") throw new ForbiddenError("O acesso do proprietário é total e não pode ser reduzido.");
  if (userId === ctx.userId) throw new ForbiddenError("Você não pode alterar as suas próprias permissões.");
  return u;
}
const overridesOf = (q: Q, userId: string, unitId: string) => q<{ permission: string; granted: boolean }>("select permission, granted from permission_overrides where user_id=$1 and unit_id=$2", [userId, unitId]);

/** Grava o conjunto exato de permissões da pessoa, como diferença em relação ao perfil base. Vale na próxima requisição. */
export async function writePermissionsTx(q: Q, ctx: Ctx, userId: string, role: Role, perms: string[], profileId: string | null) {
  const want = new Set<Permission>(clean(perms));
  want.add("tasks.own");
  const before = buildPerms(role, await overridesOf(q, userId, ctx.unitId));
  assertGrantable(ctx, [...want], before);
  await q("delete from permission_overrides where user_id=$1 and unit_id=$2", [userId, ctx.unitId]);
  for (const p of PERMISSIONS) {
    if (p === "tasks.own") continue;
    const base = ROLE_PERMISSIONS[role].has(p), on = want.has(p);
    if (base !== on) await q("insert into permission_overrides(user_id,unit_id,permission,granted) values ($1,$2,$3,$4)", [userId, ctx.unitId, p, on]);
  }
  await q("update user_units set profile_id=$3 where user_id=$1 and unit_id=$2", [userId, ctx.unitId, profileId]);
  const added = [...want].filter((p) => !before.has(p)), removed = [...before].filter((p) => !want.has(p));
  if (added.length || removed.length) await audit(q, ctx, "PERMISSOES_ALTERADAS", "user", userId, { removed }, { added, profileId });
  return { added, removed };
}

export async function setUserPermissions(db: Db, ctx: Ctx, userId: string, perms: string[], profileId: string | null = null) {
  need(ctx, "users.manage");
  return db.tx(async (q) => {
    const u = await target(q, ctx, userId);
    return writePermissionsTx(q, ctx, userId, u.role, perms, profileId);
  });
}

export async function getUserAccess(db: Db, ctx: Ctx, userId: string) {
  need(ctx, "users.manage");
  const [u] = await db.query<{ id: string; full_name: string; email: string; role: Role; profile_id: string | null; is_active: boolean; staff_id: string | null }>("select u.id, u.full_name, u.email, uu.role, uu.profile_id, u.is_active, (select s.id from staff s where s.user_id=u.id and s.unit_id=uu.unit_id limit 1) as staff_id from users u join user_units uu on uu.user_id=u.id where u.id=$1 and uu.unit_id=$2", [requireUuid(userId, "Usuário"), ctx.unitId]);
  if (!u) throw new DomainError("not_found", "Usuário não encontrado.");
  const perms = buildPerms(u.role, await overridesOf(db.query, userId, ctx.unitId));
  const history = await db.query<{ created_at: Date; user_name: string | null; before: { removed?: string[] } | null; after: { added?: string[] } | null; action: string }>("select l.created_at, x.full_name as user_name, l.before, l.after, l.action from audit_logs l left join users x on x.id=l.user_id where l.entity='user' and l.entity_id=$1 and l.unit_id=$2 order by l.id desc limit 20", [userId, ctx.unitId]);
  return { user: u, perms, history };
}

export interface Profile { id: string; name: string; base_role: Role; permissions: Permission[]; users: number }
export async function listProfiles(db: Db, ctx: Ctx) {
  need(ctx, "users.manage");
  return db.query<Profile>("select p.id, p.name, p.base_role, p.permissions, (select count(*) from user_units u where u.profile_id=p.id)::bigint as users from access_profiles p where p.unit_id=$1 order by p.name", [ctx.unitId]);
}
export async function saveProfile(db: Db, ctx: Ctx, i: { name: string; baseRole: Role; permissions: string[] }) {
  need(ctx, "users.manage");
  const name = requireText(i.name, "Nome do perfil", 2);
  if (!["gerente", "barbeiro", "contador"].includes(i.baseRole)) throw new DomainError("invalid", "Perfil base inválido.");
  const perms = clean(i.permissions);
  assertGrantable(ctx, perms, new Set());
  return db.tx(async (q) => {
    const [r] = await q<{ id: string }>("insert into access_profiles(unit_id,name,base_role,permissions) values ($1,$2,$3,$4) on conflict (unit_id,name) do update set base_role=excluded.base_role, permissions=excluded.permissions, updated_at=now() returning id", [ctx.unitId, name, i.baseRole, perms]);
    await audit(q, ctx, "PERFIL_SALVO", "access_profile", r.id, null, { ...i, permissions: perms });
    return r.id;
  });
}
export async function deleteProfile(db: Db, ctx: Ctx, id: string) {
  need(ctx, "users.manage");
  await db.tx(async (q) => {
    const r = await q("delete from access_profiles where id=$1 and unit_id=$2 returning name", [requireUuid(id, "Perfil"), ctx.unitId]);
    if (!r.length) throw new DomainError("not_found", "Perfil não encontrado.");
    await audit(q, ctx, "PERFIL_REMOVIDO", "access_profile", id, r[0]);
  });
}

/** Aplica um perfil salvo à pessoa (substitui as permissões individuais). */
export async function applyProfile(db: Db, ctx: Ctx, userId: string, profileId: string) {
  need(ctx, "users.manage");
  return db.tx(async (q) => {
    await target(q, ctx, userId);
    const [p] = await q<{ base_role: Role; permissions: string[] }>("select base_role, permissions from access_profiles where id=$1 and unit_id=$2", [requireUuid(profileId, "Perfil"), ctx.unitId]);
    if (!p) throw new DomainError("not_found", "Perfil não encontrado.");
    if (p.base_role === "gerente" && ctx.role !== "proprietario") throw new ForbiddenError("Só o proprietário define gerentes.");
    await q("update user_units set role=$3 where user_id=$1 and unit_id=$2", [userId, ctx.unitId, p.base_role]);
    return writePermissionsTx(q, ctx, userId, p.base_role, p.permissions, profileId);
  });
}

// ---------- preferências pessoais ----------
export type Theme = "auto" | "claro" | "escuro";
export interface Prefs { theme: Theme; agenda_view: "dia" | "semana" | "mes"; notify: Record<string, boolean> }
export async function getPrefs(db: Db, userId: string): Promise<Prefs> {
  const [p] = await db.query<Prefs>("select theme, agenda_view, notify from user_preferences where user_id=$1", [userId]);
  return p ?? { theme: "auto", agenda_view: "dia", notify: {} };
}
export async function savePrefs(db: Db, userId: string, p: Partial<Prefs>) {
  const cur = await getPrefs(db, userId);
  const n = { ...cur, ...p };
  if (!["auto", "claro", "escuro"].includes(n.theme) || !["dia", "semana", "mes"].includes(n.agenda_view)) throw new DomainError("invalid", "Preferência inválida.");
  await db.query("insert into user_preferences(user_id,theme,agenda_view,notify) values ($1,$2,$3,$4) on conflict (user_id) do update set theme=excluded.theme, agenda_view=excluded.agenda_view, notify=excluded.notify, updated_at=now()", [userId, n.theme, n.agenda_view, JSON.stringify(n.notify)]);
}

// ---------- pesquisa ----------
export interface Hit { type: string; title: string; sub: string; href: string }
export async function search(db: Db, ctx: Ctx, term: string): Promise<Hit[]> {
  const t = term.trim().toLowerCase().replace(/[%_\\]/g, "");
  if (t.length < 2) return [];
  const like = `%${t}%`, out: Hit[] = [];
  if (can(ctx, "customers.view")) for (const c of await db.query<{ id: string; name: string; phone: string | null }>("select id,name,phone from customers where unit_id=$1 and is_active and (lower(name) like $2 or coalesce(phone,'') like $2) order by name limit 6", [ctx.unitId, like])) out.push({ type: "Cliente", title: c.name, sub: c.phone ?? "", href: `/clientes/${c.id}` });
  const team = can(ctx, "tasks.view_team");
  for (const k of await db.query<{ id: string; title: string; status: string }>("select t.id, t.title, t.status from tasks t where t.unit_id=$1 and lower(t.title) like $2 and t.status<>'cancelada' and ($3::boolean or t.created_by=$4 or exists (select 1 from task_assignees a where a.task_id=t.id and a.user_id=$4)) order by t.created_at desc limit 5", [ctx.unitId, like, team, ctx.userId])) out.push({ type: "Tarefa", title: k.title, sub: k.status.replace("_", " "), href: `/tarefas/${k.id}` });
  if (can(ctx, "products.view")) for (const p of await db.query<{ id: string; name: string; sku: string | null }>("select id,name,sku from products where unit_id=$1 and is_active and lower(name || ' ' || coalesce(sku,'')) like $2 order by name limit 5", [ctx.unitId, like])) out.push({ type: "Produto", title: p.name, sub: p.sku ?? "", href: `/produtos/${p.id}` });
  return out;
}
