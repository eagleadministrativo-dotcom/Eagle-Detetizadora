import Link from "next/link";
import { OfflineBanner } from "@/components/live";
import { after } from "next/server";
import { runReminders } from "@/server/services/reminders";
import { flushPush } from "@/server/services/push";
import { getDb } from "@/server/db";
import { requireSession } from "@/server/session";
import { can } from "@/server/core";
import { ROLE_LABEL } from "@/server/permissions";
import { runDailyJobs } from "@/server/services/ops";
import { todayYmd } from "@/lib/dates";
import { doneToday, every, markDoneToday } from "@/server/throttle";
import { unreadCount } from "@/server/services/notify";
import { getPrefs } from "@/server/services/access";
import { taskCounts } from "@/server/services/tasks";
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
  // rotina diária: uma vez por dia (o servidor lembra que já rodou e não consulta o banco de novo a cada página)
  const day = `${ctx.unitId}:${todayYmd()}`;
  if (can(ctx, "finance.view") && !doneToday(day)) {
    await runDailyJobs(db, ctx.unitId).then(() => markDoneToday(day), (e) => console.error("[rotina diaria]", e));
  }
  const seesReturns = can(ctx, "returns.view_all") || can(ctx, "returns.own");
  const [unread, tasks, prefs] = await Promise.all([unreadCount(db, ctx), taskCounts(db, ctx), getPrefs(db, ctx.userId)]);
  // Envia por push os avisos novos, depois que a página já respondeu (não atrasa a tela).
  // no máximo a cada 30 s por servidor: os envios importantes já saem na hora pelas ações e o pg_cron cobre o resto
  if (every("layout-after", 30_000)) after(async () => {
    await processEvents(db).catch((e) => console.error("[eventos]", e));
    await runReminders(db).catch((e) => console.error("[lembretes]", e));
    await flushPush(db).catch((e) => console.error("[push]", e));
  });

  // menu por tópicos: cada área aparece uma vez, junto das relacionadas
  const groups: NavGroup[] = [];
  const add = (title: string | undefined, items: (NavItem | false | null | undefined)[]) => { const list = items.filter((x): x is NavItem => !!x); if (list.length) groups.push({ title, items: list }); };
  add(undefined, [(can(ctx, "dashboard.full") || can(ctx, "dashboard.own")) && { href: "/", label: can(ctx, "dashboard.full") ? "Painel" : "Meu dia", short: "Início" }]);
  add("Dedetização", [
    (can(ctx, "agenda.view_all") || can(ctx, "agenda.view_own")) && { href: "/agenda", label: "Agenda" },
    can(ctx, "customers.view") && { href: "/clientes", label: "Clientes" },
    can(ctx, "customers.history") && { href: "/historico", label: "Histórico de serviços" },
    seesReturns && { href: "/retornos", label: "Retornos" },
    (can(ctx, "quotes.view") || can(ctx, "quotes.manage")) && { href: "/orcamentos", label: "Orçamentos" },
    (can(ctx, "agenda.manage") || can(ctx, "agenda.view_all") || can(ctx, "agenda.manage_own")) && { href: "/os", label: "Ordens de serviço" },
  ]);
  add("Equipe", [
    { href: "/tarefas", label: "Tarefas", count: tasks.open },
  ]);
  const fv = can(ctx, "finance.view");
  add("Financeiro", [
    fv && { href: "/financeiro", label: "Resumo" },
    can(ctx, "reports.view") && { href: "/relatorios", label: "Relatórios" },
  ]);
  add("Configurações", [
    can(ctx, "admin.catalog") && { href: "/admin/servicos", label: "Serviços" },
    can(ctx, "admin.catalog") && { href: "/admin/equipe", label: "Equipe" },
  ]);
  add("Sistema", [
    can(ctx, "users.manage") && { href: "/admin/usuarios", label: "Usuários e permissões" },
    can(ctx, "admin.settings") && { href: "/admin/configuracoes", label: "Configurações" },
    can(ctx, "audit.view") && { href: "/admin/auditoria", label: "Auditoria" },
    can(ctx, "audit.view") && { href: "/admin/saude", label: "Saúde do sistema" },
    can(ctx, "data.export") && { href: "/admin/dados", label: "Dados e backup" },
    { href: "/notificacoes", label: "Avisos", count: unread },
  ]);

  const all = groups.flatMap((g) => g.items);
  // no celular: agenda, ordens de serviço, retornos e painel primeiro
  const order = ["/agenda", "/os", "/retornos", "/", "/clientes", "/tarefas"];
  const primary = order.map((h) => all.find((i) => i.href === h)).filter((i): i is NavItem => !!i).slice(0, 4);

  const quick = [
    can(ctx, "agenda.create") && (can(ctx, "agenda.manage") || can(ctx, "agenda.manage_own")) && { title: "Novo agendamento", href: "/agenda/novo" },
    can(ctx, "customers.manage") && { title: "Novo cliente", href: "/clientes/novo" },
    can(ctx, "tasks.create") && { title: "Nova tarefa", href: "/tarefas/nova" },
    can(ctx, "quotes.manage") && { title: "Novo orçamento", href: "/orcamentos/novo" },
    can(ctx, "returns.manage") && { title: "Novo retorno", href: "/retornos/novo" },
    can(ctx, "finance.manage") && { title: "Novo lançamento financeiro", href: "/financeiro#novo" },
  ].filter((x): x is { title: string; href: string } => !!x).map((x) => ({ type: "Ações rápidas", sub: "", ...x }));

  return (
    <div className="shell">
      <a className="skip" href="#conteudo">Pular para o conteúdo</a>
      <aside className="side">
        <Link className="brand" href="/" aria-label="Eagle — início"><img className="mark logo" src="/brand/eagle-mark.png" alt="" aria-hidden="true" /><span className="name">Eagle<small>Detetizadora</small></span></Link>
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
      <BottomNav primary={primary} groups={groups} account={{ name: s.user.fullName, role: ROLE_LABEL[ctx.role], theme: prefs.theme }} />
      <Spotlight />
      <OfflineBanner />
      <CountUp />
    </div>
  );
}
