import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can, getSettings } from "@/server/core";
import { listAppointments, listBlocks, type AppointmentRow } from "@/server/services/agenda";
import { listCatalog } from "@/server/services/catalog";
import { addDays, dayEndUtc, dayOfWeek, dayStartUtc, fmtTime, fmtYmd, todayYmd } from "@/lib/dates";
import { ApptBadge, Empty, Flash, PageHead, Seg } from "@/components/ui";
import { removeBlockAction } from "@/app/actions/agenda";

export const metadata = { title: "Agenda" };
type SP = { d?: string; v?: string; g?: string; s?: string; ok?: string; erro?: string };
const DOW = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default async function AgendaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("agenda.view_all", "agenda.view_own");
  const db = await getDb();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? "") ? sp.d! : todayYmd();
  const view = sp.v === "semana" ? "semana" : "dia";
  const group = sp.g === "prof" ? "prof" : "cadeira";
  const all = can(ctx, "agenda.view_all");
  const staffFilter = all ? sp.s || null : ctx.staffId ?? null;
  const cat = await listCatalog(db, ctx.unitId);
  const settings = await getSettings(db.query, ctx.unitId);
  const canBook = can(ctx, "agenda.manage") || can(ctx, "agenda.manage_own");
  const q = (o: Partial<SP>) => {
    const p = new URLSearchParams({ d, v: view, g: group, ...(staffFilter && all ? { s: staffFilter } : {}), ...(o as Record<string, string>) });
    return `/agenda?${p.toString()}`;
  };
  const step = view === "semana" ? 7 : 1;

  const weekStart = addDays(d, -((dayOfWeek(d) + 6) % 7));
  const rangeStart = view === "semana" ? weekStart : d;
  const rangeEnd = view === "semana" ? addDays(weekStart, 6) : d;
  const range = { from: dayStartUtc(rangeStart), to: dayEndUtc(rangeEnd) };
  const appts = await listAppointments(db, ctx, range, { staffId: staffFilter, includeCancelled: false });
  const blocks = await listBlocks(db, ctx, range);

  const title = view === "semana" ? `Semana de ${fmtYmd(weekStart)}` : `${DOW[dayOfWeek(d)]}, ${fmtYmd(d)}`;
  const newLink = (extra: Record<string, string> = {}) => `/agenda/novo?${new URLSearchParams({ d, ...extra }).toString()}`;

  // geometria do calendário (dia)
  const dayBH = settings.business_hours[String(dayOfWeek(d))] ?? [];
  let startMin = dayBH.length ? Math.min(...dayBH.map(([a]) => Number(a.slice(0, 2)) * 60 + Number(a.slice(3)))) : 8 * 60;
  let endMin = dayBH.length ? Math.max(...dayBH.map(([, b]) => Number(b.slice(0, 2)) * 60 + Number(b.slice(3)))) : 20 * 60;
  const dayStart = dayStartUtc(d).getTime();
  const mins = (t: Date) => Math.round((t.getTime() - dayStart) / 60000);
  if (view === "dia") for (const a of appts) { startMin = Math.min(startMin, Math.floor(mins(a.starts_at) / 60) * 60); endMin = Math.max(endMin, Math.ceil(mins(a.ends_at) / 60) * 60); }
  startMin = Math.max(0, startMin); endMin = Math.min(24 * 60, Math.max(endMin, startMin + 60));
  const rows = (endMin - startMin) / 15;
  const cols = group === "cadeira" ? cat.chairs.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name })) : cat.staff.filter((s) => s.is_active && (!staffFilter || s.id === staffFilter)).map((s) => ({ id: s.id, name: s.name }));
  const colOf = (a: AppointmentRow) => cols.findIndex((c) => c.id === (group === "cadeira" ? a.chair_id : a.staff_id));

  const apptLink = (a: AppointmentRow) => `/agenda/${a.id}`;
  const apptText = (a: AppointmentRow) => (
    <>
      <b>{fmtTime(a.starts_at)}</b> {a.customer_name}
      <br /><small>{a.services}</small>
    </>
  );

  return (
    <>
      <PageHead title="Agenda" sub={title}>
        <Seg items={[{ href: q({ v: "dia" }), label: "Dia", active: view === "dia" }, { href: q({ v: "semana" }), label: "Semana", active: view === "semana" }]} />
        <Link className="btn ghost" href={q({ d: addDays(d, -step) })}>‹</Link>
        <Link className="btn ghost" href={q({ d: todayYmd() })}>Hoje</Link>
        <Link className="btn ghost" href={q({ d: addDays(d, step) })}>›</Link>
        {canBook ? <Link className="btn accent" href={newLink()}>+ Agendar</Link> : null}
        {canBook ? <Link className="btn ghost" href="/agenda/novo?imediato=1">Sem hora marcada</Link> : null}
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />

      {all ? (
        <form className="filters" method="get">
          <input type="hidden" name="d" value={d} /><input type="hidden" name="v" value={view} />
          <label>Visão por<select name="g" defaultValue={group}><option value="cadeira">Cadeira</option><option value="prof">Profissional</option></select></label>
          <label>Profissional<select name="s" defaultValue={staffFilter ?? ""}><option value="">Todos</option>{cat.staff.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <button className="btn ghost" type="submit">Filtrar</button>
        </form>
      ) : null}

      {view === "dia" ? (
        <>
          {cat.chairs.filter((c) => c.is_active).length === 0 ? <Empty title="Nenhuma cadeira cadastrada">Cadastre em Administração → Cadeiras e horários.</Empty> : (
            <div className="only-desktop">
              <div className="cal" style={{ gridTemplateColumns: `52px repeat(${Math.max(cols.length, 1)}, minmax(150px, 1fr))`, gridTemplateRows: `34px repeat(${rows}, 20px)` }}>
                <div className="ch" style={{ borderLeft: 0 }} />
                {cols.map((c, i) => <div key={c.id} className="ch" style={{ gridColumn: i + 2, gridRow: 1 }}>{c.name}</div>)}
                {Array.from({ length: rows / 2 }, (_, i) => {
                  const m = startMin + i * 30;
                  return <div key={m} className="tl" style={{ gridColumn: 1, gridRow: `${2 + i * 2} / span 2` }}>{m % 60 === 0 ? hhmm(m) : ""}</div>;
                })}
                {canBook ? cols.flatMap((c, ci) => Array.from({ length: rows / 2 }, (_, i) => {
                  const m = startMin + i * 30;
                  const extra: Record<string, string> = { t: hhmm(m), ...(group === "cadeira" ? { c: c.id } : { s: c.id }) };
                  return <Link key={`${c.id}-${m}`} className="fs" href={newLink(extra)} style={{ gridColumn: ci + 2, gridRow: `${2 + i * 2} / span 2` }} aria-label={`Agendar ${hhmm(m)} em ${c.name}`}>+</Link>;
                })) : null}
                {blocks.filter((b) => mins(b.starts_at) < endMin && mins(b.ends_at) > startMin).flatMap((b) => {
                  const targets = group === "cadeira" ? (b.chair_id ? [b.chair_id] : b.staff_id ? [] : cols.map((c) => c.id)) : (b.staff_id ? [b.staff_id] : b.chair_id ? [] : cols.map((c) => c.id));
                  return targets.map((tid) => {
                    const ci = cols.findIndex((c) => c.id === tid);
                    if (ci < 0) return null;
                    const r1 = Math.max(0, (Math.max(mins(b.starts_at), startMin) - startMin) / 15), r2 = (Math.min(mins(b.ends_at), endMin) - startMin) / 15;
                    return <div key={`${b.id}-${tid}`} className="appt block ev" style={{ gridColumn: ci + 2, gridRow: `${2 + r1} / ${2 + r2}` }}><b>Bloqueado</b> {b.reason}</div>;
                  });
                })}
                {appts.map((a) => {
                  const ci = colOf(a);
                  if (ci < 0) return null;
                  const r1 = Math.max(0, (mins(a.starts_at) - startMin) / 15), r2 = Math.max(r1 + 1, (mins(a.ends_at) - startMin) / 15);
                  return (
                    <Link key={a.id} href={apptLink(a)} className={`appt ev ${a.status}`} style={{ gridColumn: ci + 2, gridRow: `${2 + Math.floor(r1)} / ${2 + Math.ceil(r2)}`, borderLeftColor: a.staff_color }}>
                      {apptText(a)}{group === "cadeira" ? <small> · {a.staff_name}</small> : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
          <div className="only-mobile">
            {appts.length === 0 && blocks.length === 0 ? <Empty title="Dia livre">Nenhum agendamento. Toque em &quot;+ Agendar&quot;.</Empty> : (
              <div className="daylist">
                {[...appts.map((a) => ({ t: a.starts_at, node: (
                  <Link key={a.id} className="item" href={apptLink(a)}>
                    <span className="t">{fmtTime(a.starts_at)}</span>
                    <span><b>{a.customer_name}</b><br /><small>{a.services} · {a.staff_name} · {a.chair_name}</small></span>
                    <ApptBadge s={a.status} />
                  </Link>) })),
                ...blocks.map((b) => ({ t: b.starts_at, node: <div key={b.id} className="item"><span className="t">{fmtTime(b.starts_at)}</span><span><b>Bloqueado</b><br /><small>{b.reason}</small></span><span /></div> }))]
                  .sort((x, y) => x.t.getTime() - y.t.getTime()).map((x) => x.node)}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="week">
          {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((day) => {
            const list = appts.filter((a) => a.starts_at >= dayStartUtc(day) && a.starts_at < dayEndUtc(day));
            return (
              <div className="day" key={day}>
                <h3><Link href={q({ d: day, v: "dia" })}>{DOW[dayOfWeek(day)].slice(0, 3)} {fmtYmd(day).slice(0, 5)}</Link></h3>
                {list.length === 0 ? <small>Livre</small> : list.map((a) => <Link key={a.id} href={apptLink(a)} className={`appt ${a.status}`} style={{ borderLeftColor: a.staff_color }}>{apptText(a)}</Link>)}
              </div>
            );
          })}
        </div>
      )}

      {view === "dia" && blocks.length ? (
        <section className="card">
          <h2>Bloqueios do dia</h2>
          <div className="stack" style={{ marginTop: 8 }}>
            {blocks.map((b) => (
              <div className="row" key={b.id}>
                <span><b>{fmtTime(b.starts_at)}–{fmtTime(b.ends_at)}</b> · {b.reason} <small>({b.chair_name ?? b.staff_name ?? "toda a unidade"})</small></span>
                {can(ctx, "agenda.block") ? <form action={removeBlockAction}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="d" value={d} /><button className="btn small ghost" type="submit">Remover</button></form> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
