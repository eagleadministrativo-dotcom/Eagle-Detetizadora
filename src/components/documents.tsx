import type { ReactNode } from "react";
import { CLIENT_SITUATION_LABEL, type QuoteRow, type ServiceOrderRow } from "@/server/services/eagle";
import { docDateWithWeekday, docLongDate, docMoney, docPhone } from "@/lib/doc-format";

export interface DocSettings {
  company_name?: string | null; company_cnpj?: string | null; company_phone?: string | null; company_email?: string | null; company_site?: string | null;
  quote_closing?: string | null; quote_signature_name?: string | null; quote_signature_role?: string | null; quote_signature_phone?: string | null; quote_city?: string | null;
}

const Lines = ({ text }: { text: string | null | undefined }) => <span style={{ whiteSpace: "pre-line" }}>{text ?? ""}</span>;
const B = ({ children }: { children: ReactNode }) => <b>{children}</b>;

/** Ordem de serviço no modelo da Eagle (A4). */
export function OrderDocument({ o }: { o: ServiceOrderRow }) {
  const mark = (k: string) => (o.client_situation === k ? "(x)" : "( )");
  return (
    <article className="paper os">
      <header className="center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-os.png" alt="Eagle Controle de Pragas" className="doc-logo" />
        <p className="title">ORDEM DE SERVIÇO: Nº {o.number}</p>
      </header>
      <section className="gap">
        <p><B>CLIENTE: {o.trade_name || o.customer_name}</B>&nbsp;&nbsp;&nbsp;&nbsp; <B>FONE: </B><span className="small-b">{docPhone(o.customer_phone)}</span></p>
        <p><span className="hl"><B>DATA: {docDateWithWeekday(o.service_date)}</B></span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="hl"><B>HORÁRIO: {o.service_time ? `${o.service_time}hs` : ""}</B></span></p>
      </section>
      <section className="gap">
        <p><B>SERVIÇOS:</B></p>
        <p><B>- </B><span className="hl"><B><Lines text={o.services} /></B></span></p>
      </section>
      <section className="gap">
        <p><B>DADOS DO CLIENTE:</B></p>
        <p><B>Razão Social: {o.legal_name ?? ""}</B></p>
        <p><B>Fantasia: {o.trade_name ?? ""}</B></p>
        <p className="small-b">CNPJ/CPF: {o.document ?? ""}</p>
        <p><B>Endereço/Completo</B><span className="small-b">: {o.service_address ?? ""}</span></p>
        <p className="small-b">Cep. {o.cep ?? ""}</p>
      </section>
      <p className="red big gap-s"><B>VALOR {docMoney(o.total_cents)}</B></p>
      <p className="small-b split"><span><span className="red">FORMA DE PAGAMENTO:</span> {o.payment_method ?? ""}</span><span>Banco: {o.bank ?? ""}</span></p>
      <hr className="rule" />
      <section className="obs">
        <p><span className="hl"><B>Observações gerais:</B></span></p>
        <p><Lines text={o.notes} /></p>
      </section>
      <p className="gap-s"><B><span className="red">Laudo:</span> {o.report_months != null ? `${o.report_months}/meses` : ""}</B></p>
      <p><B><span className="red">Situação do Cliente:</span> {mark("novo")} {CLIENT_SITUATION_LABEL.novo}&nbsp;&nbsp; {mark("retorno")} Retorno&nbsp;&nbsp; {mark("indicacao")} Indicação&nbsp;&nbsp; {mark("repasse")} Repasse</B></p>
      <section className="foot">
        <p>Data Fechamento serviço: {o.closing_ref ?? ""}</p>
        <p>Nº NF: {o.nf_number ?? ""}</p>
        <p>Nº recibo: {o.receipt_number ?? ""}</p>
        <p>Boleto: {o.boleto ?? ""}</p>
        <p className="split"><span>Serviço Confirmado Data: {o.confirmed_on ?? ""}</span><span>Resp. Conf. Cliente: {o.confirmed_by_customer ?? ""}</span><span>Resp. Eagle: {o.confirmed_by_eagle ?? ""}</span></p>
      </section>
    </article>
  );
}

/** Orçamento no modelo da Eagle (A4). */
export function QuoteDocument({ q, s, items }: { q: QuoteRow; s: DocSettings; items: { description: string; quantity: number; total_cents: number }[] }) {
  const services = q.services_text || items.map((i) => `${i.description}${i.quantity !== 1 ? ` (${i.quantity.toLocaleString("pt-BR")}x)` : ""}`).join("\n");
  const block = (label: string, text: string | null | undefined) => (text ? <section className="gap"><p><B>{label}</B></p><p><Lines text={text} /></p></section> : null);
  const inline = (label: string, text: string | null | undefined) => (text ? <p><B>{label}</B> <Lines text={text} /></p> : null);
  return (
    <article className="paper quote">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/cabecalho-orcamento.jpg" alt={s.company_name ?? "Eagle Controle de Pragas"} className="doc-banner" />
      <p className="title">ORÇAMENTO: Nº {q.number}</p>
      <section className="gap">
        <p><B>CLIENTE: {q.customer_name}</B></p>
        <p><B>FONE: {docPhone(q.customer_phone)}</B></p>
        {q.service_address ? <p><B>LOCAL: </B>{q.service_address}</p> : null}
      </section>
      {block("SERVIÇOS A SEREM REALIZADOS:", services)}
      {block("FORMAS DE APLICAÇÃO:", q.application_text)}
      {block("DESCRIÇÃO DOS PRODUTOS:", q.products_text)}
      <section className="gap">
        <p><B>VALOR: {docMoney(q.doc_value_cents)}</B></p>
        {inline("FORMAS DE PAGAMENTO:", q.payment_terms)}
        {inline("PRAZO DE EXECUÇÃO DOS SERVIÇOS:", q.execution_time)}
      </section>
      {q.validity_text ? <p className="gap-s"><B>VALIDADE DO ORÇAMENTO: {q.validity_text}</B></p> : null}
      <section className="gap">
        {inline("Acompanha:", q.includes_text)}
        {inline("Agendamento:", q.scheduling_text)}
        {inline("Atenção:", q.attention_text)}
        {inline("Obs:", q.cancellation_text)}
      </section>
      {s.quote_closing ? <section className="gap"><p><Lines text={s.quote_closing} /></p></section> : null}
      <section className="gap">
        <p>{q.signature_name ?? s.quote_signature_name ?? ""} {q.signature_role ?? s.quote_signature_role ?? ""}</p>
        <p>{q.signature_phone ?? s.quote_signature_phone ?? ""}</p>
      </section>
      <p className="gap">{q.city ?? s.quote_city ?? ""}, {docLongDate(q.issue_date)}</p>
    </article>
  );
}
