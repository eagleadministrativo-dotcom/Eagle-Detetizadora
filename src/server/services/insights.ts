import type { Db } from "../db";
import { can } from "../core";
import type { Ctx } from "../permissions";
import { fmtBRL, fmtPct } from "@/lib/money";
import { fmtTime } from "@/lib/dates";
import { goalsProgress, simulateGoal, type Kpi } from "./reports";
import { returnCounts } from "./returns";
import { taskCounts } from "./tasks";

/**
 * Copiloto: sugestões curtas, sempre com uma ação e sempre opcionais (podem ser dispensadas).
 * Nada é feito automaticamente; cada sugestão só aponta para a tela onde a pessoa decide.
 * Só usa o que o papel já pode ver: se faltar permissão, a sugestão simplesmente não aparece.
 */
export interface Insight { id: string; tone: "acao" | "alerta" | "bom" | "info"; icon: string; title: string; body: string; href: string; cta: string; why: string }

interface NextAppt { id: string; starts_at: Date; customer_name: string; services: string | null }

const safe = async <T,>(f: () => Promise<T>): Promise<T | null> => { try { return await f(); } catch { return null; } };

export async function copilotInsights(db: Db, ctx: Ctx, o: { kpis: Kpi[]; nextUp: NextAppt[]; full: boolean }): Promise<Insight[]> {
  const out: Insight[] = [];
  const now = Date.now();

  const next = o.nextUp.find((a) => new Date(a.starts_at).getTime() >= now - 15 * 60_000);
  if (next && new Date(next.starts_at).getTime() - now <= 120 * 60_000) {
    const mins = Math.round((new Date(next.starts_at).getTime() - now) / 60_000);
    out.push({ id: `prox-${next.id}`, tone: "info", icon: "calendar", title: mins <= 0 ? `Agora: ${next.customer_name}` : `Próximo às ${fmtTime(next.starts_at)}`,
      body: `${mins > 0 ? `${next.customer_name} · ` : ""}${next.services ?? "Atendimento"}${mins > 0 && mins <= 90 ? ` · em ${mins} min` : ""}`, href: `/agenda/${next.id}`, cta: "Abrir", why: "Aparece quando há atendimento agendado nas próximas 2 horas." });
  }

  if (can(ctx, "returns.own") || can(ctx, "returns.view_all")) {
    const r = await safe(() => returnCounts(db, ctx));
    const n = r?.vencido ?? 0;
    if (n > 0) out.push({ id: `ret-${n}`, tone: "acao", icon: "repeat", title: `${n} cliente${n > 1 ? "s" : ""} no momento de voltar`,
      body: o.nextUp.length < 3 ? "A agenda de hoje tem espaço: um convite agora pode virar horário marcado." : "Já passaram do intervalo habitual entre visitas.", href: "/retornos?b=vencido", cta: "Convidar", why: "Clientes cujo intervalo habitual entre visitas (ou a regra de retorno definida) já passou e que não têm horário marcado." });
  }

  const t = await safe(() => taskCounts(db, ctx));
  if (t?.overdue) out.push({ id: `tar-${t.overdue}`, tone: "alerta", icon: "check", title: `${t.overdue} tarefa${t.overdue > 1 ? "s" : ""} atrasada${t.overdue > 1 ? "s" : ""}`, body: "Concluir ou repactuar o prazo deixa a equipe alinhada.", href: "/tarefas", cta: "Ver tarefas", why: "Tarefas atribuídas a você com prazo vencido e ainda não concluídas." });

  if (o.full && can(ctx, "finance.view")) {
    const goals = (await safe(() => goalsProgress(db, ctx))) ?? [];
    const ticket = o.kpis.find((k) => k.key === "ticket")?.value ?? null;
    const late = goals.find((g) => g.isActive && g.status === "atrasada");
    const done = goals.find((g) => g.isActive && g.status === "atingida");
    if (late) {
      const sim = simulateGoal(late, ticket);
      if (sim) out.push({ id: `meta-${late.id}`, tone: "alerta", icon: "target", title: `Meta "${late.name}" abaixo do ritmo`,
        body: `Faltam ${fmtBRL(sim.missing)} em ${sim.daysLeft} dia${sim.daysLeft > 1 ? "s" : ""}: cerca de ${fmtBRL(sim.perDay)} por dia${sim.attendancesPerDay ? ` (≈ ${sim.attendancesPerDay.toLocaleString("pt-BR")} atendimentos)` : ""}.`, href: "/financeiro/metas", cta: "Ver meta", why: "O valor atingido está mais de 5 pontos percentuais abaixo do esperado para os dias já passados do período." });
    } else if (done) out.push({ id: `metaok-${done.id}`, tone: "bom", icon: "trophy", title: `Meta "${done.name}" atingida`, body: "Bom momento para reconhecer a equipe.", href: "/financeiro/metas", cta: "Ver meta", why: "Uma meta ativa chegou a 100% do alvo." });
  }

  const occ = o.kpis.find((k) => k.key === "occupancy");
  if (occ?.value != null && occ.value < 35) out.push({ id: `ocup-${Math.round(occ.value)}`, tone: "acao", icon: "chair", title: `Ocupação em ${fmtPct(occ.value)}`, body: "Há horários livres na semana. Divulgar os horários vagos ou convidar quem está no retorno ajuda a preencher.", href: "/agenda", cta: "Ver agenda", why: "A ocupação do período (tempo atendido ÷ tempo disponível) está abaixo de 35%." });

  const tk = o.kpis.find((k) => k.key === "ticket");
  if (o.full && tk?.value != null && tk.previous && tk.value < tk.previous * 0.95) out.push({ id: `tick-${tk.value}`, tone: "info", icon: "receipt", title: "Ticket médio caiu", body: `${fmtBRL(tk.value)} contra ${fmtBRL(tk.previous)} no período anterior. Oferecer um serviço complementar no atendimento pode ajudar.`, href: `/relatorios/ticket`, cta: "Detalhar", why: "O ticket médio do período está mais de 5% abaixo do período anterior equivalente." });

  // dispensadas hoje por esta pessoa (vale em todos os aparelhos)
  const hidden = new Set((await safe(() => db.query<{ insight_id: string }>("select insight_id from copilot_dismissals where user_id=$1 and dismissed_on=current_date", [ctx.userId]))) ?.map((r) => r.insight_id) ?? []);
  return out.filter((i) => !hidden.has(i.id)).slice(0, 4);
}

/** Dispensa uma sugestão até amanhã. O motivo (opcional) ajuda a calibrar as regras. */
export async function dismissInsight(db: Db, ctx: Ctx, id: string, reason?: string | null) {
  await db.query("insert into copilot_dismissals(user_id, insight_id, reason) values ($1,$2,$3) on conflict do nothing", [ctx.userId, id.slice(0, 120), reason?.slice(0, 200) ?? null]);
}
