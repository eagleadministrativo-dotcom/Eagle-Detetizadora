import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listAppointments } from "@/server/services/agenda";
import { listCatalog } from "@/server/services/catalog";
import { dayEndUtc, dayStartUtc, fmtDate, fmtDateTime, fmtTime, toYmd } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { ApptBadge, ConfirmAction, Field, Flash, PageHead } from "@/components/ui";
import { seriesOf } from "@/server/services/series";
import { seriesAction } from "@/app/actions/agenda";
import { cancelAppointmentAction, noShowAction, rescheduleAction, startAttendanceAction } from "@/app/actions/agenda";
import { orderOfAppointment } from "@/server/services/eagle";
import { createServiceOrderAction } from "@/app/actions/eagle";

export const metadata = { title: "Agendamento" };

export default async function AppointmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("agenda.view_all", "agenda.view_own");
  const db = await getDb();
  const [row] = await db.query<{ starts_at: Date }>("select starts_at from appointments where id=$1 and unit_id=$2", [id, ctx.unitId]);
  if (!row) notFound();
  const ymd = toYmd(row.starts_at);
  const a = (await listAppointments(db, ctx, { from: dayStartUtc(ymd), to: dayEndUtc(ymd) }, { includeCancelled: true })).find((x) => x.id === id);
  if (!a) notFound();
  const [sid] = await db.query<{ series_id: string | null }>("select series_id from appointments where id=$1", [id]);
  const series = sid?.series_id ? await seriesOf(db, ctx, sid.series_id) : null;
  const cat = await listCatalog(db, ctx.unitId);
  const mine = can(ctx, "agenda.manage") || (can(ctx, "agenda.manage_own") && ctx.staffId === a.staff_id);
  const canRun = can(ctx, "attendance.run") || (can(ctx, "attendance.run_own") && ctx.staffId === a.staff_id);
  const os = await orderOfAppointment(db, ctx.unitId, id);
  const [h] = await db.query<{ cancelled_by_name: string | null; cancelled_at: Date | null }>("select u.full_name as cancelled_by_name, ap.cancelled_at from appointments ap left join users u on u.id=ap.cancelled_by where ap.id=$1", [id]);

  return (
    <>
      <PageHead title={a.customer_name} sub={<>{fmtDate(a.starts_at)} · {fmtTime(a.starts_at)}–{fmtTime(a.ends_at)} · {a.staff_name} · {a.chair_name}</>}>
        <ApptBadge s={a.status} />
        <Link className="btn ghost" href={`/agenda?d=${ymd}`}>Voltar à agenda</Link>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid cols-2">
        <section className="card stack">
          <h2>Detalhes</h2>
          <div><small>Serviços</small><br />{a.services} · <b className="mono">{fmtBRL(a.total_cents)}</b></div>
          {a.customer_phone ? <div><small>Telefone</small><br />{a.customer_phone}</div> : null}
          {a.customer_notes ? <div><small>Observações do cliente</small><br />{a.customer_notes}</div> : null}
          {a.notes ? <div><small>Observações do agendamento</small><br />{a.notes}</div> : null}
          {a.status === "cancelado" ? <div className="alert">Cancelado: {a.cancellation_reason}{h?.cancelled_by_name ? ` (por ${h.cancelled_by_name} em ${h.cancelled_at ? fmtDateTime(h.cancelled_at) : ""})` : ""}</div> : null}
          {a.attendance_id ? <Link className="btn" href={`/atendimentos/${a.attendance_id}`}>Abrir atendimento</Link> : null}
          {os ? (
            <Link className="btn" href={`/os/${os.id}`}>Ordem de serviço nº {os.number}</Link>
          ) : mine && a.status !== "cancelado" ? (
            <form action={createServiceOrderAction}><input type="hidden" name="appointmentId" value={a.id} /><button className="btn accent" type="submit">Abrir ordem de serviço</button></form>
          ) : null}
        </section>
        {mine && a.status === "agendado" ? (
          <section className="card stack">
            <h2>Ações</h2>
            {canRun ? <form action={startAttendanceAction}><input type="hidden" name="id" value={a.id} /><button className="btn accent" type="submit">Iniciar atendimento</button></form> : null}
            <ConfirmAction label={series ? "Reagendar só este" : "Reagendar"} tone="neutral" action={rescheduleAction} submit="Reagendar">
              <input type="hidden" name="id" value={a.id} />
              <div className="fields">
                <Field label="Data"><input type="date" name="date" defaultValue={ymd} required /></Field>
                <Field label="Hora"><input type="time" name="time" step={900} defaultValue={fmtTime(a.starts_at)} required /></Field>
                {can(ctx, "agenda.manage") ? (
                  <>
                    <Field label="Profissional"><select name="staffId" defaultValue={a.staff_id}>{cat.staff.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
                    <Field label="Local"><select name="chairId" defaultValue={a.chair_id}>{cat.chairs.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                  </>
                ) : null}
              </div>
              <Field label="Motivo (opcional)"><input name="reason" /></Field>
            </ConfirmAction>
            {series ? (
              <>
                <small>Parte de uma série: {series.label} às {series.time_hhmm}, {series.future} horário(s) à frente.{series.conflicts.length ? ` Sem vaga em ${series.conflicts.map((c) => c.d.slice(8) + "/" + c.d.slice(5, 7)).join(", ")}.` : ""}</small>
                <ConfirmAction label="Alterar a série" tone="neutral" action={seriesAction} submit="Alterar série" warn="Horários já realizados não mudam. Se um horário novo estiver ocupado, nada é alterado.">
                  <input type="hidden" name="id" value={a.id} /><input type="hidden" name="op" value="alterar" />
                  <div className="fields">
                    <Field label="Aplicar a"><select name="scope"><option value="seguintes">Este e os seguintes</option><option value="todas">Todos os futuros</option></select></Field>
                    <Field label="Nova data deste"><input type="date" name="date" defaultValue={ymd} required /></Field>
                    <Field label="Novo horário"><input type="time" name="time" step={900} defaultValue={fmtTime(a.starts_at)} required /></Field>
                    {can(ctx, "agenda.manage") ? <Field label="Profissional"><select name="staffId" defaultValue={a.staff_id}>{cat.staff.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field> : null}
                  </div>
                </ConfirmAction>
                {can(ctx, "agenda.cancel") ? <ConfirmAction label="Cancelar a série" action={seriesAction} submit="Cancelar série">
                  <input type="hidden" name="id" value={a.id} /><input type="hidden" name="op" value="cancelar" />
                  <Field label="Cancelar"><select name="scope"><option value="seguintes">Este e os seguintes</option><option value="todas">Todos os futuros</option></select></Field>
                  <Field label="Motivo"><input name="reason" minLength={3} required /></Field>
                </ConfirmAction> : null}
              </>
            ) : null}
            <ConfirmAction label="Cliente não compareceu" action={noShowAction} submit="Confirmar ausência" warn="Só é possível depois do horário marcado. Dependendo da configuração, pode gerar cobrança de taxa.">
              <input type="hidden" name="id" value={a.id} />
            </ConfirmAction>
            <ConfirmAction label={series ? "Cancelar só este" : "Cancelar agendamento"} action={cancelAppointmentAction} submit="Cancelar agendamento" warn="O horário será liberado. Informe o motivo.">
              <input type="hidden" name="id" value={a.id} />
              <Field label="Motivo do cancelamento"><input name="reason" minLength={3} required /></Field>
            </ConfirmAction>
          </section>
        ) : null}
      </div>
    </>
  );
}
