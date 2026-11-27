import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { CLIENT_SITUATION_LABEL, getServiceOrder } from "@/server/services/eagle";
import { fmtYmd } from "@/lib/dates";
import { docPhone } from "@/lib/doc-format";
import { ConfirmAction, Field, Flash, PageHead } from "@/components/ui";
import { fmtBRL } from "@/lib/money";
import { OSPaymentBadge, OSStatusBadge } from "@/components/eagle-ui";
import { OrderFieldsForm } from "@/components/order-form";
import { cancelServiceOrderAction, executeServiceOrderAction, updateServiceOrderAction } from "@/app/actions/eagle";

export const metadata = { title: "Ordem de serviço" };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("agenda.manage", "agenda.view_all", "agenda.manage_own", "agenda.view_own");
  const o = await getServiceOrder(await getDb(), ctx, id).catch(() => null);
  if (!o) notFound();
  const office = can(ctx, "agenda.manage");
  const mine = office || (can(ctx, "agenda.manage_own") && !!o.staff_id && ctx.staffId === o.staff_id);
  const editable = mine && (o.status === "aberta" || (o.status === "executada" && office));
  const info = (label: string, value: string | null | undefined) => (value ? <div><small>{label}</small><br /><span style={{ whiteSpace: "pre-line" }}>{value}</span></div> : null);

  return (
    <>
      <PageHead title={`OS nº ${o.number}`} sub={<>{o.trade_name || o.customer_name}{o.service_date ? ` · ${fmtYmd(o.service_date)}` : ""}{o.service_time ? ` às ${o.service_time}` : ""}{o.staff_name ? ` · ${o.staff_name}` : ""}</>}>
        <OSStatusBadge s={o.status} />
        {o.status !== "cancelada" ? <OSPaymentBadge s={o.payment_status} /> : null}
        <Link className="btn accent" href={`/documento/os/${o.id}`}>Ver documento / PDF</Link>
        <a className="btn ghost" href={`/api/documento/os/${o.id}`}>Baixar Word</a>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid asym">
        <section className="card stack">
          {editable ? (
            <form action={updateServiceOrderAction} className="form">
              <input type="hidden" name="id" value={o.id} />
              <OrderFieldsForm o={o} />
              <div><button className="btn accent" type="submit">Salvar</button></div>
            </form>
          ) : (
            <>
              <h2>Ordem de serviço</h2>
              {info("Serviços", o.services)}
              {info("Valor", fmtBRL(o.total_cents))}
              {info("Forma de pagamento", [o.payment_method, o.bank ? `Banco: ${o.bank}` : null].filter(Boolean).join(" · "))}
              {info("Observações gerais", o.notes)}
              {info("Laudo", o.report_months != null ? `${o.report_months} meses` : null)}
              {info("Situação do cliente", o.client_situation ? CLIENT_SITUATION_LABEL[o.client_situation] : null)}
              {info("Fechamento", [o.closing_ref, o.nf_number ? `NF ${o.nf_number}` : null, o.receipt_number ? `Recibo ${o.receipt_number}` : null, o.boleto ? `Boleto ${o.boleto}` : null].filter(Boolean).join(" · "))}
            </>
          )}
        </section>
        <section className="card stack">
          <h2>Cliente</h2>
          <div><b>{o.customer_name}</b>{o.customer_phone ? <><br /><small>{docPhone(o.customer_phone)}</small></> : null}</div>
          {info("Razão social", o.legal_name)}
          {info("Fantasia", o.trade_name)}
          {info("CNPJ/CPF", o.document)}
          {info("Endereço", [o.service_address, o.cep ? `CEP ${o.cep}` : null].filter(Boolean).join(" · "))}
          {!o.legal_name || !o.document || !o.service_address ? <small>Faltam dados do cliente para a OS? Complete na ficha.</small> : null}
          {can(ctx, "customers.view") ? <Link className="btn ghost" href={`/clientes/${o.customer_id}`}>Abrir ficha do cliente</Link> : null}
          {o.appointment_id ? <Link className="btn ghost" href={`/agenda/${o.appointment_id}`}>Ver agendamento</Link> : null}
          {o.quote_id ? <Link className="btn ghost" href={`/orcamentos/${o.quote_id}`}>Orçamento nº {o.quote_number}</Link> : null}
          {o.file_id ? <a className="btn ghost" href={`/api/arquivo/cliente/${o.file_id}`}>Arquivo original importado</a> : null}
          {mine && o.status === "aberta" ? (
            <>
              <h2>Concluir</h2>
              <form action={executeServiceOrderAction} className="stack">
                <input type="hidden" name="id" value={o.id} />
                <small>Salve antes de concluir. Com garantia, o retorno de garantia é criado sozinho. Depois de concluída, só o escritório altera (NF, recibo, boleto).</small>
                <div><button className="btn accent" type="submit">Concluir ordem de serviço</button></div>
              </form>
              {office ? (
                <ConfirmAction label="Cancelar ordem de serviço" action={cancelServiceOrderAction} submit="Cancelar OS" warn="A OS fica registrada como cancelada, com o motivo.">
                  <input type="hidden" name="id" value={o.id} />
                  <Field label="Motivo"><input name="reason" minLength={3} required /></Field>
                </ConfirmAction>
              ) : null}
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}
