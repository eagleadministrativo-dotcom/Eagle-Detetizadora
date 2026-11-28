import type { Db } from "../db";
import { need } from "../core";
import type { Ctx } from "../permissions";

/** Histórico de serviços já prestados, vindo das planilhas de vendas (2020 em diante). Só leitura. */
export const PAYMENT_KIND_LABEL: Record<string, string> = {
  pix: "Pix", dinheiro: "Dinheiro", cartao_credito: "Cartão de crédito", cartao_debito: "Cartão de débito", cartao: "Cartão",
  boleto: "Boleto", transferencia: "Transferência/depósito", cheque: "Cheque", permuta: "Permuta", contrato: "Contrato",
  empenho: "Empenho/órgão público", cortesia: "Cortesia", outro: "Outro",
};

export interface HistoryRow {
  id: string; customer_id: string; customer_name: string; service_date: string; sale_date: string | null; description: string | null;
  amount_cents: number | null; amount_note: string | null; payment_kind: string | null; payment_detail: string | null; service_address: string | null;
  customer_status: string | null; report: string | null; warranty: string | null; return_note: string | null; seller: string | null; notes: string | null; follow_up: string | null;
}
const COLS = `h.id, h.customer_id, c.name as customer_name, to_char(h.service_date,'YYYY-MM-DD') as service_date, to_char(h.sale_date,'YYYY-MM-DD') as sale_date,
  h.description, h.amount_cents, h.amount_note, h.payment_kind, h.payment_detail, h.service_address, h.customer_status, h.report, h.warranty, h.return_note, h.seller, h.notes, h.follow_up`;

export interface HistoryFilter { q?: string | null; year?: number | null; payment?: string | null; page?: number }

function where(ctx: Ctx, f: HistoryFilter) {
  const args: unknown[] = [ctx.unitId];
  const w = ["h.unit_id=$1"];
  if (f.year) { args.push(f.year); w.push(`extract(year from h.service_date)=$${args.length}`); }
  if (f.payment) { args.push(f.payment); w.push(`h.payment_kind=$${args.length}`); }
  const q = f.q?.trim();
  if (q) {
    args.push(`%${q.toLowerCase()}%`);
    const i = args.length;
    const digits = q.replace(/\D/g, "");
    let extra = "";
    if (digits.length >= 4) { args.push(`%${digits}%`); extra = ` or regexp_replace(coalesce(c.phone,'')||coalesce(c.cpf,''),'[^0-9]','','g') like $${args.length}`; }
    w.push(`(lower(c.name) like $${i} or lower(coalesce(h.description,'')) like $${i} or lower(coalesce(h.service_address,'')) like $${i} or lower(coalesce(c.contact_name,'')) like $${i}${extra})`);
  }
  return { sql: w.join(" and "), args };
}

export async function listHistory(db: Db, ctx: Ctx, f: HistoryFilter = {}) {
  need(ctx, "customers.history");
  const per = 100;
  const page = Math.max(1, f.page ?? 1);
  const { sql, args } = where(ctx, f);
  const [rows, [tot]] = await Promise.all([
    db.query<HistoryRow>(`select ${COLS} from service_history h join customers c on c.id=h.customer_id where ${sql} order by h.service_date desc, c.name limit ${per} offset ${(page - 1) * per}`, args),
    db.query<{ n: number; total: number }>(`select count(*)::int as n, coalesce(sum(h.amount_cents),0)::bigint as total from service_history h join customers c on c.id=h.customer_id where ${sql}`, args),
  ]);
  return { rows, count: tot.n, totalCents: Number(tot.total), page, pages: Math.max(1, Math.ceil(tot.n / per)) };
}

export async function historySummary(db: Db, ctx: Ctx) {
  need(ctx, "customers.history");
  const [years, pays] = await Promise.all([
    db.query<{ year: number; n: number; total: number; customers: number }>(
      `select extract(year from service_date)::int as year, count(*)::int as n, coalesce(sum(amount_cents),0)::bigint as total, count(distinct customer_id)::int as customers
       from service_history where unit_id=$1 group by 1 order by 1 desc`, [ctx.unitId]),
    db.query<{ kind: string | null; n: number; total: number }>(
      `select payment_kind as kind, count(*)::int as n, coalesce(sum(amount_cents),0)::bigint as total from service_history where unit_id=$1 group by 1 order by 3 desc`, [ctx.unitId]),
  ]);
  return { years: years.map((y) => ({ ...y, total: Number(y.total) })), pays: pays.map((p) => ({ ...p, total: Number(p.total) })) };
}

const MONTH: Record<string, number> = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
/** "26/12/2020", "25/4/25", "RET EM JULHO/2020", "SETEMBRO 2021" → data (dia 1 quando só tem mês). Sem ano: null. */
export function parseReturnNote(s: string | null | undefined): string | null {
  if (!s) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  const d = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (d) {
    const y = +d[3] < 100 ? 2000 + +d[3] : +d[3];
    return +d[2] >= 1 && +d[2] <= 12 && +d[1] >= 1 && +d[1] <= 31 && y >= 2010 ? `${y}-${p(+d[2])}-${p(+d[1])}` : null;
  }
  const t = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const m = t.match(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)[A-Z]*\.?\s*(?:\/|DE)?\s*(20\d\d|\d\d)\b/);
  if (m) { const y = m[2].length === 2 ? 2000 + +m[2] : +m[2]; return `${y}-${p(MONTH[m[1]])}-01`; }
  return null;
}

/** Retorno previsto na planilha: o do serviço mais recente que tenha data de retorno legível. */
export function sheetNextReturn(rows: HistoryRow[]): string | null {
  const sorted = rows.slice().sort((a, b) => b.service_date.localeCompare(a.service_date));
  for (const r of sorted) { const d = parseReturnNote(r.return_note); if (d) return d; }
  return null;
}

export async function customerHistory(db: Db, ctx: Ctx, customerId: string) {
  need(ctx, "customers.history");
  return db.query<HistoryRow>(`select ${COLS} from service_history h join customers c on c.id=h.customer_id where h.unit_id=$1 and h.customer_id=$2 order by h.service_date desc`, [ctx.unitId, customerId]);
}
