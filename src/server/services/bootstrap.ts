import type { Db, Q } from "../db";
import { audit, need, requireText } from "../core";
import { checkPasswordStrength, hashPassword } from "../auth";
import { DomainError, ForbiddenError } from "../errors";
import { GRANTABLE, ROLE_PERMISSIONS, type Ctx, type Role } from "../permissions";

export async function isSetupDone(db: Db): Promise<boolean> {
  const [r] = await db.query<{ n: number }>("select count(*) as n from users");
  return r.n > 0;
}

const DEFAULT_CATEGORIES: [string, string, string][] = [
  ["Produtos de consumo", "custo", "3.1"],
  ["Materiais descartáveis", "custo", "3.2"],
  ["Pró-labore", "pro_labore", "4.0"],
  ["Aluguel", "despesa", "4.1"],
  ["Energia elétrica", "despesa", "4.2"],
  ["Água", "despesa", "4.3"],
  ["Internet e telefone", "despesa", "4.4"],
  ["Marketing", "despesa", "4.5"],
  ["Manutenção e limpeza", "despesa", "4.6"],
  ["Contador", "despesa", "4.7"],
  ["Folha de pagamento", "despesa", "4.8"],
  ["Outras despesas", "despesa", "4.9"],
  ["Impostos e taxas", "imposto", "5.1"],
  ["Despesas não operacionais", "nao_operacional", "6.1"],
  ["Distribuição de lucros", "distribuicao_lucros", "7.1"],
];

export interface SetupInput { orgName: string; unitName: string; ownerName: string; email: string; password: string; demo?: boolean }

export async function setupInitial(db: Db, input: SetupInput): Promise<{ unitId: string; ownerId: string; staffId: string }> {
  const orgName = requireText(input.orgName, "Nome da empresa");
  const unitName = requireText(input.unitName, "Nome da unidade");
  const ownerName = requireText(input.ownerName, "Seu nome");
  const email = requireText(input.email, "E-mail").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new DomainError("invalid", "E-mail inválido.");
  checkPasswordStrength(input.password);
  return db.tx(async (q) => {
    const [existing] = await q<{ n: number }>("select count(*) as n from users");
    if (existing.n > 0) throw new DomainError("already_setup", "O sistema já foi configurado.");
    const [org] = await q<{ id: string }>("insert into organizations(name,is_demo) values ($1,$2) returning id", [orgName, !!input.demo]);
    const [unit] = await q<{ id: string }>("insert into units(organization_id,name) values ($1,$2) returning id", [org.id, unitName]);
    const unitId = unit.id;
    await q("insert into unit_settings(unit_id, business_hours, mfa_required) values ($1,$2,$3)", [
      unitId,
      JSON.stringify({ "1": [["09:00", "19:00"]], "2": [["09:00", "19:00"]], "3": [["09:00", "19:00"]], "4": [["09:00", "19:00"]], "5": [["09:00", "19:00"]], "6": [["09:00", "17:00"]] }),
      process.env.NODE_ENV === "production",
    ]);
    const [owner] = await q<{ id: string }>("insert into users(email,full_name,password_hash) values ($1,$2,$3) returning id", [email, ownerName, hashPassword(input.password)]);
    await q("insert into user_units(user_id,unit_id,role) values ($1,$2,'proprietario')", [owner.id, unitId]);
    const [cash] = await q<{ id: string }>("insert into financial_accounts(unit_id,name,kind) values ($1,'Caixa da loja','caixa') returning id", [unitId]);
    const [bank] = await q<{ id: string }>("insert into financial_accounts(unit_id,name,kind) values ($1,'Conta bancária','banco') returning id", [unitId]);
    const methods: [string, string, string, number][] = [
      ["Dinheiro", "dinheiro", cash.id, 1],
      ["Pix", "pix", bank.id, 2],
      ["Cartão de débito", "cartao_debito", bank.id, 3],
      ["Cartão de crédito", "cartao_credito", bank.id, 4],
    ];
    for (const [name, kind, acc, ord] of methods) {
      await q("insert into payment_methods(unit_id,name,kind,account_id,sort_order) values ($1,$2,$3,$4,$5)", [unitId, name, kind, acc, ord]);
    }
    for (const [i, [name, kind, code]] of DEFAULT_CATEGORIES.entries()) {
      await q("insert into financial_categories(unit_id,name,kind,account_code,sort_order) values ($1,$2,$3,$4,$5)", [unitId, name, kind, code, i]);
    }
    for (const [i, name] of ["Cabelo", "Barba", "Combos", "Outros"].entries()) {
      await q("insert into service_categories(unit_id,name,sort_order) values ($1,$2,$3)", [unitId, name, i]);
    }
    await q("insert into chairs(unit_id,name) values ($1,'Cadeira 1')", [unitId]);
    const [staff] = await q<{ id: string }>("insert into staff(unit_id,user_id,name,contract_type) values ($1,$2,$3,'proprietario') returning id", [unitId, owner.id, ownerName]);
    await audit(q, { userId: owner.id, unitId }, "SISTEMA_CONFIGURADO", "organization", org.id, null, { orgName, unitName });
    return { unitId, ownerId: owner.id, staffId: staff.id };
  });
}

// ---------- usuários ----------
export interface UserRow { id: string; email: string; full_name: string; is_active: boolean; role: Role; mfa_enabled: boolean; last_login_at: Date | null; overrides: string[]; staff_name: string | null }

export async function listUsers(db: Db, ctx: Ctx): Promise<UserRow[]> {
  need(ctx, "users.manage");
  return db.query<UserRow>(
    `select u.id, u.email, u.full_name, u.is_active, uu.role, u.mfa_enabled, u.last_login_at,
       coalesce((select array_agg(po.permission) from permission_overrides po where po.user_id=u.id and po.unit_id=uu.unit_id and po.granted),'{}') as overrides,
       (select s.name from staff s where s.user_id=u.id and s.unit_id=uu.unit_id limit 1) as staff_name
     from users u join user_units uu on uu.user_id=u.id where uu.unit_id=$1 order by u.full_name`,
    [ctx.unitId],
  );
}

async function activeOwners(q: Q, unitId: string, excluding?: string): Promise<number> {
  const [r] = await q<{ n: number }>(
    "select count(*) as n from users u join user_units uu on uu.user_id=u.id where uu.unit_id=$1 and uu.role='proprietario' and u.is_active and ($2::uuid is null or u.id <> $2)",
    [unitId, excluding ?? null],
  );
  return r.n;
}

/** Quem recebeu "gerenciar usuários" não cria nem promove alguém acima de si. */
export function assertRoleGrant(ctx: Ctx, role: Role) {
  if (ctx.role === "proprietario") return;
  if (role === "proprietario" || [...ROLE_PERMISSIONS[role]].some((p) => !ctx.perms.has(p) && p !== "tasks.own" && !p.endsWith(".own") && !p.endsWith("_own"))) throw new ForbiddenError("Você não pode conceder um perfil com mais acesso que o seu.");
}

export async function createUser(db: Db, ctx: Ctx, input: { email: string; fullName: string; role: Role; password: string; staffId?: string | null }) {
  need(ctx, "users.manage");
  const email = requireText(input.email, "E-mail").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new DomainError("invalid", "E-mail inválido.");
  const fullName = requireText(input.fullName, "Nome");
  if (!["proprietario", "gerente", "barbeiro", "contador"].includes(input.role)) throw new DomainError("invalid", "Perfil inválido.");
  assertRoleGrant(ctx, input.role);
  checkPasswordStrength(input.password);
  return db.tx(async (q) => {
    const [dup] = await q("select 1 from users where lower(email)=$1", [email]);
    if (dup) throw new DomainError("duplicate", "Já existe um usuário com este e-mail.");
    const [u] = await q<{ id: string }>("insert into users(email,full_name,password_hash) values ($1,$2,$3) returning id", [email, fullName, hashPassword(input.password)]);
    await q("insert into user_units(user_id,unit_id,role) values ($1,$2,$3)", [u.id, ctx.unitId, input.role]);
    if (input.staffId) await q("update staff set user_id=$1 where id=$2 and unit_id=$3 and user_id is null", [u.id, input.staffId, ctx.unitId]);
    await audit(q, ctx, "USUARIO_CRIADO", "user", u.id, null, { email, role: input.role });
    return u.id;
  });
}

export async function updateUser(db: Db, ctx: Ctx, userId: string, patch: { role?: Role; isActive?: boolean; overrides?: string[]; fullName?: string }) {
  need(ctx, "users.manage");
  await db.tx(async (q) => {
    const [cur] = await q<{ role: Role; is_active: boolean }>("select uu.role, u.is_active from users u join user_units uu on uu.user_id=u.id where u.id=$1 and uu.unit_id=$2 for update of u", [userId, ctx.unitId]);
    if (!cur) throw new DomainError("not_found", "Usuário não encontrado.");
    if (ctx.role !== "proprietario" && (cur.role === "proprietario" || userId === ctx.userId)) throw new ForbiddenError("Só o proprietário pode alterar este acesso.");
    if (patch.role && patch.role !== cur.role) {
      assertRoleGrant(ctx, patch.role);
      // trocar o perfil base recomeça do padrão: exceções do perfil antigo não vazam para o novo
      if (!patch.overrides) await q("delete from permission_overrides where user_id=$1 and unit_id=$2", [userId, ctx.unitId]);
      await q("update user_units set profile_id=null where user_id=$1 and unit_id=$2", [userId, ctx.unitId]);
    }
    const newRole = patch.role ?? cur.role;
    const newActive = patch.isActive ?? cur.is_active;
    if ((cur.role === "proprietario" && cur.is_active) && (newRole !== "proprietario" || !newActive)) {
      if ((await activeOwners(q, ctx.unitId, userId)) === 0) throw new DomainError("last_owner", "É preciso manter pelo menos um proprietário ativo.");
    }
    if (patch.role) await q("update user_units set role=$3 where user_id=$1 and unit_id=$2", [userId, ctx.unitId, patch.role]);
    if (patch.isActive != null) {
      await q("update users set is_active=$2 where id=$1", [userId, patch.isActive]);
      if (!patch.isActive) await q("delete from sessions where user_id=$1", [userId]);
    }
    if (patch.fullName) await q("update users set full_name=$2 where id=$1", [userId, patch.fullName.trim()]);
    if (patch.overrides) {
      await q("delete from permission_overrides where user_id=$1 and unit_id=$2", [userId, ctx.unitId]);
      for (const p of patch.overrides) {
        if (!(GRANTABLE as string[]).includes(p)) continue;
        await q("insert into permission_overrides(user_id,unit_id,permission,granted) values ($1,$2,$3,true)", [userId, ctx.unitId, p]);
      }
    }
    await audit(q, ctx, "USUARIO_ALTERADO", "user", userId, { role: cur.role, active: cur.is_active }, patch);
  });
}

export async function resetUserPassword(db: Db, ctx: Ctx, userId: string, newPassword: string) {
  need(ctx, "users.manage");
  checkPasswordStrength(newPassword);
  await db.tx(async (q) => {
    const [u] = await q<{ role: Role }>("select role from user_units where user_id=$1 and unit_id=$2", [userId, ctx.unitId]);
    if (!u) throw new DomainError("not_found", "Usuário não encontrado.");
    if (ctx.role !== "proprietario" && u.role === "proprietario") throw new ForbiddenError("Só o proprietário redefine a senha do proprietário.");
    await q("update users set password_hash=$2, failed_attempts=0, locked_until=null, mfa_enabled=false, mfa_secret=null where id=$1", [userId, hashPassword(newPassword)]);
    await q("delete from sessions where user_id=$1", [userId]);
    await audit(q, ctx, "SENHA_REDEFINIDA", "user", userId);
  });
}
