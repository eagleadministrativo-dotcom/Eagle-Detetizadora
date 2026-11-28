import Link from "next/link";
import { LiveAgenda } from "@/components/live";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can, getSettings } from "@/server/core";
import { listAppointments, listBlocks } from "@/server/services/agenda";
import { listCatalog } from "@/server/services/catalog";
import { getPrefs } from "@/server/services/access";
import { addDays, addMonths, dayEndUtc, dayOfWeek, dayStartUtc, fmtTime, fmtYmd, monthEnd, monthStart, todayYmd, toYmd } from "@/lib/dates";
import { Empty, Flash, PageHead, Seg } from "@/components/ui";
import { Calendar, type CalBlock, type CalCol, type CalEvent } from "@/components/calendar";
import { removeBlockAction } from "@/app/actions/agenda";

export const metadata = { title: "Agenda" };
type SP = { d?: string; v?: string; g?: string; s?: string; ok?: string; erro?: string };
const DOW = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MON = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export default async function AgendaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("agenda.view_all", "agenda.view_own");
  const db = await getDb();
  const today = todayYmd();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? "") && !Number.isNaN(Date.parse(sp.d!)) ? sp.d! : today;
  const prefs = await getPrefs(db, ctx.userId);
  const view = sp.v === "dia" || sp.v === "semana" || sp.v === "mes" ? sp.v : prefs.agenda_view;
  const all = can(ctx, "agenda.view_all");
  const group: string = "prof"; // a visão por "local" (herança da barbearia) saiu: na Eagle o que importa é o técnico e o endereço
  const staffFilter = all ? (/^[0-9a-f-]{36}$/.test(sp.s ?? "") ? sp.s! : null) : ctx.staffId ?? null;
  const cat = await listCatalog(db, ctx.unitId);
  const settings = await getSettings(db.query, ctx.unitId);
  const manageAll = can(ctx, "agenda.manage"), manageOwn = can(ctx, "agenda.manage_own");
  const canBook = can(ctx, "agenda.create") && (manageAll || manageOwn);
  const href = (o: Partial<SP>) => `/agenda?${new URLSearchParams({ d, v: view, g: group, ...(staffFilter && all ? { s: staffFilter } : {}), ...(o as Record<string, string>) }).toString()}`;

  const weekStart = addDays(d, -((dayOfWeek(d) + 6) % 7));
  const gridStart = view === "mes" ? addDays(monthStart(d), -((dayOfWeek(monthStart(d)) + 6) % 7)) : view === "semana" ? weekStart : d;
  const gridEnd = view === "mes" ? addDays(monthEnd(d), (7 - dayOfWeek(monthEnd(d))) % 7) : view === "semana" ? addDays(weekStart, 6) : d;
  const range = { from: dayStartUtc(gridStart), to: dayEndUtc(gridEnd) };
  const appts = await listAppointments(db, ctx, range, { staffId: staffFilter });
  const blocks = await listBlocks(db, ctx, range);
  const prev = view === "mes" ? addMonths(monthStart(d), -1) : addDays(d, view === "semana" ? -7 : -1);
  const next = view === "mes" ? addMonths(monthStart(d), 1) : addDays(d, view === "semana" ? 7 : 1);
  const title = view === "mes" ? `${MON[Number(d.slice(5, 7)) - 1]} de ${d.slice(0, 4)}` : view === "semana" ? `${fmtYmd(weekStart).slice(0, 5)} a ${fmtYmd(addDays(weekStart, 6)).slice(0, 5)}` : `${DOW[dayOfWeek(d)]}, ${fmtYmd(d).slice(0, 5)}`;

  const staff = cat.staff.filter((s) => s.is_active && (!staffFilter || s.id === staffFilter));
  const chairs = cat.chairs.filter((c) => c.is_active);
  const days = Array.from({ length: view === "semana" ? 7 : 1 }, (_, i) => addDays(view === "semana" ? weekStart : d, i));
  const scheds = view === "mes" ? [] : await db.query<{ staff_id: string; day_of_week: number; a: string; b: string }>("select ss.staff_id, ss.day_of_week, to_char(ss.start_time,'HH24:MI') as a, to_char(ss.end_time,'HH24:MI') as b from staff_schedules ss join staff s on s.id=ss.staff_id where s.unit_id=$1 order by ss.start_time", [ctx.unitId]);
  const hours = (ymd: string) => (settings.business_hours[String(dayOfWeek(ymd))] ?? []).map(([a, b]) => [toMin(a), toMin(b)] as [number, number]);

  // faixa visível: funcionamento do período, ampliada por agendamentos fora dele
  const mins = (t: Date, ymd: string) => Math.round((t.getTime() - dayStartUtc(ymd).getTime()) / 60000);
  const spans = [...days.flatMap(hours), ...scheds.filter((s) => days.some((x) => dayOfWeek(x) === s.day_of_week)).map((s) => [toMin(s.a), toMin(s.b)] as [number, number]), ...appts.map((a) => { const y = toYmd(a.starts_at); return [mins(a.starts_at, y), mins(a.ends_at, y)] as [number, number]; })];
  const start = Math.max(0, Math.floor(Math.min(8 * 60, ...spans.map((s) => s[0])) / 60) * 60);
  const end = Math.min(24 * 60, Math.ceil(Math.max(20 * 60, ...spans.map((s) => s[1])) / 60) * 60);
  const offOf = (open: [number, number][]): [number, number][] => {
    if (!open.length) return [];
    const out: [number, number][] = [];
    let at = start;
    for (const [a, b] of [...open].sort((x, y) => x[0] - y[0])) { if (a > at) out.push([at, a]); at = Math.max(at, b); }
    if (at < end) out.push([at, end]);
    return out;
  };
  const work = (staffId: string, ymd: string) => {
    const mine = scheds.filter((s) => s.staff_id === staffId);
    if (!mine.length) return hours(ymd);
    const t = mine.filter((s) => s.day_of_week === dayOfWeek(ymd)).map((s) => [toMin(s.a), toMin(s.b)] as [number, number]);
    return t.length ? t : [[end, end] as [number, number]]; // folga: o dia inteiro fora da escala
  };
  const cols: CalCol[] = view === "semana"
    ? days.map((y) => ({ key: y, date: y, staffId: staffFilter ?? undefined, label: DOW[dayOfWeek(y)].slice(0, 3), num: String(Number(y.slice(8))), href: href({ d: y, v: "dia" }), today: y === today, off: offOf(staffFilter ? work(staffFilter, y) : hours(y)) }))
    : group === "cadeira" && all ? chairs.map((c) => ({ key: c.id, date: d, chairId: c.id, label: c.name, today: d === today, off: offOf(hours(d)) }))
    : staff.map((s) => ({ key: s.id, date: d, staffId: s.id, label: s.name, color: s.color, today: d === today, off: offOf(work(s.id, d)) }));
  const colKey = (a: { starts_at: Date; staff_id: string; chair_id: string }) => (view === "semana" ? toYmd(a.starts_at) : group === "cadeira" && all ? a.chair_id : a.staff_id);
  const events: CalEvent[] = appts.flatMap((a) => { const y = toYmd(a.starts_at); const ev: CalEvent = {
    id: a.id, col: colKey(a), s: mins(a.starts_at, y), e: mins(a.ends_at, y), title: a.customer_name, sub: [a.services, view === "semana" && !staffFilter ? a.staff_name : a.address].filter(Boolean).join(" · "), status: a.status, color: a.staff_color,
    movable: a.status === "agendado" && can(ctx, "agenda.edit") && (manageAll || (manageOwn && a.staff_id === ctx.staffId)), rec: !!a.series_id,
  };
  // serviço com mais de um técnico: aparece também na coluna de cada acompanhante (só o do responsável se arrasta)
  const copies = view === "semana" ? [] : a.helper_ids.map((h): CalEvent => ({ ...ev, id: `${a.id}:${h}`, href: `/agenda/${a.id}`, col: h, movable: false, sub: [a.services, `com ${a.staff_name}`].filter(Boolean).join(" · ") }));
  return [ev, ...copies]; });
  const calBlocks: CalBlock[] = view === "mes" ? [] : blocks.flatMap((b) => cols.filter((c) => (view === "semana" ? (!b.staff_id || b.staff_id === staffFilter) && !b.chair_id : group === "cadeira" && all ? (b.chair_id ? b.chair_id === c.chairId : !b.staff_id) : (b.staff_id ? b.staff_id === c.staffId : !b.chair_id))).flatMap((c) => {
    const s = Math.max(0, mins(b.starts_at, c.date)), e = Math.min(1440, mins(b.ends_at, c.date));
    return e > s && s < 1440 ? [{ id: b.id, col: c.key, s, e, reason: b.reason }] : [];
  }));

  return (
    <>
      <LiveAgenda />
      <PageHead title="Agenda">
        {canBook ? <Link className="btn accent" href={`/agenda/novo?d=${d}`}>Agendar</Link> : null}
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="calbar">
        <div className="calnav">
          <Link className="btn icon ghost" href={href({ d: prev })} aria-label="Anterior">‹</Link>
          <Link className="btn icon ghost" href={href({ d: next })} aria-label="Próximo">›</Link>
          <Link className="btn ghost small" href={href({ d: today })}>Hoje</Link>
          <h2>{title}</h2>
        </div>
        <div className="row">
          <form method="get" className="row datejump"><input type="hidden" name="v" value={view} /><input type="hidden" name="g" value={group} />{staffFilter && all ? <input type="hidden" name="s" value={staffFilter} /> : null}<input type="date" name="d" defaultValue={d} aria-label="Ir para a data" style={{ width: 150 }} /><button className="btn small ghost" type="submit">Ir</button></form>
          <Seg items={[{ href: href({ v: "dia" }), label: "Dia", active: view === "dia" }, { href: href({ v: "semana" }), label: "Semana", active: view === "semana" }, { href: href({ v: "mes" }), label: "Mês", active: view === "mes" }]} />
        </div>
      </div>
      {all && cat.staff.filter((s) => s.is_active).length > 1 ? (
        <div className="chips scroll">
          <Link className="chip" style={{ textDecoration: "none", ...(staffFilter ? {} : { background: "var(--olive-soft)", borderColor: "var(--olive)" }) }} href={`/agenda?${new URLSearchParams({ d, v: view, g: group }).toString()}`}>Todos</Link>
          {cat.staff.filter((s) => s.is_active).map((s) => <Link key={s.id} className="chip" style={{ textDecoration: "none", ...(staffFilter === s.id ? { background: "var(--olive-soft)", borderColor: "var(--olive)" } : {}) }} href={href({ s: s.id })}><span className="pri" style={{ background: s.color }} />{s.name}</Link>)}
        </div>
      ) : null}
      {view === "mes" ? (
        <div className="calendar month">
          {[1, 2, 3, 4, 5, 6, 0].map((w) => <div className="dh" key={w}>{DOW[w].slice(0, 3)}</div>)}
          {Array.from({ length: Math.round((Date.parse(gridEnd) - Date.parse(gridStart)) / 86400000) + 1 }, (_, i) => addDays(gridStart, i)).map((y) => {
            const list = appts.filter((a) => toYmd(a.starts_at) === y);
            return (
              <Link key={y} className={`d ${y.slice(0, 7) !== d.slice(0, 7) ? "out" : ""} ${y === today ? "today" : ""}`} href={href({ d: y, v: "dia" })} aria-label={`${fmtYmd(y)}: ${list.length} agendamento(s)`}>
                <span className="n">{Number(y.slice(8))}</span>
                {list.slice(0, 3).map((a) => <span key={a.id} className="e" style={{ "--c": a.staff_color } as React.CSSProperties}>{fmtTime(a.starts_at)} {a.customer_name}</span>)}
                {list.length > 3 ? <small>+{list.length - 3}</small> : null}
              </Link>
            );
          })}
        </div>
      ) : cols.length === 0 ? <Empty title="Nada para mostrar">Cadastre os técnicos em Administração.</Empty> : (
        <Calendar cols={cols} events={events} blocks={calBlocks} start={start} end={end} canBook={canBook} canBlock={can(ctx, "agenda.block")} />
      )}
      {view !== "mes" && canBook ? <small>Arraste um horário para reagendar, puxe a borda de baixo para mudar a duração ou selecione um espaço livre. No celular, segure o horário antes de arrastar.</small> : null}
      {view === "dia" && blocks.length ? (
        <section className="card">
          <h2>Bloqueios do dia</h2>
          <div className="stack">
            {blocks.map((b) => (
              <div className="row" key={b.id}>
                <span className="grow"><b>{fmtTime(b.starts_at)}–{fmtTime(b.ends_at)}</b> · {b.reason} <small>({b.staff_name ?? "todos os técnicos"})</small></span>
                {can(ctx, "agenda.block") ? <form action={removeBlockAction}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="d" value={d} /><button className="btn small ghost" type="submit">Remover</button></form> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
