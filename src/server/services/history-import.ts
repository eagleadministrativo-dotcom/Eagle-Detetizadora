import crypto from "node:crypto";
import type { Db } from "../db";
import { audit, need } from "../core";
import { DomainError } from "../errors";
import type { Ctx } from "../permissions";

/**
 * Lê a "PLANILHA DE VENDAS - MENSAL" (exportada em PDF) e grava cada linha como serviço prestado no histórico.
 * Colunas reconhecidas pelo cabeçalho de cada mês: data, razão social, endereço, contato, telefone, CNPJ/CPF, data agendada,
 * descrição, valor, forma de pagamento, situação, laudo, concluído, e-mail, retorno, garantia, vendedora, observações e retornado.
 * Clientes repetidos (mesmo nome ou CNPJ/CPF no mesmo endereço) viram uma ficha só; unidades em endereços diferentes ficam separadas.
 * Enviar o mesmo arquivo de novo não duplica nada.
 */
export const HISTORY_SOURCE = "planilha-vendas";
export const HISTORY_IMPORT_MAX_BYTES = 8 * 1024 * 1024;

type Item = { p: number; x: number; y: number; w: number; s: string };
export interface SheetRecord {
  page: number; sale_date: string | null; service_date: string; name: string; name_note?: string | null; address: string | null; cep: string | null; contact: string | null;
  phone: string | null; doc: string | null; description: string | null; amount_raw: string | null; amount_cents: number | null; payment_raw: string | null;
  payment: string | null; status: string | null; report: string | null; email: string | null; return_at: string | null; warranty: string | null;
  seller: string | null; notes: string | null; follow_up: string | null;
}

const MONTHS: Record<string, number> = { JANEIRO: 1, FEVEREIRO: 2, "MARÇO": 3, MARCO: 3, ABRIL: 4, MAIO: 5, JUNHO: 6, JULHO: 7, AGOSTO: 8, SETEMBRO: 9, OUTUBRO: 10, NOVEMBRO: 11, DEZEMBRO: 12 };
const pad = (n: number) => String(n).padStart(2, "0");
const strip = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
export const normName = (s: string | null | undefined) => strip(s).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const docKey = (d: string | null | undefined) => { const x = (d ?? "").replace(/\D/g, ""); return x.length === 11 || x.length === 14 ? x : null; };
const addrKey = (a: string | null | undefined) => normName(a).replace(/\b(RUA|R|AV|AVENIDA|TRAVESSA|ESTRADA|AL|ALAMEDA)\b/g, "").replace(/\s+/g, "").slice(0, 14);
const junk = (n: string) => normName(n).length < 4;

function parseDate(s: string | undefined, year: number): string | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    const d = +m[1], mo = +m[2];
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2010 || y > 2100) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m2 && +m2[2] >= 1 && +m2[2] <= 12) return `${year}-${pad(+m2[2])}-${pad(+m2[1])}`;
  const m3 = s.match(/^(\d{1,2})\/([a-zç]{3})/i);
  if (m3) { const mo = Object.entries(MONTHS).find(([k]) => k.startsWith(strip(m3[2]).toUpperCase()))?.[1]; if (mo) return `${year}-${pad(mo)}-${pad(+m3[1])}`; }
  return null;
}
export function parseMoney(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/R\$|\s/g, "").match(/[\d.,]+/);
  if (!m) return null;
  let t = m[0];
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/\.\d{3}$/.test(t)) t = t.replace(/\./g, "");
  const v = Math.round(parseFloat(t) * 100);
  return Number.isFinite(v) && v >= 0 ? v : null;
}
export function paymentKind(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = strip(s).toUpperCase();
  if (/PERMU/.test(t)) return "permuta";
  if (/PIX|^OIX/.test(t)) return "pix";
  if (/DEB/.test(t)) return "cartao_debito";
  if (/CRED/.test(t)) return "cartao_credito";
  if (/CART|MAQUIN/.test(t)) return "cartao";
  if (/BOL|VOLETO/.test(t)) return "boleto";
  if (/^TR[AE]N|TRANSF|TRANF|TED|DOC\b|DEP/.test(t)) return "transferencia";
  if (/CONTRATO|MENSAL/.test(t)) return "contrato";
  if (/FUNDO ROT|PDDE|APMF|PAF|EMPENHO/.test(t)) return "empenho";
  if (/DIN|ESPECIE|VISTA/.test(t)) return "dinheiro";
  if (/CHEQ|\bCH\b/.test(t)) return "cheque";
  if (/CORTESIA|BRINDE|GRATIS|SEM CUSTO/.test(t)) return "cortesia";
  return "outro";
}

async function pdfItems(buf: Uint8Array): Promise<Item[]> {
  const { getDocumentProxy } = await import("unpdf");
  let pdf;
  // cópia: o leitor de PDF toma posse do buffer que recebe
  try { pdf = await getDocumentProxy(buf.slice()); } catch (e) { console.error("[planilha] PDF:", (e as Error).message); throw new DomainError("invalid_file", "Não consegui abrir este PDF."); }
  const items: Item[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items as { str?: string; transform: number[]; width?: number }[]) {
      if (!it.str || !it.str.trim()) continue;
      items.push({ p, x: it.transform[4], y: it.transform[5], w: it.width ?? 0, s: it.str.trim() });
    }
  }
  return items;
}

/** Linhas da planilha → registros. Exportado para teste. */
export function sheetRecords(items: Item[]): SheetRecord[] {
  const sorted = items.slice().sort((a, b) => a.p - b.p || b.y - a.y || a.x - b.x);
  const rows: { p: number; y: number; items: (Item & { cx: number })[] }[] = [];
  for (const it of sorted) {
    const cur = rows[rows.length - 1];
    if (!cur || cur.p !== it.p || Math.abs(cur.y - it.y) > 0.3) rows.push({ p: it.p, y: it.y, items: [] });
    rows[rows.length - 1].items.push({ ...it, cx: it.x + it.w / 2 });
  }
  let cols: { name: string; cx: number; x: number }[] | null = null;
  let year = new Date().getFullYear();
  let month: number | null = null;
  const out: SheetRecord[] = [];
  for (const r of rows) {
    const names = r.items.map((i) => i.s);
    if (names.includes("RAZÃO SOCIAL") || names.includes("DESCRIÇÃO DO SERVIÇOS")) { cols = r.items.map((i) => ({ name: i.s, cx: i.cx, x: i.x })); continue; }
    const head = r.items.find((i) => /PLANILHA DE VENDAS/i.test(i.s));
    if (head) {
      const y = head.s.match(/20\d\d/); if (y) year = +y[0];
      const mo = Object.entries(MONTHS).find(([k]) => strip(head.s).toUpperCase().includes(strip(k)))?.[1];
      month = mo ?? month;
    }
    if (!cols) continue;
    const obs = cols.find((c) => c.name === "OBSERVAÇÕES");
    const ret = cols.find((c) => /^Retornado$/i.test(c.name));
    const rec: Record<string, string> = {};
    for (const i of r.items) {
      if (/PLANILHA DE VENDAS|RETORNAR EM/i.test(i.s)) continue;
      let best = cols[0], bd = Infinity;
      for (const c of cols) { const d = Math.abs(c.cx - i.cx); if (d < bd) { bd = d; best = c; } }
      let name = best.name;
      if (obs && i.x >= obs.x - 3) name = i.x >= (ret ? ret.x - 30 : obs.x + 42) ? "RETORNADO" : "OBSERVAÇÕES";
      rec[name] = rec[name] ? `${rec[name]} ${i.s}` : i.s;
    }
    const name0 = rec["RAZÃO SOCIAL"];
    if (!name0 || !(rec["VALOR SERV"] || rec["DESCRIÇÃO DO SERVIÇOS"] || rec["DATA AGEND"])) continue;
    let name = name0.replace(/\s+/g, " ").trim();
    // anotação entre asteriscos no nome (*sem contato*, **faz com outra empresa**) vai para as observações
    const nameNotes = [...name.matchAll(/\*+([^*]+)\*+/g)].map((m) => m[1].trim()).filter(Boolean);
    if (nameNotes.length) name = name.replace(/\*+[^*]*\*+/g, " ").replace(/\s+/g, " ").trim() || name.replace(/\*/g, "").trim();
    let saleRaw = rec["DATA"] || rec["f"] || rec["ra"];
    const lead = name.match(/^(\d{1,2}\/[a-zç]{3}\.?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.*)$/i);
    if (lead) { saleRaw = saleRaw || lead[1]; name = lead[2]; }
    const address = [rec["ENDEREÇO"], rec["ENDEREÇO COM CEP"]].filter(Boolean).join(" ") || null;
    const sale = parseDate(saleRaw, year);
    const sched = parseDate(rec["DATA AGEND"], year);
    // data ilegível: fica no 1º dia do mês da planilha
    const service = sched || sale || (month ? `${year}-${pad(month)}-01` : null);
    if (!service) continue;
    const cm = address?.match(/\b(\d{2})\.?(\d{3})-?(\d{3})\b/);
    out.push({
      page: r.p, sale_date: sale, service_date: service, name, name_note: nameNotes.join("; ") || null, address, cep: cm ? `${cm[1]}${cm[2]}-${cm[3]}` : null,
      contact: rec["CONTATO"] || null, phone: rec["TELEFONE"] || null, doc: rec["CNPJ/CPF"] || null, description: rec["DESCRIÇÃO DO SERVIÇOS"] || null,
      amount_raw: rec["VALOR SERV"] || null, amount_cents: parseMoney(rec["VALOR SERV"]), payment_raw: rec["FORMA PAGAM"] || null, payment: paymentKind(rec["FORMA PAGAM"]),
      status: rec["SITUAÇÃO DO CLIENTE"] || null, report: rec["LAUDOS"] || null, email: rec["E-MAIL"] || null, return_at: rec["DATA P/ RETORNO"] || null,
      warranty: rec["GARANTIA"] || null, seller: rec["VENDEDORA"] || null, notes: rec["OBSERVAÇÕES"] || null, follow_up: rec["RETORNADO"] || null,
    });
  }
  return out;
}

const phonesOf = (raw: string | null) => (raw ?? "").split(/[/;,]| e | ou /i).map((p) => {
  let d = p.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 8 || d.length === 9) d = "41" + d; // planilha sem DDD: Curitiba e região
  return d.length === 10 || d.length === 11 ? d : null;
}).filter((x): x is string => !!x);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface ImportSummary { records: number; newCustomers: number; matchedCustomers: number; inserted: number; skipped: number; totalCents: number; firstDate: string | null; lastDate: string | null; years: Record<string, number> }

/** Lê o PDF e grava (ou só confere, com dryRun) o histórico. */
export async function importSalesSheet(db: Db, ctx: Ctx, file: Uint8Array, opts: { dryRun?: boolean } = {}): Promise<ImportSummary> {
  need(ctx, "customers.manage");
  need(ctx, "data.export");
  if (file.byteLength > HISTORY_IMPORT_MAX_BYTES) throw new DomainError("invalid_file", "Arquivo grande demais (até 8 MB).");
  const recs = sheetRecords(await pdfItems(file));
  if (!recs.length) throw new DomainError("invalid_file", "Não achei linhas da planilha de vendas neste PDF (cabeçalho com RAZÃO SOCIAL, DESCRIÇÃO DO SERVIÇOS, VALOR SERV…).");
  return importRecords(db, ctx, recs, opts);
}

export async function importRecords(db: Db, ctx: Ctx, recs: SheetRecord[], opts: { dryRun?: boolean } = {}): Promise<ImportSummary> {
  need(ctx, "customers.manage");
  // agrupa clientes repetidos
  const parent = recs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const unite = (a: number, b: number) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  const nameKey = (r: SheetRecord) => (junk(r.name) ? null : `${normName(r.name)}|${r.address ? addrKey(r.address) : ""}`);
  const docAddr = (r: SheetRecord) => { const d = docKey(r.doc); return d && r.address ? `${d}|${addrKey(r.address)}` : null; };
  const seenN = new Map<string, number>(), seenD = new Map<string, number>(), seenDoc = new Map<string, number>();
  recs.forEach((r, i) => {
    const n = nameKey(r), d = docAddr(r), doc = docKey(r.doc);
    if (n) { if (seenN.has(n)) unite(seenN.get(n)!, i); else seenN.set(n, i); }
    if (d) { if (seenD.has(d)) unite(seenD.get(d)!, i); else seenD.set(d, i); }
    if (doc && !seenDoc.has(doc)) seenDoc.set(doc, i);
  });
  recs.forEach((r, i) => { const doc = docKey(r.doc); if (junk(r.name) && doc && seenDoc.get(doc) !== i) unite(seenDoc.get(doc)!, i); });
  const groups = new Map<number, number[]>();
  recs.forEach((_, i) => { const g = find(i); groups.set(g, [...(groups.get(g) ?? []), i]); });

  // clientes que já existem no sistema (mesmas regras)
  const existing = await db.query<{ id: string; name: string; address: string | null; cpf: string | null }>("select id, name, address, cpf from customers where unit_id=$1", [ctx.unitId]);
  const exN = new Map<string, string>(), exD = new Map<string, string>();
  for (const c of existing) {
    exN.set(`${normName(c.name)}|${c.address ? addrKey(c.address) : ""}`, c.id);
    const d = docKey(c.cpf); if (d && c.address) exD.set(`${d}|${addrKey(c.address)}`, c.id);
  }

  type NewCustomer = { id: string; name: string; phone: string | null; email: string | null; cpf: string | null; address: string | null; cep: string | null; contact: string | null; notes: string };
  const fresh: NewCustomer[] = [];
  const custOf: string[] = new Array(recs.length);
  let matched = 0;
  for (const idx of groups.values()) {
    idx.sort((a, b) => recs[a].service_date.localeCompare(recs[b].service_date) || a - b);
    const latest = <T,>(f: (r: SheetRecord) => T | null | undefined) => { for (let k = idx.length - 1; k >= 0; k--) { const v = f(recs[idx[k]]); if (v) return v; } return null; };
    let id: string | undefined;
    for (const i of idx) { const n = nameKey(recs[i]), d = docAddr(recs[i]); id = (n && exN.get(n)) || (d && exD.get(d)) || undefined; if (id) break; }
    if (id) matched++;
    else {
      id = crypto.randomUUID();
      const phones = [...new Set(idx.flatMap((i) => phonesOf(recs[i].phone)).reverse())];
      const email = latest((r) => (r.email ?? "").split(/[\s;,/]+/).find((e) => EMAIL.test(e)));
      const notes = ["Cliente vindo da planilha de vendas."];
      if (phones.length > 1) notes.push(`Outros telefones: ${phones.slice(1).join(", ")}`);
      const nameNotes = [...new Set(idx.map((i) => recs[i].name_note).filter(Boolean))];
      if (nameNotes.length) notes.push(`Obs.: ${nameNotes.join("; ")}`);
      fresh.push({
        id, name: (latest((r) => (junk(r.name) ? null : r.name)) ?? recs[idx[0]].name).slice(0, 200), phone: phones[0] ?? null,
        email: email ? email.toLowerCase().slice(0, 200) : null, cpf: latest((r) => r.doc), address: latest((r) => r.address), cep: latest((r) => r.cep),
        contact: latest((r) => r.contact), notes: notes.join("\n"),
      });
    }
    for (const i of idx) custOf[i] = id;
  }

  // referência estável de cada linha: o mesmo arquivo enviado de novo não duplica
  const occ = new Map<string, number>();
  const refs = recs.map((r) => {
    const h = crypto.createHash("sha1").update([r.service_date, normName(`${r.name_note ?? ""} ${r.name}`), normName(r.description), r.amount_cents ?? "", normName(r.address), normName(r.payment_raw)].join("|")).digest("hex").slice(0, 20);
    const n = (occ.get(h) ?? 0) + 1; occ.set(h, n);
    return `${h}#${n}`;
  });
  const dates = recs.map((r) => r.service_date).sort();
  const summary: ImportSummary = {
    records: recs.length, newCustomers: fresh.length, matchedCustomers: matched, inserted: 0, skipped: 0,
    totalCents: recs.reduce((a, r) => a + (r.amount_cents ?? 0), 0), firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null,
    years: recs.reduce<Record<string, number>>((a, r) => { const y = r.service_date.slice(0, 4); a[y] = (a[y] ?? 0) + 1; return a; }, {}),
  };
  if (opts.dryRun) {
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from service_history where unit_id=$1 and source=$2 and source_ref = any($3::text[])", [ctx.unitId, HISTORY_SOURCE, refs]);
    return { ...summary, skipped: n, inserted: recs.length - n };
  }

  await db.tx(async (q) => {
    for (let k = 0; k < fresh.length; k += 500) {
      const part = fresh.slice(k, k + 500);
      const c = <K extends keyof NewCustomer>(key: K) => part.map((x) => x[key]);
      await q(
        `insert into customers(id,unit_id,name,phone,email,cpf,address,cep,contact_name,notes,updated_by)
         select t.id, $1::uuid, t.name, t.phone, t.email, t.cpf, t.address, t.cep, t.contact, t.notes, $2::uuid
         from unnest($3::uuid[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[],$10::text[],$11::text[]) as t(id,name,phone,email,cpf,address,cep,contact,notes)`,
        [ctx.unitId, ctx.userId, c("id"), c("name"), c("phone"), c("email"), c("cpf"), c("address"), c("cep"), c("contact"), c("notes")]);
    }
    for (let k = 0; k < recs.length; k += 500) {
      const part = recs.slice(k, k + 500);
      const ids = custOf.slice(k, k + 500), rf = refs.slice(k, k + 500);
      const c = <K extends keyof SheetRecord>(key: K) => part.map((x) => x[key] ?? null);
      const res = await q<{ id: string }>(
        `insert into service_history(unit_id,customer_id,service_date,sale_date,description,amount_cents,amount_note,payment_kind,payment_detail,service_address,customer_status,report,warranty,return_note,seller,notes,follow_up,source,source_ref)
         select $1::uuid, t.cid, t.sd, t.sale, t.descr, t.amt, t.amt_note, t.pk, t.pd, t.addr, t.st, t.rep, t.war, t.ret, t.sel, t.obs, t.fu, $2, t.ref
         from unnest($3::uuid[],$4::date[],$5::date[],$6::text[],$7::int[],$8::text[],$9::text[],$10::text[],$11::text[],$12::text[],$13::text[],$14::text[],$15::text[],$16::text[],$17::text[],$18::text[],$19::text[])
           as t(cid,sd,sale,descr,amt,amt_note,pk,pd,addr,st,rep,war,ret,sel,obs,fu,ref)
         on conflict do nothing returning id`,
        [ctx.unitId, HISTORY_SOURCE, ids, c("service_date"), c("sale_date"), c("description"), c("amount_cents"), part.map((r) => (r.amount_cents == null ? r.amount_raw : null)),
          c("payment"), c("payment_raw"), c("address"), c("status"), c("report"), c("warranty"), c("return_at"), c("seller"), c("notes"), c("follow_up"), rf]);
      summary.inserted += res.length;
    }
    summary.skipped = recs.length - summary.inserted;
    await audit(q, ctx, "HISTORICO_IMPORTADO", "service_history", null, null, { records: recs.length, inserted: summary.inserted, newCustomers: fresh.length, matchedCustomers: matched });
  });
  return summary;
}
