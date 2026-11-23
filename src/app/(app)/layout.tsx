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
import { logoutAction } from "@/app/actions/auth";
import { Icon } from "@/components/icons";
import { BottomNav, SideNav, SideToggle, type NavGroup, type NavItem } from "@/components/nav";

export const dynamic = "force-dynamic";
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const { ctx } = s;
  const db = await getDb();
  if (can(ctx, "finance.view")) await runDailyJobs(db, ctx.unitId).catch((e) => console.error("[rotina diaria]", e));
  const unread = await unreadCount(db, ctx);
  // Envia por push os avisos novos, depois que a página já respondeu (não atrasa a tela).
  after(async () => {
    await runReminders(db).catch((e) => console.error("[lembretes]", e));
    await flushPush(db).catch((e) => console.error("[push]", e));
  });

  const groups: NavGroup[] = [];
  const main: NavItem[] = [];
  if (can(ctx, "dashboard.full") || can(ctx, "dashboard.own")) main.push({ href: "/", label: can(ctx, "dashboard.full") ? "Visão geral" : "Meu dia", short: "Início" });
  if (can(ctx, "agenda.view_all") || can(ctx, "agenda.view_own")) main.push({ href: "/agenda", label: "Agenda" });
  if (can(ctx, "attendance.view_all") || can(ctx, "attendance.view_own")) main.push({ href: "/atendimentos", label: "Atendimentos", short: "Atend." });
  if (can(ctx, "customers.view")) main.push({ href: "/clientes", label: "Clientes" });
  groups.push({ items: main });
  const fin: NavItem[] = [];
  if (can(ctx, "finance.view") || can(ctx, "cash.manage")) {
    fin.push({ href: "/financeiro", label: "Resumo" }, { href: "/financeiro/caixa", label: "Caixa" });
    if (can(ctx, "finance.view")) fin.push(
      { href: "/financeiro/pagar", label: "Contas a pagar" }, { href: "/financeiro/receber", label: "Contas a receber" },
      { href: "/financeiro/conciliacao", label: "Conciliação" }, { href: "/financeiro/dre", label: "DRE gerencial" },
      { href: "/financeiro/fluxo", label: "Fluxo de caixa" }, { href: "/financeiro/metas", label: "Metas e reservas" }, { href: "/financeiro/fechamento", label: "Fechamento mensal" },
    );
    groups.push({ title: "Financeiro", items: fin });
  }
  if (can(ctx, "reports.view")) groups.push({ title: "Relatórios", items: [{ href: "/relatorios", label: "Indicadores e relatórios" }] });
  const adm: NavItem[] = [];
  if (can(ctx, "admin.catalog")) adm.push({ href: "/admin/servicos", label: "Serviços e preços" }, { href: "/admin/equipe", label: "Equipe" });
  if (can(ctx, "admin.schedules")) adm.push({ href: "/admin/cadeiras", label: "Cadeiras e horários" });
  if (can(ctx, "admin.settings")) adm.push({ href: "/admin/financeiro", label: "Pagamentos e plano de contas" }, { href: "/admin/configuracoes", label: "Configurações" });
  if (can(ctx, "users.manage")) adm.push({ href: "/admin/usuarios", label: "Usuários e permissões" });
  if (can(ctx, "audit.view")) adm.push({ href: "/admin/auditoria", label: "Auditoria" });
  if (can(ctx, "data.export")) adm.push({ href: "/admin/dados", label: "Dados e backup" });
  if (adm.length) groups.push({ title: "Administração", items: adm });

  const all = groups.flatMap((g) => g.items);
  const primary = main.slice(0, 4);
  const more = all.filter((i) => !primary.includes(i));

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
          <span className="grow" />
          {can(ctx, "finance.view") || can(ctx, "dashboard.full") ? (
            <Link className={`bell ${unread > 0 ? "has" : ""}`} href="/notificacoes" aria-label={unread > 0 ? `${unread} alerta(s) não lido(s)` : "Alertas"}><Icon name="bell" />{unread > 0 ? `${unread}` : "Alertas"}</Link>
          ) : null}
          <Link className="who" href="/conta"><span className="avatar" aria-hidden="true">{s.user.fullName.trim().slice(0, 1).toUpperCase()}</span><span className="nm">{s.user.fullName} · {ROLE_LABEL[ctx.role]}</span></Link>
          <form action={logoutAction}><button className="btn small ghost" type="submit">Sair</button></form>
        </header>
        <main className="content" id="conteudo">{children}</main>
      </div>
      <BottomNav primary={primary} more={more} />
    </div>
  );
}
