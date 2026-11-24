// Leitura de contatos para importação (CSV de outros sistemas e vCard .vcf do celular). Funções puras: rodam no navegador (prévia) e no servidor (revalidação).

export interface ImportRow { name: string; phone: string; email?: string; cpf?: string; birthdate?: string; notes?: string }
export interface ParseResult { rows: ImportRow[]; ignored: number; format: "csv" | "vcf" | "lista" }

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Telefone brasileiro só com dígitos (DDD + número, 10 ou 11). Remove +55. Retorna null se não for válido. */
export function normalizePhone(raw: string | null | undefined): string | null {
  let d = String(raw ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) return d;
  return null;
}

function normalizeDate(raw: string | undefined): string | undefined {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  let y = "", m = "", d = "";
  let r: RegExpMatchArray | null;
  if ((r = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/))) [, y, m, d] = r;
  else if ((r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [, d, m, y] = r;
  else return undefined;
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d || +y < 1900 || dt > new Date()) return undefined;
  return `${y}-${String(+m).padStart(2, "0")}-${String(+d).padStart(2, "0")}`;
}

/** Limpa e valida uma linha. Devolve null se faltar nome ou telefone válido. Também usada no servidor. */
export function cleanRow(r: Partial<ImportRow>): ImportRow | null {
  const name = String(r.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const phone = normalizePhone(r.phone);
  if (!name || !phone) return null;
  const email = String(r.email ?? "").trim().toLowerCase();
  const cpf = String(r.cpf ?? "").replace(/\D/g, "");
  const notes = String(r.notes ?? "").trim().slice(0, 500);
  return {
    name, phone,
    ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 120 ? { email } : {}),
    ...(cpf.length === 11 ? { cpf } : {}),
    ...(normalizeDate(r.birthdate) ? { birthdate: normalizeDate(r.birthdate) } : {}),
    ...(notes ? { notes } : {}),
  };
}

// ───────── CSV ─────────
function parseCsvText(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const first = t.split(/\r?\n/, 1)[0] ?? "";
  const delim = [";", "\t", ","].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const H_NAME = ["nome", "name", "nome completo", "full name", "display name", "cliente", "contato", "nome do cliente"];
const H_FIRST = ["first name", "given name", "primeiro nome"];
const H_MIDDLE = ["middle name", "additional name", "nome do meio"];
const H_LAST = ["last name", "family name", "sobrenome", "ultimo nome"];
const H_EMAIL = ["email", "e-mail", "e mail", "email address"];
const H_CPF = ["cpf"];
const H_BDAY = ["nascimento", "data de nascimento", "data nascimento", "aniversario", "birthday", "birthdate", "birth date", "dt nascimento", "dt. nascimento"];
const H_NOTES = ["observacoes", "observacao", "obs", "notes", "notas", "anotacoes"];
const isPhoneHeader = (h: string) => /(telefone|celular|fone|phone|mobile|whatsapp|whats|tel\b|contato principal)/.test(h) && !/(label|type|tipo)/.test(h);

function parseCsv(text: string): ParseResult {
  const table = parseCsvText(text);
  if (!table.length) return { rows: [], ignored: 0, format: "csv" };
  const head = table[0].map(strip);
  const idx = (names: string[]) => head.findIndex((h) => names.includes(h));
  const hasHeader = head.some((h) => [...H_NAME, ...H_FIRST, ...H_LAST].includes(h) || isPhoneHeader(h));
  const body = hasHeader ? table.slice(1) : table;
  const nameI = idx(H_NAME), firstI = idx(H_FIRST), midI = idx(H_MIDDLE), lastI = idx(H_LAST);
  const emailCols = head.map((h, i) => (H_EMAIL.includes(h) || /^e-?mail \d+ - value$/.test(h) ? i : -1)).filter((i) => i >= 0);
  const cpfI = idx(H_CPF), bdayI = idx(H_BDAY), notesI = idx(H_NOTES);
  const phoneCols = hasHeader ? head.map((h, i) => (isPhoneHeader(h) ? i : -1)).filter((i) => i >= 0) : [1];
  const rows: ImportRow[] = [];
  let ignored = 0;
  for (const cells of body) {
    const get = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
    const name = hasHeader
      ? get(nameI) || [get(firstI), get(midI), get(lastI)].filter(Boolean).join(" ")
      : get(0);
    let phone: string | null = null;
    for (const i of phoneCols) {
      for (const part of get(i).split(/:::|\s\/\s|;/)) { phone = normalizePhone(part); if (phone) break; }
      if (phone) break;
    }
    const email = emailCols.map(get).find(Boolean);
    const r = cleanRow({ name, phone: phone ?? "", email, cpf: get(cpfI), birthdate: get(bdayI), notes: get(notesI) });
    if (r) rows.push(r); else ignored++;
  }
  return { rows, ignored, format: "csv" };
}

// ───────── vCard ─────────
function qpDecode(s: string): string {
  const bytes: number[] = [];
  const t = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) { bytes.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...new TextEncoder().encode(t[i]));
  }
  return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
}
const unesc = (s: string) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");

function parseVcf(text: string): ParseResult {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/=\n/g, "").replace(/\n[ \t]/g, "").split("\n");
  const rows: ImportRow[] = [];
  let ignored = 0;
  let card: { fn?: string; n?: string; tels: string[]; email?: string; bday?: string; note?: string } | null = null;
  for (const line of lines) {
    const up = line.trim().toUpperCase();
    if (up === "BEGIN:VCARD") { card = { tels: [] }; continue; }
    if (up === "END:VCARD") {
      if (card) {
        const name = card.fn || card.n || "";
        let phone: string | null = null;
        for (const t of card.tels) { phone = normalizePhone(t); if (phone) break; }
        const r = cleanRow({ name, phone: phone ?? "", email: card.email, birthdate: card.bday, notes: card.note });
        if (r) rows.push(r); else ignored++;
      }
      card = null; continue;
    }
    if (!card) continue;
    const c = line.indexOf(":");
    if (c < 0) continue;
    const [rawKey, ...params] = line.slice(0, c).split(";");
    const key = rawKey.replace(/^.*\./, "").toUpperCase();
    let val = line.slice(c + 1);
    if (params.some((p) => /ENCODING=QUOTED-PRINTABLE/i.test(p) || /^QUOTED-PRINTABLE$/i.test(p))) val = qpDecode(val);
    val = unesc(val).trim();
    if (key === "FN") card.fn = val;
    else if (key === "N") { const [family = "", given = "", mid = ""] = val.split(";"); card.n = [given, mid, family].filter(Boolean).join(" "); }
    else if (key === "TEL") card.tels.push(val);
    else if (key === "EMAIL" && !card.email) card.email = val;
    else if (key === "BDAY") card.bday = val;
    else if (key === "NOTE") card.note = val;
  }
  return { rows, ignored, format: "vcf" };
}

/** Lê o conteúdo de um arquivo de contatos (vCard ou CSV) e devolve as linhas válidas. Remove repetidos pelo telefone. */
export function parseContacts(text: string): ParseResult {
  const head = text.slice(0, 2000).toUpperCase();
  const res = head.includes("BEGIN:VCARD") ? parseVcf(text) : parseCsv(text);
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  let ignored = res.ignored;
  for (const r of res.rows) {
    if (seen.has(r.phone)) { ignored++; continue; }
    seen.add(r.phone);
    rows.push(r);
  }
  return { rows: rows.slice(0, MAX_IMPORT_ROWS), ignored: ignored + Math.max(0, rows.length - MAX_IMPORT_ROWS), format: res.format };
}
