import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { getAchievements } from "@/server/services/achievements";
import { fmtDate, fmtYmd } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { Empty, PageHead, Badge } from "@/components/ui";

export const metadata = { title: "Conquistas" };
const TONE = ["w", "o", "", "o", "", "w"];
const per = (period: string, ymd: string) => (period === "mes" ? `${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : period === "semana" ? `semana de ${fmtYmd(ymd)}` : fmtYmd(ymd));

export default async function Achievements({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("achievements.own", "team.view");
  const target = sp.s && /^[0-9a-f-]{36}$/.test(sp.s) && ctx.perms.has("team.view") ? sp.s : ctx.staffId;
  if (!target) return <><PageHead title="Conquistas" /><Empty title="Seu usuário não está vinculado a um profissional" /></>;
  const a = await getAchievements(await getDb(), ctx, target);
  const show = (unit: string, v: number) => (unit === "brl" ? fmtBRL(v) : v.toLocaleString("pt-BR"));
  const fresh = new Set(a.recent.map((r) => `${r.metric}:${r.period_start}`));
  const def = (m: string) => a.defs.find((d) => d.metric === m)!;
  return (
    <>
      <PageHead title={target === ctx.staffId ? "Conquistas" : `Conquistas de ${a.name}`} sub="Seus melhores resultados. Só você e a gestão veem esta página." />
      {a.recent.length ? <div className="alert ok pulse" role="status"><b>Novo recorde pessoal!</b> {def(a.recent[0].metric).label}: {show(def(a.recent[0].metric).unit, a.recent[0].value)}, superando {show(def(a.recent[0].metric).unit, a.recent[0].previous_value!)}.</div> : null}
      <div className="medals">
        {a.cards.map((c, i) => (
          <article key={c.def.metric} className={`medal ${TONE[i]} ${c.record ? "" : "none"} ${c.record && fresh.has(`${c.def.metric}:${c.record.period_start}`) ? "fresh" : ""}`} data-spot="">
            <span className="ring" aria-hidden="true" />
            <span className="ttl">{c.def.label}</span>
            <span className="val">{c.record ? show(c.def.unit, c.record.value) : "—"}</span>
            <span className="sub">
              {c.record ? <>{per(c.def.period, c.record.period_start)}{c.previous != null ? <> · antes {show(c.def.unit, c.previous)}</> : null}</> : c.def.metric === "ticket_mes" ? `Precisa de ${a.minVolume} atendimentos num mês fechado` : c.def.period === "dia" ? "Ainda sem registro" : "Conta quando o período fechar"}
              {c.current && c.def.period !== "dia" ? <><br />{c.provisional ? "Recorde provisório: " : "Período atual: "}{show(c.def.unit, c.current.value)}</> : null}
            </span>
          </article>
        ))}
      </div>
      <section className="card stack">
        <h2>Histórico</h2>
        {a.history.length === 0 ? <Empty title="As conquistas aparecem aqui">Cada recorde superado fica registrado com a data e o valor anterior.</Empty> : a.history.map((h) => (
          <div className="row" key={h.id}><span className="grow">{def(h.metric).label} · <b>{show(def(h.metric).unit, h.value)}</b> <small>{per(def(h.metric).period, h.period_start)}{h.previous_value != null ? ` · superou ${show(def(h.metric).unit, h.previous_value)}` : ""}</small></span>{h.status === "corrigida" ? <Badge>corrigida</Badge> : null}<small>{fmtDate(h.achieved_at)}</small></div>
        ))}
      </section>
    </>
  );
}
