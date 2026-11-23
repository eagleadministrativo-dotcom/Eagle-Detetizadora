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
  // V4
  "agenda.create", "agenda.edit", "agenda.cancel",
  "finance.own", "finance.payables_view", "finance.receivables_view", "finance.dre_view",
  "commissions.view_all", "commissions.rules", "commissions.approve", "commissions.pay",
  "customers.history", "returns.own", "returns.view_all", "returns.contact", "returns.rules",
  "products.view", "products.sell", "products.stock_view", "products.stock", "products.manage", "products.prices", "products.return",
  "tasks.own", "tasks.create", "tasks.delegate", "tasks.edit", "tasks.view_team", "tasks.approve",
  "achievements.own", "team.view", "team.goals",
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
    "agenda.create", "agenda.edit", "agenda.cancel", "finance.own", "finance.payables_view", "finance.receivables_view", "finance.dre_view",
    "customers.history", "returns.own", "returns.view_all", "returns.contact", "returns.rules",
    "products.view", "products.sell", "products.stock_view", "products.stock",
    "tasks.own", "tasks.create", "tasks.delegate", "tasks.edit", "tasks.view_team", "tasks.approve",
    "achievements.own", "team.view",
  ]),
  barbeiro: new Set<Permission>([
    "dashboard.own", "agenda.view_own", "agenda.manage_own",
    "attendance.view_own", "attendance.run_own",
    "customers.view", "customers.manage",
    "agenda.create", "agenda.edit", "agenda.cancel", "customers.history", "finance.own", "returns.own", "returns.contact", "tasks.own", "achievements.own",
  ]),
  contador: new Set<Permission>([
    "attendance.view_all", "customers.view", "finance.view", "reports.view", "reports.export",
    "customers.history", "finance.payables_view", "finance.receivables_view", "finance.dre_view", "commissions.view_all", "tasks.own",
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

/** Catálogo completo para a tela de permissões individuais (recurso → ações). */
export const PERMISSION_GROUPS: { title: string; items: [Permission, string][] }[] = [
  { title: "Painel e relatórios", items: [["dashboard.own", "Ver o próprio painel"], ["dashboard.full", "Ver o painel geral"], ["reports.view", "Ver relatórios"], ["reports.export", "Exportar relatórios"]] },
  { title: "Agenda", items: [["agenda.view_own", "Ver a própria agenda"], ["agenda.view_all", "Ver a agenda da equipe"], ["agenda.manage_own", "Operar a própria agenda"], ["agenda.manage", "Operar a agenda de todos"], ["agenda.create", "Criar agendamento"], ["agenda.edit", "Editar e reagendar"], ["agenda.cancel", "Cancelar agendamento"], ["agenda.block", "Criar e remover bloqueios"], ["agenda.retroactive", "Lançar no passado"]] },
  { title: "Atendimentos", items: [["attendance.view_own", "Ver os próprios"], ["attendance.view_all", "Ver todos"], ["attendance.run_own", "Operar os próprios"], ["attendance.run", "Operar todos"], ["attendance.discount_limited", "Desconto dentro do limite"], ["attendance.discount", "Desconto sem limite"]] },
  { title: "Clientes", items: [["customers.view", "Ver clientes"], ["customers.manage", "Cadastrar e editar"], ["customers.history", "Consultar histórico"], ["customers.edit_sensitive", "Editar dados sensíveis"], ["customers.deactivate", "Desativar cliente"]] },
  { title: "Retornos", items: [["returns.own", "Ver os próprios retornos"], ["returns.view_all", "Ver retornos da equipe"], ["returns.contact", "Registrar contato"], ["returns.rules", "Definir regras de retorno"]] },
  { title: "Financeiro", items: [["finance.own", "Ver o próprio financeiro"], ["finance.view", "Ver o financeiro geral"], ["finance.payables_view", "Ver contas a pagar"], ["finance.receivables_view", "Ver contas a receber"], ["finance.dre_view", "Ver a DRE"], ["finance.manage", "Lançar e pagar contas"], ["finance.close_period", "Fechar período"], ["finance.goals", "Metas da empresa"], ["cash.manage", "Operar o caixa"], ["payments.register", "Registrar pagamentos"], ["payments.confirm", "Conciliar pagamentos"], ["payments.reverse", "Estornar pagamentos"]] },
  { title: "Comissões", items: [["commissions.view_all", "Ver comissões da equipe"], ["commissions.rules", "Alterar regras de comissão"], ["commissions.approve", "Aprovar repasses"], ["commissions.pay", "Registrar pagamento de repasse"]] },
  { title: "Produtos", items: [["products.view", "Ver catálogo"], ["products.sell", "Registrar vendas"], ["products.return", "Registrar devolução"], ["products.stock_view", "Consultar estoque"], ["products.stock", "Alterar estoque"], ["products.manage", "Cadastrar produtos"], ["products.prices", "Alterar preços"]] },
  { title: "Tarefas", items: [["tasks.own", "Ver as próprias tarefas (sempre ativo)"], ["tasks.create", "Criar tarefas"], ["tasks.delegate", "Delegar a outras pessoas"], ["tasks.edit", "Editar tarefas que criou"], ["tasks.view_team", "Acompanhar a equipe"], ["tasks.approve", "Aprovar conclusão"]] },
  { title: "Equipe e conquistas", items: [["achievements.own", "Ver as próprias conquistas"], ["team.view", "Painel da equipe"], ["team.goals", "Metas individuais"]] },
  { title: "Administração", items: [["users.manage", "Funcionários e permissões"], ["admin.catalog", "Serviços e equipe"], ["admin.schedules", "Cadeiras e horários"], ["admin.settings", "Configurações"], ["audit.view", "Auditoria"], ["data.export", "Exportar dados e backup"]] },
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
    else if (role !== "proprietario") set.delete(o.permission as Permission); // o acesso do proprietário não pode ser reduzido
  }
  set.add("tasks.own");
  return set;
}
