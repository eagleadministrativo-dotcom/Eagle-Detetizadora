import zlib from "node:zlib";
import { DomainError } from "../errors";
import { parseBRL } from "@/lib/money";

// ───────── texto de arquivos .docx e .pdf ─────────

/** Lê um arquivo de dentro de um .zip (o .docx é um zip) sem biblioteca: diretório central + inflate. */
function unzipEntry(buf: Buffer, wanted: string): Buffer | null {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (name === wanted) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const XML_ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function docxText(buf: Buffer): string {
  const xml = unzipEntry(buf, "word/document.xml");
  if (!xml) throw new DomainError("invalid_file", "Não consegui ler este arquivo do Word. Salve como .docx e tente de novo.");
  return xml.toString("utf8")
    .replace(/<w:drawing>[\s\S]*?<\/w:drawing>|<w:pict>[\s\S]*?<\/w:pict>|<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, "")
    .replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<\/w:tc>/g, "  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(parseInt(e[1] === "x" ? e.slice(2) : e.slice(1), e[1] === "x" ? 16 : 10)) : XML_ENT[e] ?? m));
}

async function pdfText(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: false });
    return (Array.isArray(text) ? text : [text]).join("\n");
  } catch {
    throw new DomainError("invalid_file", "Não consegui ler este PDF. Se ele for uma foto escaneada, envie a versão em Word.");
  }
}

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export function fileKind(name: string, mime: string): "docx" | "pdf" | null {
  const n = name.toLowerCase();
  if (n.endsWith(".docx") || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (n.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  return null;
}

export async function extractDocumentText(name: string, mime: string, buf: Buffer): Promise<string> {
  const kind = fileKind(name, mime);
  if (!kind) throw new DomainError("invalid_file", "Envie um arquivo .docx (Word) ou .pdf.");
  if (buf.length > IMPORT_MAX_BYTES) throw new DomainError("too_big", "O arquivo passa de 5 MB.");
  const text = kind === "docx" ? docxText(buf) : await pdfText(buf);
  if (!text.trim()) throw new DomainError("invalid_file", "O arquivo não tem texto para ler. Se for uma foto escaneada, envie a versão em Word.");
  return text;
}

// ───────── campos pelos rótulos do modelo ─────────

/** Texto sem acento e minúsculo, com o índice de cada caractere no original (para recortar o valor com acentos). */
function normalize(text: string) {
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (c === "º" || c === "°") c = "o";
    const n = c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const ch of n) { norm += ch; map.push(i); }
  }
  map.push(text.length);
  return { norm, map };
}

type Label = { key: string; alts: string[] };
/** Procura os rótulos na ordem do modelo; o valor de cada um é o texto até o próximo rótulo encontrado. */
export function readLabels(text: string, labels: Label[]): Record<string, string> {
  const { norm, map } = normalize(text);
  const found: { key: string; start: number; end: number }[] = [];
  let cursor = 0;
  for (const l of labels) {
    let best: { start: number; end: number } | null = null;
    for (const alt of l.alts) {
      const at = norm.indexOf(alt, cursor);
      if (at >= 0 && (!best || at < best.start)) best = { start: at, end: at + alt.length };
    }
    if (best) { found.push({ key: l.key, ...best }); cursor = best.end; }
  }
  const out: Record<string, string> = {};
  for (let i = 0; i < found.length; i++) {
    const from = map[found[i].end];
    const to = i + 1 < found.length ? map[found[i + 1].start] : text.length;
    out[found[i].key] = text.slice(from, to).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/^[\s:.\-–_]+|[\s_]+$/g, "").trim();
  }
  return out;
}

const L = (key: string, ...alts: string[]): Label => ({ key, alts });
const clean = (v: string | undefined) => (v && v.replace(/_{3,}/g, "").trim()) || null;

export function parseDateBR(v: string | null | undefined): string | null {
  const m = v?.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const mo = Number(m[2]), d = Number(m[1]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const parseTime = (v: string | null | undefined) => {
  const m = v?.match(/(\d{1,2})[:h](\d{2})/i);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
};
const parseMoney = (v: string | null | undefined) => {
  const m = v?.match(/\d[\d.]*,\d{2}|\d[\d.]*/);
  return m ? parseBRL(m[0]) : null;
};
export function splitPhone(v: string | null | undefined): { phone: string | null; contact: string | null } {
  if (!v) return { phone: null, contact: null };
  const m = v.match(/\(?\d{2}\)?[\s.-]*\d{4,5}[\s.-]*\d{4}/);
  const phone = m ? m[0].replace(/\D/g, "") : null;
  const contact = (m ? v.replace(m[0], "") : v).replace(/^[\s\-–]+|[\s\-–]+$/g, "").trim() || null;
  return { phone, contact };
}

export interface ParsedOrder {
  customerName: string | null; phone: string | null; contact: string | null; serviceDate: string | null; serviceTime: string | null; servicesText: string | null;
  legalName: string | null; tradeName: string | null; document: string | null; address: string | null; cep: string | null;
  valueCents: number | null; paymentMethod: string | null; bank: string | null; notes: string | null; reportMonths: number | null;
  clientSituation: "novo" | "retorno" | "indicacao" | "repasse" | null; closingRef: string | null; nfNumber: string | null; receiptNumber: string | null;
  boleto: string | null; confirmedOn: string | null; confirmedByCustomer: string | null; confirmedByEagle: string | null;
}

export function parseOrderText(text: string): ParsedOrder {
  const f = readLabels(text, [
    L("cliente", "cliente:"), L("fone", "fone:", "telefone:"), L("data", "data:"), L("horario", "horario:", "hora:"), L("servicos", "servicos:"),
    L("dados", "dados do cliente:"), L("razao", "razao social:"), L("fantasia", "fantasia:"), L("doc", "cnpj/cpf:", "cnpj:", "cpf:"),
    L("endereco", "endereco/completo:", "endereco completo:", "endereco:"), L("cep", "cep"), L("valor", "valor r$", "valor:"),
    L("pagamento", "forma de pagamento:", "formas de pagamento:"), L("banco", "banco:"), L("obs", "observacoes gerais:", "observacoes:"),
    L("laudo", "laudo:"), L("situacao", "situacao do cliente:"), L("fechamento", "data fechamento servico:", "data de fechamento:", "fechamento:"),
    L("nf", "no nf:", "n. nf:", "nf:"), L("recibo", "no recibo:", "recibo:"), L("boleto", "boleto:"),
    L("confirmado", "servico confirmado data:", "servico confirmado:"), L("respCliente", "resp. conf. cliente:", "resp. cliente:"), L("respEagle", "resp. eagle:"),
  ]);
  const { phone, contact } = splitPhone(f.fone);
  const sit = f.situacao?.match(/\(\s*x\s*\)\s*(cl\.?\s*novo|novo|retorno|indica|repasse)/i)?.[1].toLowerCase() ?? null;
  const laudo = f.laudo?.match(/\d+/)?.[0];
  return {
    customerName: clean(f.cliente), phone, contact, serviceDate: parseDateBR(f.data), serviceTime: parseTime(f.horario),
    servicesText: clean(f.servicos)?.replace(/^-\s*/, "") ?? null,
    legalName: clean(f.razao), tradeName: clean(f.fantasia), document: clean(f.doc), address: clean(f.endereco),
    cep: clean(f.cep)?.match(/\d{5}-?\d{3}/)?.[0] ?? null,
    valueCents: parseMoney(f.valor), paymentMethod: clean(f.pagamento), bank: clean(f.banco), notes: clean(f.obs),
    reportMonths: laudo ? Math.min(60, Number(laudo)) : null,
    clientSituation: !sit ? null : sit.includes("novo") ? "novo" : sit.startsWith("retorno") ? "retorno" : sit.startsWith("indica") ? "indicacao" : "repasse",
    closingRef: clean(f.fechamento), nfNumber: clean(f.nf), receiptNumber: clean(f.recibo), boleto: clean(f.boleto),
    confirmedOn: clean(f.confirmado), confirmedByCustomer: clean(f.respCliente), confirmedByEagle: clean(f.respEagle),
  };
}

export interface ParsedQuote {
  customerName: string | null; phone: string | null; contact: string | null; servicesText: string | null; applicationText: string | null; productsText: string | null;
  valueCents: number | null; paymentTerms: string | null; executionTime: string | null; validityText: string | null; includesText: string | null;
  schedulingText: string | null; attentionText: string | null; cancellationText: string | null; city: string | null; issueDate: string | null;
}

const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function parseQuoteText(text: string): ParsedQuote {
  const f = readLabels(text, [
    L("cliente", "cliente:"), L("fone", "fone:", "telefone:"), L("servicos", "servicos a serem realizados:", "servicos:"),
    L("aplicacao", "formas de aplicacao:", "forma de aplicacao:"), L("produtos", "descricao dos produtos:"), L("valor", "valor:", "valor r$"),
    L("pagamento", "formas de pagamento:", "forma de pagamento:"), L("prazo", "prazo de execucao dos servicos:", "prazo de execucao:"),
    L("validade", "validade do orcamento:", "validade:"), L("acompanha", "acompanha:"), L("agendamento", "agendamento:"), L("atencao", "atencao:"),
    L("obs", "obs:"), L("fim", "eagle dedetizadora, controle", "eagle detetizadora, controle", "teremos satisfacao"),
  ]);
  const { phone, contact } = splitPhone(f.fone);
  const { norm, map } = normalize(text);
  const dm = /([a-z ]+),\s*(\d{1,2}) de ([a-z]+) de (\d{4})/g;
  let last: RegExpExecArray | null = null;
  for (let m = dm.exec(norm); m; m = dm.exec(norm)) last = m;
  let city: string | null = null, issueDate: string | null = null;
  if (last && MONTHS.includes(last[3])) {
    const cityStart = map[last.index], cityEnd = map[last.index + last[1].length];
    city = text.slice(cityStart, cityEnd).trim().split("\n").pop()!.trim() || null;
    issueDate = `${last[4]}-${String(MONTHS.indexOf(last[3]) + 1).padStart(2, "0")}-${last[2].padStart(2, "0")}`;
  }
  return {
    customerName: clean(f.cliente), phone, contact, servicesText: clean(f.servicos), applicationText: clean(f.aplicacao), productsText: clean(f.produtos),
    valueCents: parseMoney(f.valor), paymentTerms: clean(f.pagamento), executionTime: clean(f.prazo), validityText: clean(f.validade),
    includesText: clean(f.acompanha), schedulingText: clean(f.agendamento), attentionText: clean(f.atencao), cancellationText: clean(f.obs), city, issueDate,
  };
}
