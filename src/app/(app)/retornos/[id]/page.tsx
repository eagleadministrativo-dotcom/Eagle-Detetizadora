import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listCatalog } from "@/server/services/catalog";
import { getReturn } from "@/server/services/eagle";
import { fmtDateTime, fmtYmd, todayYmd } from "@/lib/dates";
import { Badge, ConfirmAction, Field, Flash, PageHead } from "@/components/ui";
import { ReturnKindBadge, ReturnStatusBadge } from "@/components/eagle-ui";
import { updateReturnAction } from "@/app/actions/eagle";

export const metadata = { title: "Retorno" };

export default async function ReturnPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("returns.own", "returns.view_all", "returns.manage");
  const db = await getDb();
  const r = await getReturn(db, ctx, id).catch(() => null);
  if (!r) notFound();
  const manager = can(ctx, "returns.manage");
  const canAct = manager || (can(ctx, "returns.contact") && r.staff_id === ctx.staffId);
  const open = r.status === "pendente" || r.status === "agendado";
  const late = open && r.due_date < todayYmd();
  const staff = manager ? (await listCatalog(db, ctx.unitId)).staff.filter((s) => s.is_active) : [];
  const status = (value: string, label: string, tone: "accent" | "" = "") => (
    <form action={updateReturnAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value={value} /><button className={`btn ${tone}`} type="submit">{label}</button></form>
  );

  return (
    <>
      <PageHead title={r.customer_name} sub={<>Retorno de {r.kind === "manutencao" ? "manutenção" : r.kind === "garantia" ? "garantia" : "outro motivo"} · previsto para {fmtYmd(r.due_date)}</>}>
        <ReturnStatusBadge s={r.status} />
        {late ? <Badge tone="bad">atrasado</Badge> : null}
        <Link className="btn ghost" href="/retornos">Voltar</Link>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid cols-2">
        <section className="card stack">
          <h2>Detalhes</h2>
          <div><small>Tipo</small><br /><ReturnKindBadge k={r.kind} /></div>
          <div><small>Data prevista</small><br />{fmtYmd(r.due_date)}</div>
          <div><small>Técnico</small><br />{r.staff_name ?? "Ainda não definido"}</div>
          {r.customer_phone ? <div><small>Telefone</small><br /><a href={`tel:${r.customer_phone.replace(/\D/g, "")}`}>{r.customer_phone}</a></div> : null}
          {r.customer_address ? <div><small>Endereço</small><br />{r.customer_address}</div> : null}
          {r.service_order_id ? <div><small>Origem</small><br /><Link href={`/os/${r.service_order_id}`}>Ordem de serviço nº {r.service_order_number}</Link></div> : null}
          {r.notes ? <div><small>Observações</small><br /><span style={{ whiteSpace: "pre-line" }}>{r.notes}</span></div> : null}
          <small>Criado em {fmtDateTime(r.created_at)} · atualizado em {fmtDateTime(r.updated_at)}</small>
          {can(ctx, "customers.view") ? <Link className="btn ghost" href={`/clientes/${r.customer_id}`}>Ver cliente</Link> : null}
        </section>
        {canAct ? (
          <section className="card stack">
            <h2>Ações</h2>
            {open && (can(ctx, "agenda.create") && (can(ctx, "agenda.manage") || can(ctx, "agenda.manage_own"))) ? (
              <Link className="btn accent" href={`/agenda/novo?cust=${r.customer_id}`}>Agendar a visita</Link>
            ) : null}
            <div className="row">
              {r.status === "pendente" ? status("agendado", "Marcar como agendado") : null}
              {open ? status("concluido", "Concluir retorno") : null}
              {!open ? status("pendente", "Reabrir") : null}
            </div>
            {open ? (
              <ConfirmAction label="Cancelar retorno" action={updateReturnAction} submit="Cancelar retorno" warn="O retorno sai da lista de abertos. Dá para reabrir depois.">
                <input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="cancelado" />
              </ConfirmAction>
            ) : null}
            <form action={updateReturnAction} className="form">
              <input type="hidden" name="id" value={r.id} />
              {manager ? (
                <div className="fields">
                  <Field label="Data prevista"><input type="date" name="dueDate" defaultValue={r.due_date} required /></Field>
                  <Field label="Técnico">
                    <select name="staffId" defaultValue={r.staff_id ?? ""}><option value="">— sem técnico —</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                  </Field>
                </div>
              ) : null}
              <Field label="Observações"><textarea name="notes" defaultValue={r.notes ?? ""} placeholder="Contato feito, combinado com o cliente…" /></Field>
              <div><button className="btn" type="submit">Salvar</button></div>
            </form>
          </section>
        ) : null}
      </div>
    </>
  );
}
