import Link from "next/link";
import { after } from "next/server";
import { runReminders } from "@/server/services/reminders";
import { flushPush } from "@/server/services/push";
import { getDb } from "@/server/db";
import { requireSession } from "@/server/session";
import { can } from "@/server/core";
import { ROLE_LABEL } from "@/server/permissions";
import { runDailyJobs } from "@/server/services/ops";
import { unreadCount } from "@/server/services/notify";
import { getPrefs } from "@/server/services/access";
import { taskCounts } from "@/server/services/tasks";
import { returnCounts } from "@/server/services/returns";
import { processEvents } from "@/server/services/events";
import { CommandPalette, CountUp, Spotlight, ThemePicker } from "@/components/client";
import { logoutAction } from "@/app/actions/auth";
import { Icon } from "@/components/icons";
import { BottomNav, SideNav, SideToggle, type NavGroup, type NavItem } from "@/components/nav";

export const dynamic = "force-dynamic";
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const { ctx } = s;
  const db = await getDb();
  if (can(ctx, "finance.view")) await runDailyJobs(db, ctx.unitId).catch((e) => console.error("[rotina diaria]", e));
  const seesReturns = can(ctx, "returns.view_all") || can(ctx, "returns.own");
  const [unread, tasks, returns, prefs] = await Promise.all([unreadCount(db, ctx), taskCounts(db, ctx), seesReturns ? returnCounts(db, ctx) : Promise.resolve({} as Record<string, number>), getPrefs(db, ctx.userId)]);
  // Envia por push os avisos novos, depois que a página já respondeu (não atrasa a tela).
  after(async () => {
    await processEvents(db).catch((e) => console.error("[eventos]", e));
    await runReminders(db).catch((e) => console.error("[lembretes]", e));
    await flushPush(db).catch((e) => console.error("[push]", e));
  });

  // menu por tópicos: cada área aparece uma vez, junto das relacionadas
  const groups: NavGroup[] = [];
  const add = (title: string | undefined, items: (NavItem | false | null | undefined)[]) => { const list = items.filter((x): x is NavItem => !!x); if (list.length) groups.push({ title, items: list }); };
  add(undefined, [(can(ctx, "dashboard.full") || can(ctx, "dashboard.own")) && { href: "/", label: can(ctx, "dashboard.full") ? "Visão geral" : "Meu dia", short: "Início" }]);
  add("Atendimento", [
    (can(ctx, "agenda.view_all") || can(ctx, "agenda.view_own")) && { href: "/agenda", label: "Agenda" },
    (can(ctx, "attendance.view_all") || can(ctx, "attendance.view_own")) && { href: "/atendimentos", label: "Atendimentos", short: "Atend." },
    can(ctx, "customers.view") && { href: "/clientes", label: "Clientes" },
    seesReturns && { href: "/retornos", label: "Retornos", count: returns.vencido },
  ]);
  add("Equipe", [
    { href: "/tarefas", label: "Tarefas", count: tasks.open },
    can(ctx, "team.view") && { href: "/equipe", label: "Painel da equipe" },
    can(ctx, "commissions.view_all") && { href: "/comissoes", label: "Comissões" },
  ]);
  add("Meu desempenho", [
    !!ctx.staffId && can(ctx, "finance.own") && { href: "/meu-financeiro", label: "Meu Financeiro" },
    !!ctx.staffId && can(ctx, "achievements.own") && { href: "/conquistas", label: "Conquistas" },
  ]);
  add("Estoque e compras", [
    (can(ctx, "products.view") || can(ctx, "products.sell") || can(ctx, "products.manage")) && { href: "/produtos", label: "Produtos" },
    can(ctx, "purchases.manage") && { href: "/compras", label: "Compras" },
  ]);
  const fv = can(ctx, "finance.view"), cash = can(ctx, "cash.manage");
  add("Financeiro", [
    (fv || cash) && { href: "/financeiro", label: "Resumo" },
    (fv || cash) && { href: "/financeiro/caixa", label: "Caixa" },
    (fv || can(ctx, "finance.payables_view")) && { href: "/financeiro/pagar", label: "Contas a pagar" },
    (fv || can(ctx, "finance.receivables_view")) && { href: "/financeiro/receber", label: "Contas a receber" },
    fv && { href: "/financeiro/conciliacao", label: "Conciliação" },
    fv && { href: "/financeiro/fluxo", label: "Fluxo de caixa" },
  ]);
  add("Resultados", [
    (fv || can(ctx, "finance.dre_view")) && { href: "/financeiro/dre", label: "DRE gerencial" },
    fv && { href: "/financeiro/metas", label: "Metas e reservas" },
    fv && { href: "/financeiro/fechamento", label: "Fechamento mensal" },
    can(ctx, "reports.view") && { href: "/relatorios", label: "Indicadores" },
  ]);
  add("Cadastros", [
    can(ctx, "admin.catalog") && { href: "/admin/servicos", label: "Serviços e preços" },
    can(ctx, "admin.catalog") && { href: "/admin/equipe", label: "Profissionais" },
    can(ctx, "admin.schedules") && { href: "/admin/cadeiras", label: "Cadeiras e horários" },
    can(ctx, "admin.settings") && { href: "/admin/financeiro", label: "Pagamentos e contas" },
  ]);
  add("Sistema", [
    can(ctx, "users.manage") && { href: "/admin/usuarios", label: "Usuários e permissões" },
    can(ctx, "admin.settings") && { href: "/admin/configuracoes", label: "Configurações" },
    can(ctx, "audit.view") && { href: "/admin/auditoria", label: "Auditoria" },
    can(ctx, "data.export") && { href: "/admin/dados", label: "Dados e backup" },
    { href: "/notificacoes", label: "Avisos", count: unread },
  ]);

  const all = groups.flatMap((g) => g.items);
  // no celular: agenda, atendimentos, tarefas e retornos primeiro
  const order = ["/agenda", "/atendimentos", "/tarefas", "/retornos", "/", "/clientes"];
  const primary = order.map((h) => all.find((i) => i.href === h)).filter((i): i is NavItem => !!i).slice(0, 4);

  const quick = [
    can(ctx, "agenda.create") && (can(ctx, "agenda.manage") || can(ctx, "agenda.manage_own")) && { title: "Novo agendamento", href: "/agenda/novo" },
    can(ctx, "customers.manage") && { title: "Novo cliente", href: "/clientes/novo" },
    can(ctx, "products.sell") && { title: "Registrar venda", href: "/produtos/vender" },
    can(ctx, "tasks.create") && { title: "Nova tarefa", href: "/tarefas/nova" },
    can(ctx, "purchases.manage") && { title: "Adicionar à lista de compras", href: "/compras#nova" },
    seesReturns && { title: "Consultar retornos", href: "/retornos" },
    can(ctx, "commissions.view_all") && { title: "Consultar comissões", href: "/comissoes" },
    ctx.staffId && can(ctx, "finance.own") && { title: "Meu financeiro", href: "/meu-financeiro" },
  ].filter((x): x is { title: string; href: string } => !!x).map((x) => ({ type: "Ações rápidas", sub: "", ...x }));

  return (
    <div className="shell">
      <a className="skip" href="#conteudo">Pular para o conteúdo</a>
      <aside className="side">
        <Link className="brand" href="/" aria-label="MARFIM Studio OS — início"><span className="mark" aria-hidden="true">M</span><span className="name">MARFIM<small>Studio OS</small></span></Link>
        <SideNav groups={groups} />
        <SideToggle />
      </aside>
      <div className="main">
        <header className="top">
          <CommandPalette actions={quick} />
          <span className="grow" />
          <span className="only-desktop"><ThemePicker initial={prefs.theme} /></span>
          <Link className={`bell ${unread > 0 ? "has" : ""}`} href="/notificacoes" aria-label={unread > 0 ? `${unread} aviso(s) não lido(s)` : "Avisos"}><Icon name="bell" />{unread > 0 ? `${unread}` : ""}</Link>
          <Link className="who" href="/conta"><span className="avatar" aria-hidden="true">{s.user.fullName.trim().slice(0, 1).toUpperCase()}</span><span className="nm">{s.user.fullName} · {ROLE_LABEL[ctx.role]}</span></Link>
          <form action={logoutAction}><button className="btn small ghost" type="submit">Sair</button></form>
        </header>
        <main className="content" id="conteudo">{children}</main>
      </div>
      <BottomNav primary={primary} groups={groups} account={{ name: s.user.fullName, role: ROLE_LABEL[ctx.role] }} />
      <Spotlight />
      <CountUp />
    </div>
  );
}
