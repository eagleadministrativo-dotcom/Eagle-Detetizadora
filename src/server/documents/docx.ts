import fs from "node:fs";
import path from "node:path";
import { AlignmentType, BorderStyle, Document, ImageRun, Packer, Paragraph, TabStopType, TextRun, type IRunOptions } from "docx";
import { CLIENT_SITUATION_LABEL, type QuoteRow, type ServiceOrderRow } from "../services/eagle";
import type { DocSettings } from "@/components/documents";
import { docDateWithWeekday, docLongDate, docMoney, docPhone } from "@/lib/doc-format";

const FONT = "Arial";
const RED = "E00000";
const brand = (file: string) => fs.readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "brand", file));

type Run = Omit<IRunOptions, "text"> & { text: string };
/** Texto com quebras de linha vira várias "runs" com quebra, mantendo a formatação. */
function runs(r: Run): TextRun[] {
  return r.text.split("\n").map((line, i) => new TextRun({ font: FONT, size: 24, ...r, text: line, break: i > 0 ? 1 : undefined }));
}
const p = (children: TextRun[] | ImageRun[], opts: { after?: number; before?: number; center?: boolean; tabs?: number[]; rule?: boolean } = {}) =>
  new Paragraph({
    children,
    alignment: opts.center ? AlignmentType.CENTER : undefined,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 60 },
    tabStops: opts.tabs?.map((position) => ({ type: TabStopType.LEFT, position })),
    border: opts.rule ? { bottom: { style: BorderStyle.SINGLE, size: 12, color: "000000", space: 4 } } : undefined,
  });

export async function orderDocx(o: ServiceOrderRow): Promise<Buffer> {
  const mark = (k: string) => (o.client_situation === k ? "(x)" : "( )");
  const small = { size: 21, bold: true } as const;
  const doc = new Document({
    creator: "Eagle Controle de Pragas",
    title: `Ordem de serviço ${o.number}`,
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 } } },
      children: [
        p([new ImageRun({ type: "png", data: brand("logo-os.png"), transformation: { width: 80, height: 80 } })], { center: true }),
        p(runs({ text: `ORDEM DE SERVIÇO: Nº ${o.number}`, bold: true }), { center: true, after: 360 }),
        p([...runs({ text: `CLIENTE: ${o.trade_name || o.customer_name}`, bold: true }), ...runs({ text: "\tFONE: ", bold: true }), ...runs({ text: `${docPhone(o.customer_phone)}${o.contact_name ? ` ${o.contact_name}` : ""}`, ...small })], { tabs: [5200] }),
        p([...runs({ text: `DATA: ${docDateWithWeekday(o.service_date)}`, bold: true, highlight: "yellow" }), ...runs({ text: "\t" }), ...runs({ text: `HORÁRIO: ${o.service_time ? `${o.service_time}hs` : ""}`, bold: true, highlight: "yellow" })], { tabs: [5200], after: 360 }),
        p(runs({ text: "SERVIÇOS:", bold: true })),
        p([...runs({ text: "- ", bold: true }), ...runs({ text: o.services || "", bold: true, highlight: "yellow" })], { after: 360 }),
        p(runs({ text: "DADOS DO CLIENTE:", bold: true })),
        p(runs({ text: `Razão Social: ${o.legal_name ?? ""}`, bold: true })),
        p(runs({ text: `Fantasia: ${o.trade_name ?? ""}`, bold: true })),
        p(runs({ text: `CNPJ/CPF: ${o.document ?? ""}`, ...small })),
        p([...runs({ text: "Endereço/Completo", bold: true }), ...runs({ text: `: ${o.service_address ?? ""}`, ...small })]),
        p(runs({ text: `Cep. ${o.cep ?? ""}`, ...small }), { after: 240 }),
        p(runs({ text: `VALOR ${docMoney(o.total_cents)}`, bold: true, color: RED, size: 28 }), { after: 200 }),
        p([...runs({ text: "FORMA DE PAGAMENTO: ", ...small, color: RED }), ...runs({ text: o.payment_method ?? "", ...small }), ...runs({ text: `\tBanco: ${o.bank ?? ""}`, ...small })], { tabs: [6200], rule: true, after: 300 }),
        p(runs({ text: "Observações gerais:", bold: true, highlight: "yellow" })),
        p(runs({ text: o.notes ?? "" }), { after: 1600 }),
        p([...runs({ text: "Laudo: ", bold: true, color: RED }), ...runs({ text: o.report_months != null ? `${o.report_months}/meses` : "", bold: true })], { after: 200 }),
        p([...runs({ text: "Situação do Cliente: ", bold: true, color: RED }), ...runs({ text: `${mark("novo")} ${CLIENT_SITUATION_LABEL.novo}   ${mark("retorno")} Retorno   ${mark("indicacao")} Indicação   ${mark("repasse")} Repasse`, bold: true })], { after: 400 }),
        ...[`Data Fechamento serviço: ${o.closing_ref ?? ""}`, `Nº NF: ${o.nf_number ?? ""}`, `Nº recibo: ${o.receipt_number ?? ""}`, `Boleto: ${o.boleto ?? ""}`].map((t) => p(runs({ text: t, size: 19, bold: true }), { after: 200 })),
        p(runs({ text: `Serviço Confirmado Data: ${o.confirmed_on ?? ""}\tResp. Conf. Cliente: ${o.confirmed_by_customer ?? ""}\tResp. Eagle: ${o.confirmed_by_eagle ?? ""}`, size: 19, bold: true }), { tabs: [3600, 7000] }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

export async function quoteDocx(q: QuoteRow, s: DocSettings, items: { description: string; quantity: number }[]): Promise<Buffer> {
  const services = q.services_text || items.map((i) => `${i.description}${i.quantity !== 1 ? ` (${i.quantity.toLocaleString("pt-BR")}x)` : ""}`).join("\n");
  const block = (label: string, text: string | null | undefined) => (text ? [p(runs({ text: label, bold: true })), p(runs({ text }), { after: 240 })] : []);
  const inline = (label: string, text: string | null | undefined) => (text ? [p([...runs({ text: `${label} `, bold: true }), ...runs({ text })], { after: 120 })] : []);
  const doc = new Document({
    creator: "Eagle Controle de Pragas",
    title: `Orçamento ${q.number}`,
    sections: [{
      properties: { page: { margin: { top: 800, bottom: 1000, left: 1100, right: 1100 } } },
      children: [
        p([new ImageRun({ type: "jpg", data: brand("cabecalho-orcamento.jpg"), transformation: { width: 600, height: 193 } })], { center: true, after: 200 }),
        p(runs({ text: `ORÇAMENTO: Nº ${q.number}`, bold: true }), { center: true, after: 300 }),
        p(runs({ text: `CLIENTE: ${q.customer_name}`, bold: true })),
        p(runs({ text: `FONE: ${docPhone(q.customer_phone)}${q.contact_name ? ` - ${q.contact_name}` : ""}`, bold: true }), { after: q.service_address ? 60 : 300 }),
        ...(q.service_address ? [p([...runs({ text: "LOCAL: ", bold: true }), ...runs({ text: q.service_address })], { after: 300 })] : []),
        ...block("SERVIÇOS A SEREM REALIZADOS:", services),
        ...block("FORMAS DE APLICAÇÃO:", q.application_text),
        ...block("DESCRIÇÃO DOS PRODUTOS:", q.products_text),
        p(runs({ text: `VALOR: ${docMoney(q.doc_value_cents)}`, bold: true }), { after: 120 }),
        ...inline("FORMAS DE PAGAMENTO:", q.payment_terms),
        ...inline("PRAZO DE EXECUÇÃO DOS SERVIÇOS:", q.execution_time),
        ...(q.validity_text ? [p(runs({ text: `VALIDADE DO ORÇAMENTO: ${q.validity_text}`, bold: true }), { before: 120, after: 240 })] : []),
        ...inline("Acompanha:", q.includes_text),
        ...inline("Agendamento:", q.scheduling_text),
        ...inline("Atenção:", q.attention_text),
        ...inline("Obs:", q.cancellation_text),
        ...(s.quote_closing ? [p(runs({ text: s.quote_closing }), { before: 240, after: 240 })] : []),
        p(runs({ text: `${q.signature_name ?? s.quote_signature_name ?? ""} ${q.signature_role ?? s.quote_signature_role ?? ""}`.trim() })),
        p(runs({ text: q.signature_phone ?? s.quote_signature_phone ?? "" }), { after: 300 }),
        p(runs({ text: `${q.city ?? s.quote_city ?? ""}, ${docLongDate(q.issue_date)}` })),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}
