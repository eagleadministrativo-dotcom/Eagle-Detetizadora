import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requireSession } from "@/server/session";
import { getSettings } from "@/server/core";
import { certificateSettings, getServiceOrder, listOrderFiles } from "@/server/services/eagle";
import { type DocSettings } from "@/components/documents";
import { PrintButton } from "@/components/client";
import { addMonths } from "@/lib/dates";
import { docLongDate, docPhone } from "@/lib/doc-format";

export const metadata = { title: "Certificado de execução" };

const ymd = (s: string | null | undefined) => (s ? s.split("-").reverse().join("/") : "");

/**
 * Certificado de execução de serviço de controle de vetores e pragas, gerado da OS concluída: cliente, endereço,
 * data, pragas, produtos, áreas, validade (laudo) e responsável técnico (Configurações).
 */
export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireSession();
  const db = await getDb();
  const o = await getServiceOrder(db, ctx, id).catch(() => null);
  if (!o) notFound();
  const [s, cert, files] = await Promise.all([getSettings(db.query, ctx.unitId) as unknown as Promise<DocSettings & { company_address?: string | null }>, certificateSettings(db, ctx.unitId), listOrderFiles(db, ctx, id)]);
  const sig = files.find((f) => f.kind === "assinatura");
  const validUntil = o.service_date && o.report_months ? addMonths(o.service_date, o.report_months) : null;
  const row = (label: string, value: string | null | undefined) => <tr><th>{label}</th><td style={{ whiteSpace: "pre-line" }}>{value || "—"}</td></tr>;
  return (
    <main className="docpage">
      <div className="toolbar">
        <Link className="btn ghost" href={`/os/${o.id}`}>← Voltar à OS</Link>
        <span className="grow" />
        <PrintButton label="Imprimir / salvar PDF" />
      </div>
      {o.status !== "executada" ? <div className="alert warn" style={{ maxWidth: 794, margin: "0 auto 12px" }}>Esta OS ainda não foi concluída. O certificado vale depois do serviço executado.</div> : null}
      {!cert.cert_responsible ? <div className="alert warn" style={{ maxWidth: 794, margin: "0 auto 12px" }}>Falta o responsável técnico. Preencha em Configurações → Certificado de execução.</div> : null}
      <article className="paper cert">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-os.png" alt={s.company_name ?? "Eagle Controle de Pragas"} className="doc-logo" />
        <p className="center"><b>{s.company_name ?? "Eagle Controle de Pragas"}</b></p>
        <p className="center small">{[s.company_cnpj ? `CNPJ ${s.company_cnpj}` : null, s.company_address, s.company_phone ? docPhone(s.company_phone) : null].filter(Boolean).join(" · ")}</p>
        {cert.cert_license ? <p className="center small">Licença sanitária: {cert.cert_license}</p> : null}
        <p className="title">CERTIFICADO DE EXECUÇÃO DE SERVIÇO<br />Controle de vetores e pragas urbanas</p>
        <p>Certificamos que foi executado o serviço descrito abaixo, conforme a Ordem de Serviço nº {o.number}.</p>
        <table className="cert-table">
          <tbody>
            {row("Cliente", o.legal_name || o.customer_name)}
            {o.trade_name && o.trade_name !== (o.legal_name || o.customer_name) ? row("Nome fantasia", o.trade_name) : null}
            {row("CNPJ/CPF", o.document)}
            {row("Endereço do serviço", [o.service_address, o.cep ? `CEP ${o.cep}` : null].filter(Boolean).join(" · "))}
            {row("Data do serviço", `${ymd(o.service_date)}${o.service_time ? ` às ${o.service_time}` : ""}`)}
            {row("Serviços executados", o.services)}
            {row("Pragas alvo", o.pests)}
            {row("Áreas tratadas", o.areas)}
            {row("Produtos utilizados", o.products_used)}
            {row("Técnico aplicador", o.staff_name)}
            {row("Garantia", o.warranty_days ? `${o.warranty_days} dias` : null)}
            {row("Validade do certificado", validUntil ? `${ymd(validUntil)} (${o.report_months} meses)` : null)}
          </tbody>
        </table>
        {cert.cert_notes ? <p className="gap-s small" style={{ whiteSpace: "pre-line" }}>{cert.cert_notes}</p> : null}
        <p className="gap">{s.quote_city ? `${s.quote_city}, ` : ""}{docLongDate(o.service_date ?? new Date().toISOString().slice(0, 10))}.</p>
        <div className="cert-signs">
          <div><span className="line" />{cert.cert_responsible || "Responsável técnico"}<br /><small>Responsável técnico{cert.cert_registration ? ` · ${cert.cert_registration}` : ""}</small></div>
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {sig ? <img src={`/api/os-imagem/${sig.id}`} alt="Assinatura do cliente" /> : null}
            <span className="line" />{o.confirmed_by_customer || o.contact_name || "Cliente"}<br /><small>Cliente</small>
          </div>
        </div>
      </article>
    </main>
  );
}
