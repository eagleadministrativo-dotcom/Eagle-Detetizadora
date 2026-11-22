import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listCatalog, listServices } from "@/server/services/catalog";
import { listCustomers } from "@/server/services/customers";
import { fmtBRL } from "@/lib/money";
import { todayYmd } from "@/lib/dates";
import { Empty, Field, Flash, PageHead, Seg } from "@/components/ui";
import { createAppointmentAction, createBlockAction, quickAttendanceAction } from "@/app/actions/agenda";

export const metadata = { title: "Novo agendamento" };
type SP = { d?: string; t?: string; s?: string; c?: string; cust?: string; svc?: string; imediato?: string; bloqueio?: string; ok?: string; erro?: string };

export default async function NewAppointment({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("agenda.manage", "agenda.manage_own", "agenda.block");
  const db = await getDb();
  const cat = await listCatalog(db, ctx.unitId);
  const services = await listServices(db, ctx.unitId);
  const customers = can(ctx, "customers.view") ? (await listCustomers(db, ctx, { limit: 500 })).rows : [];
  const mode = sp.bloqueio ? "bloqueio" : sp.imediato ? "imediato" : "agendar";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? "") ? sp.d! : todayYmd();
  const ownOnly = !can(ctx, "agenda.manage") && can(ctx, "agenda.manage_own");
  const staff = cat.staff.filter((s) => s.is_active && (!ownOnly || s.id === ctx.staffId));
  const chairs = cat.chairs.filter((c) => c.is_active);
  const canBook = can(ctx, "agenda.manage") || can(ctx, "agenda.manage_own");

  const customerFields = (
    <fieldset>
      <legend>Cliente</legend>
      <div className="fields">
        <Field label="Cliente cadastrado">
          <select name="customerId" defaultValue={sp.cust ?? ""}>
            <option value="">— escolher —</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
          </select>
        </Field>
        <Field label="…ou novo cliente (nome)"><input name="newName" placeholder="Nome" /></Field>
        <Field label="Telefone (opcional)"><input name="newPhone" inputMode="tel" placeholder="41 99999-0000" /></Field>
      </div>
    </fieldset>
  );
  const serviceFields = services.length === 0 ? <Empty title="Nenhum serviço cadastrado">Cadastre em Administração → Serviços e preços.</Empty> : (
    <fieldset>
      <legend>Serviços</legend>
      <div className="stack">
        {services.map((s) => (
          <label key={s.id} className="check">
            <input type="checkbox" name="services" value={s.id} disabled={s.price_cents == null} defaultChecked={(sp.svc ?? "").split(",").includes(s.id)} />
            <span>{s.name} <small>· {s.duration_minutes} min · {s.price_cents == null ? "sem preço cadastrado" : fmtBRL(s.price_cents)}</small></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
  const staffChair = (
    <div className="fields">
      <Field label="Profissional">
        <select name="staffId" defaultValue={sp.s ?? (ownOnly ? ctx.staffId ?? "" : "")} required>
          <option value="" disabled>— escolher —</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <Field label="Cadeira">
        <select name="chairId" defaultValue={sp.c ?? ""}>
          <option value="">Automática (primeira livre)</option>
          {chairs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
    </div>
  );

  return (
    <>
      <PageHead title={mode === "bloqueio" ? "Bloquear horário" : mode === "imediato" ? "Atendimento sem hora marcada" : "Novo agendamento"}>
        <Seg items={[
          { href: `/agenda/novo?d=${d}`, label: "Agendar", active: mode === "agendar" },
          { href: "/agenda/novo?imediato=1", label: "Sem hora marcada", active: mode === "imediato" },
          ...(can(ctx, "agenda.block") ? [{ href: `/agenda/novo?bloqueio=1&d=${d}`, label: "Bloquear", active: mode === "bloqueio" }] : []),
        ]} />
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />

      {mode === "agendar" && canBook ? (
        <form action={createAppointmentAction} className="card form">
          {customerFields}
          {serviceFields}
          {staffChair}
          <div className="fields">
            <Field label="Data"><input type="date" name="date" defaultValue={d} required /></Field>
            <Field label="Hora"><input type="time" name="time" step={900} defaultValue={sp.t ?? ""} required /></Field>
          </div>
          <Field label="Observações (opcional)"><textarea name="notes" /></Field>
          <small>O sistema impede conflito de cadeira e de profissional, respeita a escala e os bloqueios e calcula o término pela duração dos serviços.</small>
          <div className="sticky-actions"><button className="btn accent" type="submit">Confirmar agendamento</button></div>
        </form>
      ) : null}

      {mode === "imediato" && canBook ? (
        <form action={quickAttendanceAction} className="card form">
          <p className="muted">Para quem chegou sem agendar: cria o agendamento para agora e já inicia o atendimento.</p>
          {customerFields}
          {serviceFields}
          {staffChair}
          <div className="sticky-actions"><button className="btn accent" type="submit">Iniciar atendimento</button></div>
        </form>
      ) : null}

      {mode === "bloqueio" && can(ctx, "agenda.block") ? (
        <form action={createBlockAction} className="card form">
          <div className="fields">
            <Field label="Data"><input type="date" name="date" defaultValue={d} required /></Field>
            <Field label="De"><input type="time" name="from" step={900} required /></Field>
            <Field label="Até (mesma data)"><input type="time" name="to" step={900} required /></Field>
          </div>
          <div className="fields">
            <Field label="Cadeira (opcional)">
              <select name="chairId" defaultValue=""><option value="">Todas</option>{chairs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </Field>
            <Field label="Profissional (opcional)">
              <select name="staffId" defaultValue=""><option value="">Todos</option>{cat.staff.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </Field>
          </div>
          <Field label="Motivo"><input name="reason" placeholder="Ex.: almoço, manutenção, folga" required /></Field>
          <div className="sticky-actions"><button className="btn accent" type="submit">Bloquear</button></div>
        </form>
      ) : null}
    </>
  );
}
