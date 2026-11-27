export type Role = "administrador" | "gerente" | "vendedora_gestora" | "vendedor" | "tecnico" | "colaborador" | "pendente";
export type Module = "clientes" | "agendamentos" | "retornos" | "orcamentos_os" | "graficos" | "financeiro";

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
  "agenda.create", "agenda.edit", "agenda.cancel",
  "finance.own", "finance.payables_view", "finance.receivables_view", "finance.dre_view",
  "commissions.view_all", "commissions.rules", "commissions.approve", "commissions.pay",
  "customers.history", "returns.own", "returns.view_all", "returns.contact", "returns.rules", "returns.manage",
  "products.view", "products.sell", "products.stock_view", "products.stock", "products.manage", "products.prices", "products.return",
  "tasks.own", "tasks.create", "tasks.delegate", "tasks.edit", "tasks.view_team", "tasks.approve",
  "achievements.own", "team.view", "team.goals", "purchases.manage",
  "quotes.view", "quotes.manage", "charts.view", "data.import",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const MODULES: Record<Module, { title: string; perms: Permission[] }> = {
  clientes: {
    title: "Clientes",
    perms: ["customers.view", "customers.manage", "customers.edit_sensitive", "customers.deactivate", "customers.history"],
  },
  agendamentos: {
    title: "Agendamentos",
    perms: ["agenda.view_all", "agenda.view_own", "agenda.manage", "agenda.manage_own", "agenda.create", "agenda.edit", "agenda.cancel", "agenda.block", "agenda.retroactive"],
  },
  retornos: {
    title: "Retornos",
    perms: ["returns.own", "returns.view_all", "returns.contact", "returns.rules", "returns.manage"],
  },
  orcamentos_os: {
    title: "Orçamentos e OS",
    perms: ["quotes.view", "quotes.manage"],
  },
  graficos: {
    title: "Gráficos",
    perms: ["charts.view"],
  },
  financeiro: {
    title: "Financeiro",
    perms: ["finance.own", "finance.view", "finance.manage", "finance.payables_view", "finance.receivables_view", "finance.dre_view", "finance.close_period", "finance.goals", "payments.register", "payments.confirm", "payments.reverse", "cash.manage", "reports.view", "reports.export"],
  },
};

const ALL = new Set<Permission>(PERMISSIONS);

export const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  administrador: ALL,
  gerente: new Set<Permission>([
    "dashboard.full", "agenda.view_all", "agenda.manage", "agenda.block", "agenda.retroactive",
    "attendance.view_all", "attendance.run", "attendance.discount_limited",
    "customers.view", "customers.manage", "customers.edit_sensitive", "customers.deactivate", "customers.history",
    "payments.register", "payments.confirm", "cash.manage",
    "finance.view", "finance.manage", "finance.goals", "finance.own", "finance.payables_view", "finance.receivables_view", "finance.dre_view",
    "reports.view", "reports.export",
    "agenda.create", "agenda.edit", "agenda.cancel",
    "returns.own", "returns.view_all", "returns.contact", "returns.rules", "returns.manage",
    "quotes.view", "quotes.manage",
    "charts.view",
    "tasks.own", "tasks.create", "tasks.delegate", "tasks.edit", "tasks.view_team", "tasks.approve",
    "achievements.own", "team.view", "audit.view",
  ]),
  vendedora_gestora: new Set<Permission>([
    "dashboard.full", "agenda.view_all", "agenda.manage", "agenda.create", "agenda.edit", "agenda.cancel",
    "attendance.view_all", "attendance.run", "attendance.discount_limited",
    "customers.view", "customers.manage", "customers.edit_sensitive", "customers.history",
    "payments.register", "payments.confirm",
    "finance.view", "finance.payables_view", "finance.receivables_view", "reports.view", "reports.export",
    "returns.own", "returns.view_all", "returns.contact", "returns.rules", "returns.manage",
    "quotes.view", "quotes.manage",
    "charts.view",
    "tasks.own", "tasks.create", "tasks.delegate", "tasks.edit", "tasks.view_team",
    "achievements.own", "team.view",
  ]),
  vendedor: new Set<Permission>([
    "dashboard.own", "agenda.view_all", "agenda.create", "agenda.edit", "agenda.cancel",
    "attendance.view_all", "attendance.run",
    "customers.view", "customers.manage", "customers.history",
    "payments.register",
    "returns.own", "returns.view_all",
    "quotes.view",
    "charts.view",
    "tasks.own",
    "achievements.own",
  ]),
  tecnico: new Set<Permission>([
    "dashboard.own", "agenda.view_own", "agenda.manage_own",
    "attendance.view_own", "attendance.run_own",
    "agenda.create", "agenda.edit", "agenda.cancel",
    "returns.own", "returns.contact",
    "tasks.own", "achievements.own",
  ]),
  colaborador: new Set<Permission>([
    "tasks.own",
  ]),
  pendente: new Set<Permission>([
    "tasks.own",
  ]),
};

export const ROLE_LABEL: Record<Role, string> = {
  administrador: "Administrador",
  gerente: "Gerente",
  vendedora_gestora: "Vendedora/Gestora",
  vendedor: "Vendedor",
  tecnico: "Técnico",
  colaborador: "Colaborador",
  pendente: "Perfil Pendente",
};

/** Permissões que o proprietário pode conceder individualmente a um usuário. */
export const GRANTABLE: Permission[] = [
  "payments.register", "payments.confirm", "attendance.discount_limited", "agenda.block", "cash.manage",
  "returns.manage", "quotes.manage", "charts.view",
];

export const PERMISSION_LABEL: Partial<Record<Permission, string>> = {
  "payments.register": "Registrar pagamentos",
  "payments.confirm": "Confirmar/conciliar pagamentos",
  "attendance.discount_limited": "Dar desconto dentro do limite",
  "agenda.block": "Bloquear horários",
  "cash.manage": "Operar o caixa",
  "returns.manage": "Gerenciar retornos",
  "quotes.manage": "Gerenciar orçamentos",
  "charts.view": "Ver gráficos",
};

/** Catálogo completo para a tela de permissões individuais (recurso → ações). */
export const PERMISSION_GROUPS: { title: string; items: [Permission, string][] }[] = [
  { title: "Painel", items: [["dashboard.own", "Ver o próprio painel"], ["dashboard.full", "Ver painel da empresa"]] },
  { title: "Clientes", items: [["customers.view", "Ver clientes"], ["customers.manage", "Criar e editar"], ["customers.history", "Consultar histórico"], ["customers.edit_sensitive", "Editar dados sensíveis (e-mail, CPF)"], ["customers.deactivate", "Desativar cliente"]] },
  { title: "Agendamentos", items: [["agenda.view_own", "Ver a própria agenda"], ["agenda.view_all", "Ver agenda da equipe"], ["agenda.manage_own", "Operar a própria agenda"], ["agenda.manage", "Operar agenda de todos"], ["agenda.create", "Criar agendamento"], ["agenda.edit", "Editar e reagendar"], ["agenda.cancel", "Cancelar agendamento"], ["agenda.block", "Bloquear horários"], ["agenda.retroactive", "Lançar no passado"]] },
  { title: "Retornos (Garantia, Manutenção, Outros)", items: [["returns.own", "Ver os próprios retornos"], ["returns.view_all", "Ver retornos da equipe"], ["returns.contact", "Registrar contato com cliente"], ["returns.rules", "Definir regras automáticas"], ["returns.manage", "Gerenciar todos os retornos"]] },
  { title: "Orçamentos", items: [["quotes.view", "Ver orçamentos"], ["quotes.manage", "Criar, editar, enviar e aprovar"]] },
  { title: "Financeiro", items: [["finance.own", "Ver o próprio financeiro"], ["finance.view", "Ver financeiro da empresa"], ["finance.manage", "Lançar e pagar despesas"], ["finance.payables_view", "Ver contas a pagar"], ["finance.receivables_view", "Ver contas a receber"], ["finance.dre_view", "Ver DRE (resultado)"], ["finance.close_period", "Fechar período"], ["finance.goals", "Definir meta de faturamento"], ["payments.register", "Registrar pagamentos de atendimentos"], ["payments.confirm", "Conciliar pagamentos"], ["payments.reverse", "Estornar pagamentos"], ["cash.manage", "Operar o caixa"]] },
  { title: "Relatórios e Gráficos", items: [["reports.view", "Ver relatórios"], ["reports.export", "Exportar dados"], ["charts.view", "Ver gráficos (não desbloqueia financeiro)"]] },
  { title: "Administração (Apenas Administrador)", items: [["users.manage", "Convidar e gerenciar a equipe"], ["admin.settings", "Configurações da empresa"], ["data.import", "Importar dados em lote"], ["audit.view", "Auditoria de alterações"], ["data.export", "Backup completo"]] },
];

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
    else if (role !== "administrador") set.delete(o.permission as Permission); // o acesso do administrador não pode ser reduzido
  }
  set.add("tasks.own");
  return set;
}
