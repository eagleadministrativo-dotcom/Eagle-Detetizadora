import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { CLIENT_SITUATION_LABEL, OS_PAYMENT_LABEL, RETURN_KIND_LABEL, RETURN_STATUS_LABEL, getServiceOrder, listOrderFiles } from "@/server/services/eagle";
import { waLink, orderMessage } from "@/lib/whatsapp";
import { PhotoUpload, SignaturePad } from "@/components/os-media";
import { listServices } from "@/server/services/catalog";
import { fmtYmd } from "@/lib/dates";
import { docPhone } from "@/lib/doc-format";
import { Badge, ConfirmAction, Field, Flash, PageHead } from "@/components/ui";
import { fmtBRL } from "@/lib/money";
import { OSPaymentBadge, OSStatusBadge } from "@/components/eagle-ui";
import { OrderFieldsForm } from "@/components/order-form";
import { cancelServiceOrderAction, deleteOrderFileAction, executeServiceOrderAction, setOrderPaymentAction, updateServiceOrderAction } from "@/app/actions/eagle";

export const metadata = { title: "Ordem de serviço" };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("agenda.manage", "agenda.view_all", "agenda.manage_own", "agenda.view_own");
  const db = await getDb();
  const o = await getServiceOrder(db, ctx, id).catch(() => null);
  if (!o) notFound();
  const [services, files, returns, [company]] = await Promise.all([
    listServices(db, ctx.unitId), listOrderFiles(db, ctx, id),
    db.query<{ id: string; kind: keyof typeof RETURN_KIND_LABEL; due_date: string; status: keyof typeof RETURN_STATUS_LABEL }>("select id, kind, to_char(due_date,'YYYY-MM-DD') as due_date, status from service_returns where service_order_id=$1 and unit_id=$2 order by due_date", [id, ctx.unitId]),
    db.query<{ name: string | null }>("select company_name as name from unit_settings where unit_id=$1", [ctx.unitId]),
  ]);
  const photos = files.filter((f) => f.kind === "foto");
  const signature = files.find((f) => f.kind === "assinatura");
  const wa = waLink(o.customer_phone, orderMessage(o, company?.name || "Eagle Controle de Pragas"));
  const office = can(ctx, "agenda.manage");
  const mine = office || (can(ctx, "agenda.manage_own") && !!o.staff_id && ctx.staffId === o.staff_id);
  const editable = mine && (o.status === "aberta" || (o.status === "executada" && office));
  const canPay = (can(ctx, "finance.manage") || office) && o.status !== "cancelada" && o.payment_status !== "pago";
  const info = (label: string, value: string | null | undefined) => (value ? <div><small>{label}</small><br /><span style={{ whiteSpace: "pre-line" }}>{value}</span></div> : null);

  return (
    <>
      <PageHead title={`OS nº ${o.number}`} sub={<>{o.trade_name || o.customer_name}{o.service_date ? ` · ${fmtYmd(o.service_date)}` : ""}{o.service_time ? ` às ${o.service_time}` : ""}{o.staff_name ? ` · ${o.staff_name}` : ""}</>}>
        <OSStatusBadge s={o.status} />
        {o.status !== "cancelada" ? <OSPaymentBadge s={o.payment_status} /> : null}
        <Link className="btn accent" href={`/documento/os/${o.id}`}>Ver documento / PDF</Link>
        {o.status === "executada" ? <Link className="btn" href={`/documento/certificado/${o.id}`}>Certificado de execução</Link> : null}
        {wa ? <a className="btn ghost" href={wa} target="_blank" rel="noopener noreferrer">Enviar no WhatsApp</a> : null}
        <a className="btn ghost" href={`/api/documento/os/${o.id}`}>Baixar Word</a>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid asym">
        <section className="card stack">
          {editable ? (
            <form action={updateServiceOrderAction} className="form">
              <input type="hidden" name="id" value={o.id} />
              <OrderFieldsForm o={o} services={services} />
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
                <small>Salve antes de concluir. Com garantia, o retorno de garantia é criado sozinho (contado da data do serviço); com laudo, entra o lembrete de renovação. O agendamento fica concluído. Depois de concluída, só o escritório altera (NF, recibo, boleto).</small>
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
      {returns.length ? (
        <section className="card stack">
          <h2>Retornos desta OS</h2>
          {returns.map((r) => <div key={r.id} className="row"><Link href={`/retornos/${r.id}`}>{RETURN_KIND_LABEL[r.kind]} em {fmtYmd(r.due_date)}</Link><Badge>{RETURN_STATUS_LABEL[r.status]}</Badge></div>)}
        </section>
      ) : null}
      <div className="grid cols-2">
        <section className="card stack">
          <h2>Fotos do serviço</h2>
          {photos.length ? (
            <div className="photos">
              {photos.map((f) => (
                <figure key={f.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <a href={`/api/os-imagem/${f.id}`} target="_blank" rel="noopener noreferrer"><img src={`/api/os-imagem/${f.id}`} alt={f.name} loading="lazy" /></a>
                  <figcaption><span>{f.name.replace(/\.(jpg|png|webp)$/, "")}</span>
                    {mine ? <ConfirmAction label="Excluir" action={deleteOrderFileAction} submit="Excluir foto"><input type="hidden" name="fileId" value={f.id} /><input type="hidden" name="orderId" value={o.id} /></ConfirmAction> : null}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : <small className="muted">Nenhuma foto ainda. Tire fotos de antes e depois: ficam na OS e na ficha do cliente.</small>}
          {mine && o.status !== "cancelada" ? <PhotoUpload orderId={o.id} /> : null}
        </section>
        <section className="card stack">
          <h2>Assinatura do cliente</h2>
          {signature ? (
            <div className="stack">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="sigimg" src={`/api/os-imagem/${signature.id}`} alt="Assinatura do cliente" />
              <small>{o.confirmed_by_customer ? `Assinado por ${o.confirmed_by_customer}` : "Assinado"}{o.confirmed_on ? ` em ${o.confirmed_on}` : ""}. A assinatura aparece no documento da OS.</small>
            </div>
          ) : <small className="muted">Peça para o cliente assinar com o dedo na tela ao terminar o serviço.</small>}
          {mine && o.status !== "cancelada" ? (signature ? <details className="confirm neutral"><summary>Assinar de novo</summary><SignaturePad orderId={o.id} signer={o.confirmed_by_customer} /></details> : <SignaturePad orderId={o.id} signer={o.confirmed_by_customer ?? o.contact_name} />) : null}
        </section>
      </div>
      {canPay ? (
        <section className="card stack">
          <h2>Pagamento</h2>
          <p>Situação: <b>{OS_PAYMENT_LABEL[o.payment_status]}</b> · {fmtBRL(o.total_cents)}{o.status === "executada" ? " · aparece em Financeiro → A receber até ser marcada como paga." : ""}</p>
          <form action={setOrderPaymentAction} className="row">
            <input type="hidden" name="id" value={o.id} /><input type="hidden" name="status" value="pago" />
            <select name="method" defaultValue={o.payment_method ?? ""} aria-label="Forma de pagamento"><option value="">Forma de pagamento…</option>{["Pix", "Dinheiro", "Boleto", "Cartão", "Transferência"].map((x) => <option key={x} value={x}>{x}</option>)}</select>
            <button className="btn accent" type="submit">Marcar como pago</button>
          </form>
        </section>
      ) : null}
    </>
  );
}
