import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can, getSettings } from "@/server/core";
import { getServiceOrder, OS_PAYMENT_LABEL } from "@/server/services/eagle";
import { fmtDateTime } from "@/lib/dates";
import { ConfirmAction, Field, Flash, PageHead, money } from "@/components/ui";
import { OSPaymentBadge, OSStatusBadge } from "@/components/eagle-ui";
import { PrintButton } from "@/components/client";
import { cancelServiceOrderAction, executeServiceOrderAction, updateServiceOrderAction } from "@/app/actions/eagle";

export const metadata = { title: "Ordem de serviço" };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("agenda.manage", "agenda.view_all", "agenda.manage_own", "agenda.view_own");
  const db = await getDb();
  const o = await getServiceOrder(db, ctx, id).catch(() => null);
  if (!o) notFound();
  const company = (await getSettings(db.query, ctx.unitId)) as unknown as { company_name?: string | null; company_cnpj?: string | null; company_phone?: string | null };
  const editable = o.status === "aberta" && (can(ctx, "agenda.manage") || (can(ctx, "agenda.manage_own") && ctx.staffId === o.staff_id));
  const line = (label: string, value: string | null) => (value ? <div><small>{label}</small><br /><span style={{ whiteSpace: "pre-line" }}>{value}</span></div> : null);

  return (
    <>
      <PageHead title={`OS nº ${o.number}`} sub={<>{o.customer_name} · {fmtDateTime(o.starts_at)} · {o.staff_name}</>}>
        <OSStatusBadge s={o.status} />
        {o.status !== "cancelada" ? <OSPaymentBadge s={o.payment_status} /> : null}
        <PrintButton />
        <Link className="btn ghost" href={`/agenda/${o.appointment_id}`}>Ver agendamento</Link>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid cols-2">
        <section className="card stack">
          <h2>{company.company_name || "Eagle Detetizadora"}</h2>
          {company.company_cnpj || company.company_phone ? <small>{[company.company_cnpj ? `CNPJ ${company.company_cnpj}` : null, company.company_phone].filter(Boolean).join(" · ")}</small> : null}
          <div><small>Cliente</small><br /><b>{o.customer_name}</b>{o.customer_phone ? ` · ${o.customer_phone}` : ""}</div>
          {line("Local do serviço", o.service_address)}
          <div><small>Data da visita</small><br />{fmtDateTime(o.starts_at)} · técnico {o.staff_name}</div>
          <div><small>Serviços</small><br />{o.services || "—"} · <b className="mono">{money(o.total_cents)}</b></div>
          {o.quote_id ? <div><small>Orçamento</small><br /><Link href={`/orcamentos/${o.quote_id}`}>nº {o.quote_number}</Link></div> : null}
          {line("Pragas encontradas", o.pests)}
          {line("Produtos utilizados", o.products_used)}
          {line("Áreas tratadas", o.areas)}
          {line("Forma de pagamento", o.payment_method)}
          <div><small>Garantia</small><br />{o.warranty_days ? `${o.warranty_days} dias` : "Sem garantia"}</div>
          {line("Observações", o.notes)}
          <div className="row"><span>{o.technician_confirmed ? "✓" : "✗"} Confirmado pelo técnico</span><span>{o.customer_confirmed ? "✓" : "✗"} Confirmado pelo cliente</span></div>
          <div className="row" style={{ marginTop: 24, gap: 40 }}>
            <div style={{ flex: 1, borderTop: "1px solid currentColor", paddingTop: 4 }}><small>Assinatura do técnico</small></div>
            <div style={{ flex: 1, borderTop: "1px solid currentColor", paddingTop: 4 }}><small>Assinatura do cliente</small></div>
          </div>
        </section>
        {editable ? (
          <section className="card stack noprint">
            <h2>Registro da visita</h2>
            <form action={updateServiceOrderAction} className="form">
              <input type="hidden" name="id" value={o.id} />
              <Field label="Pragas encontradas"><textarea name="pests" defaultValue={o.pests ?? ""} placeholder="Ex.: baratas (cozinha), formigas (quintal)" /></Field>
              <Field label="Produtos utilizados"><textarea name="productsUsed" defaultValue={o.products_used ?? ""} placeholder="Nome do produto, quantidade e lote" /></Field>
              <Field label="Áreas tratadas"><textarea name="areas" defaultValue={o.areas ?? ""} placeholder="Ex.: cozinha, banheiros, área externa" /></Field>
              <div className="fields">
                <Field label="Forma de pagamento"><input name="paymentMethod" defaultValue={o.payment_method ?? ""} placeholder="Pix, cartão, dinheiro…" /></Field>
                <Field label="Pagamento"><select name="paymentStatus" defaultValue={o.payment_status}>{Object.entries(OS_PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Garantia (dias)"><input name="warrantyDays" type="number" min={0} max={1095} defaultValue={o.warranty_days ?? ""} placeholder="0" /></Field>
              </div>
              <Field label="Observações"><textarea name="notes" defaultValue={o.notes ?? ""} placeholder="Orientações ao cliente, pendências" /></Field>
              <label className="check"><input type="checkbox" name="technicianConfirmed" defaultChecked={o.technician_confirmed} />Técnico confirma que o serviço foi executado</label>
              <label className="check"><input type="checkbox" name="customerConfirmed" defaultChecked={o.customer_confirmed} />Cliente confirmou o serviço</label>
              <div><button className="btn" type="submit">Salvar</button></div>
            </form>
            <form action={executeServiceOrderAction} className="stack">
              <input type="hidden" name="id" value={o.id} />
              <small>Ao concluir, a OS não muda mais. Com garantia, o retorno de garantia é criado sozinho para o mesmo técnico. Salve antes de concluir.</small>
              <div><button className="btn accent" type="submit">Concluir ordem de serviço</button></div>
            </form>
            {can(ctx, "agenda.manage") ? (
              <ConfirmAction label="Cancelar ordem de serviço" action={cancelServiceOrderAction} submit="Cancelar OS" warn="A OS fica registrada como cancelada, com o motivo.">
                <input type="hidden" name="id" value={o.id} />
                <Field label="Motivo"><input name="reason" minLength={3} required /></Field>
              </ConfirmAction>
            ) : null}
          </section>
        ) : null}
      </div>
    </>
  );
}
