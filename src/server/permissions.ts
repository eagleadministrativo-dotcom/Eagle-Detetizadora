export type Role = "proprietario" | "gerente" | "barbeiro" | "contador";

export const PERMISSIONS = [
  "dashboard.full", "dashboard.own",
  "agenda.view_all", "agenda.view_own", "agenda.manage", "agenda.manage_own", "agenda.block", "agenda.retroactive",
  "attendance.view_all", "attendance.view_own", "attendance.run", "attendance.run_own",
  "attendance.discount", "attendance.discount_limited",
  "customers.view", "customers.manage", "customers.edit_sensitive", "customers.deactivate",
  "payments.register", "payments.confirm", "payments.reverse",
  "cash.manage",
  "finance.view", "finance.manage", "finance.close_period", "finance.goals",
  "reports.view", "reports.export",
  "admin.catalog", "admin.schedules", "admin.settings", "users.manage", "audit.view", "data.export",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);

export const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  proprietario: ALL,
  gerente: new Set<Permission>([
    "dashboard.full", "agenda.view_all", "agenda.manage", "agenda.block", "agenda.retroactive",
    "attendance.view_all", "attendance.run", "attendance.discount_limited",
    "customers.view", "customers.manage", "customers.edit_sensitive",
    "payments.register", "payments.confirm", "cash.manage",
    "finance.view", "reports.view", "reports.export", "admin.schedules",
  ]),
  barbeiro: new Set<Permission>([
    "dashboard.own", "agenda.view_own", "agenda.manage_own",
    "attendance.view_own", "attendance.run_own",
    "customers.view", "customers.manage",
  ]),
  contador: new Set<Permission>([
    "attendance.view_all", "customers.view", "finance.view", "reports.view", "reports.export",
  ]),
};

export const ROLE_LABEL: Record<Role, string> = {
  proprietario: "Proprietário",
  gerente: "Gerente",
  barbeiro: "Barbeiro",
  contador: "Contador",
};

/** Permissões que o proprietário pode conceder individualmente a um usuário. */
export const GRANTABLE: Permission[] = [
  "payments.register", "payments.confirm", "attendance.discount_limited", "agenda.block", "cash.manage",
];

export const PERMISSION_LABEL: Partial<Record<Permission, string>> = {
  "payments.register": "Registrar pagamentos",
  "payments.confirm": "Confirmar/conciliar pagamentos",
  "attendance.discount_limited": "Dar desconto dentro do limite",
  "agenda.block": "Bloquear horários",
  "cash.manage": "Operar o caixa",
};

export interface Ctx {
  userId: string;
  unitId: string;
  role: Role;
  perms: Set<Permission>;
  staffId?: string | null;
}

export function buildPerms(role: Role, overrides: { permission: string; granted: boolean }[]): Set<Permission> {
  const set = new Set(ROLE_PERMISSIONS[role]);
  for (const o of overrides) {
    if (!(ALL as Set<string>).has(o.permission)) continue;
    if (o.granted) set.add(o.permission as Permission);
    else set.delete(o.permission as Permission);
  }
  return set;
}
