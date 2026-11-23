import type { Db, Q } from "../db";
import { can, getSettings, need } from "../core";
import { DomainError } from "../errors";
import type { Ctx } from "../permissions";
import { addDays, atLocal, dayOfWeek, daysBetween, dayEndUtc, dayStartUtc, previousPeriod, todayYmd, type Period } from "@/lib/dates";
import { safeDiv } from "@/lib/money";

/** Data local (São Paulo, UTC-3 fixo) de uma coluna timestamptz. */
export const LD = (col: string) => `((${col} at time zone 'UTC') - interval '3 hours')::date`;

export interface Kpi {
  key: string; label: string; value: number | null; unit: "brl" | "count" | "pct";
  definition: string; formula: string; source: string; exclusions: string;
  previous?: number | null; warning?: string; notReconciledCents?: number; updatedAt: Date;
}

const range = (p: Period) => ({ from: dayStartUtc(p.start), to: dayEndUtc(p.end) });

function scopeStaff(ctx: Ctx, staffId?: string | null): string | null {
  if (can(ctx, "dashboard.full") || can(ctx, "finance.view")) return staffId ?? null;
  return ctx.staffId ?? "00000000-0000-0000-0000-000000000000";
}

// ---------- receita / atendimentos ----------
async function revenueStats(q: Q, unitId: string, p: Period, staffId: string | null) {
  const { from, to } = range(p);
  const [r] = await q<{ revenue: number; gross: number; discounts: number; n: number; eligible: number; eligible_revenue: number }>(
    `select coalesce(sum(total_cents),0)::bigint as revenue, coalesce(sum(subtotal_cents),0)::bigint as gross, coalesce(sum(discount_cents),0)::bigint as discounts,
       count(*)::bigint as n, count(*) filter (where total_cents > 0)::bigint as eligible, coalesce(sum(total_cents) filter (where total_cents > 0),0)::bigint as eligible_revenue
     from attendances where unit_id=$1 and status='concluido' and finished_at >= $2 and finished_at < $3 and ($4::uuid is null or staff_id=$4)`,
    [unitId, from, to, staffId],
  );
  return r;
}

/** Receita de produtos por competência: venda na data da conclusão, devolução na data em que ocorreu. */
export async function productStats(q: Q, unitId: string, p: Period, staffId: string | null) {
  const { from, to } = range(p);
  const [s] = await q<{ gross: number; discounts: number; units: number }>(
    "select coalesce(sum(s.gross_cents),0)::bigint as gross, coalesce(sum(s.discount_cents),0)::bigint as discounts, coalesce(sum((select sum(i.quantity) from product_sale_items i where i.sale_id=s.id)),0)::bigint as units from product_sales s where s.unit_id=$1 and s.status='concluida' and s.finished_at >= $2 and s.finished_at < $3 and ($4::uuid is null or s.seller_staff_id=$4)", [unitId, from, to, staffId]);
  const [r] = await q<{ returned: number }>(
    "select coalesce(sum(r.amount_cents),0)::bigint as returned from product_returns r join product_sale_items i on i.id=r.sale_item_id join product_sales s on s.id=i.sale_id where r.unit_id=$1 and r.created_at >= $2 and r.created_at < $3 and ($4::uuid is null or s.seller_staff_id=$4)", [unitId, from, to, staffId]);
  return { ...s, returned: r.returned, net: s.gross - s.discounts - r.returned };
}

// ---------- recebimentos ----------
async function receiptStats(q: Q, unitId: string, p: Period, staffId: string | null) {
  const { from, to } = range(p);
  const [r] = await q<{ registered: number; confirmed: number; settled: number; fees: number }>(
    `select coalesce(sum(case when p.kind='recebimento' then p.amount_cents else -p.amount_cents end),0)::bigint as registered,
       coalesce(sum(case when p.status in ('confirmado','liquidado') then (case when p.kind='recebimento' then p.amount_cents else -p.amount_cents end) else 0 end),0)::bigint as confirmed,
       coalesce(sum(case when p.status='liquidado' then (case when p.kind='recebimento' then p.amount_cents else -p.amount_cents end) else 0 end),0)::bigint as settled,
       coalesce(sum(case when p.kind='recebimento' then p.fee_cents else -p.fee_cents end),0)::bigint as fees
     from payments p join receivables r on r.id=p.receivable_id left join attendances a on a.id=r.attendance_id
     where p.unit_id=$1 and p.paid_at >= $2 and p.paid_at < $3 and ($4::uuid is null or a.staff_id=$4)`,
    [unitId, from, to, staffId],
  );
  return r;
}

// ---------- DRE (competência) ----------
export interface DreLine { key: string; label: string; cents: number; group?: string; categoryId?: string }
export interface Dre {
  period: Period;
  lines: DreLine[];
  grossRevenue: number; discounts: number; otherRevenue: number; netRevenue: number; fees: number; variableCosts: number; contributionMargin: number;
  expenses: number; taxes: number; operatingResult: number; nonOperating: number; netResult: number; profitDistribution: number;
  contributionRatio: number | null; breakEven: number | null; warnings: string[];
}

export async function computeDre(q: Q, unitId: string, p: Period): Promise<Dre> {
  const { from, to } = range(p);
  const rev = await revenueStats(q, unitId, p, null);
  const [oth] = await q<{ v: number }>(
    `select coalesce(sum(amount_due_cents),0)::bigint as v from receivables where unit_id=$1 and attendance_id is null and status='ativo' and created_at >= $2 and created_at < $3
       and not exists (select 1 from product_sales ps where ps.receivable_id=receivables.id)`, [unitId, from, to]);
  const prod = await productStats(q, unitId, p, null);
  const rec = await receiptStats(q, unitId, p, null);
  const cats = await q<{ id: string; name: string; kind: string; cents: number }>(
    `select c.id, c.name, c.kind, coalesce(sum(b.amount_cents),0)::bigint as cents
     from financial_categories c left join payables b on b.category_id=c.id and b.status='ativo' and coalesce(b.competence_date,b.due_date) between $2::date and $3::date
     where c.unit_id=$1 group by c.id, c.name, c.kind, c.sort_order order by c.kind, c.sort_order, c.name`,
    [unitId, p.start, p.end],
  );
  const sumKind = (...k: string[]) => cats.filter((c) => k.includes(c.kind)).reduce((a, c) => a + c.cents, 0);
  const variableCosts = sumKind("custo");
  const expenses = sumKind("despesa", "pro_labore");
  const taxes = sumKind("imposto");
  const nonOperating = sumKind("nao_operacional");
  const profitDistribution = sumKind("distribuicao_lucros");
  const netRevenue = rev.revenue + oth.v + prod.net;
  const contributionMargin = netRevenue - rec.fees - variableCosts;
  const operatingResult = contributionMargin - expenses - taxes;
  const netResult = operatingResult - nonOperating;
  const ratio = netRevenue > 0 ? contributionMargin / netRevenue : null;
  const fixed = expenses + taxes;
  const lines: DreLine[] = [
    { key: "gross", label: "Receita bruta de serviços", cents: rev.gross },
    { key: "discounts", label: "(−) Descontos concedidos", cents: -rev.discounts },
    ...(prod.gross ? [{ key: "products_gross", label: "Receita bruta de produtos", cents: prod.gross }] : []),
    ...(prod.discounts ? [{ key: "products_discounts", label: "(−) Descontos em produtos", cents: -prod.discounts }] : []),
    ...(prod.returned ? [{ key: "products_returned", label: "(−) Devoluções de produtos", cents: -prod.returned }] : []),
    ...(oth.v ? [{ key: "other_revenue", label: "Outras receitas (cobranças avulsas)", cents: oth.v }] : []),
    { key: "net_revenue", label: "Receita líquida", cents: netRevenue, group: "total" },
    { key: "fees", label: "(−) Taxas de meios de pagamento", cents: -rec.fees },
    ...cats.filter((c) => c.kind === "custo" && c.cents).map((c) => ({ key: `cat:${c.id}`, label: `(−) ${c.name}`, cents: -c.cents, group: "custo", categoryId: c.id })),
    { key: "contribution", label: "Margem de contribuição", cents: contributionMargin, group: "total" },
    ...cats.filter((c) => ["despesa", "pro_labore"].includes(c.kind) && c.cents).map((c) => ({ key: `cat:${c.id}`, label: `(−) ${c.name}`, cents: -c.cents, group: "despesa", categoryId: c.id })),
    ...cats.filter((c) => c.kind === "imposto" && c.cents).map((c) => ({ key: `cat:${c.id}`, label: `(−) ${c.name}`, cents: -c.cents, group: "imposto", categoryId: c.id })),
    { key: "operating", label: "Resultado operacional", cents: operatingResult, group: "total" },
    ...cats.filter((c) => c.kind === "nao_operacional" && c.cents).map((c) => ({ key: `cat:${c.id}`, label: `(−) ${c.name}`, cents: -c.cents, group: "nao_operacional", categoryId: c.id })),
    { key: "net", label: "Resultado líquido", cents: netResult, group: "total" },
  ];
  const warnings: string[] = [];
  const [pend] = await q<{ n: number }>(
    `select count(*)::bigint as n from payments p join payment_methods m on m.id=p.method_id where p.unit_id=$1 and p.kind='recebimento' and p.status='registrado' and p.paid_at >= $2 and p.paid_at < $3
       and not exists (select 1 from payments x where x.reversal_of=p.id)`, [unitId, from, to]);
  if (pend.n > 0) warnings.push(`${pend.n} recebimento(s) do período ainda não foram conferidos; a receita é por competência, mas o caixa depende da conferência.`);
  if (rev.n === 0) warnings.push("Nenhum atendimento concluído no período: a DRE mostra apenas custos e despesas lançados.");
  if (taxes === 0) warnings.push("Nenhum imposto lançado no período; o resultado não considera tributos até que sejam cadastrados.");
  return {
    period: p, lines, grossRevenue: rev.gross, discounts: rev.discounts, otherRevenue: oth.v, netRevenue, fees: rec.fees, variableCosts, contributionMargin,
    expenses, taxes, operatingResult, nonOperating, netResult, profitDistribution,
    contributionRatio: ratio, breakEven: ratio && ratio > 0 ? Math.round(fixed / ratio) : null, warnings,
  };
}

export async function getDre(db: Db, ctx: Ctx, p: Period) {
  need(ctx, "finance.view", "finance.dre_view");
  const cur = await computeDre(db.query, ctx.unitId, p);
  const prev = await computeDre(db.query, ctx.unitId, previousPeriod(p));
  return { current: cur, previous: prev };
}

// ---------- ocupação ----------
export async function availability(q: Q, unitId: string, p: Period, staffId: string | null, now = new Date()): Promise<{ availableMin: number; configured: boolean }> {
  const st = await getSettings(q, unitId);
  const chairs = (await q<{ n: number }>("select count(*)::bigint as n from chairs where unit_id=$1 and is_active", [unitId]))[0].n;
  let scheds: { day_of_week: number; st: string; en: string }[] = [];
  if (staffId) scheds = await q("select day_of_week, to_char(start_time,'HH24:MI') as st, to_char(end_time,'HH24:MI') as en from staff_schedules where staff_id=$1", [staffId]);
  let total = 0;
  let configured = false;
  for (let d = p.start; d <= p.end; d = addDays(d, 1)) {
    const dow = dayOfWeek(d);
    const windows: [string, string][] = staffId && scheds.length ? scheds.filter((s) => s.day_of_week === dow).map((s) => [s.st, s.en]) : st.business_hours[String(dow)] ?? [];
    for (const [a, b] of windows) {
      configured = true;
      const s = atLocal(d, a).getTime(), e = Math.min(atLocal(d, b).getTime(), now.getTime());
      if (e > s) total += ((e - s) / 60000) * (staffId && scheds.length ? 1 : staffId ? 1 : chairs);
    }
  }
  return { availableMin: total, configured };
}

async function occupancyStats(q: Q, unitId: string, p: Period, staffId: string | null) {
  const { from, to } = range(p);
  const [o] = await q<{ occupied: number; reserved: number }>(
    `select coalesce(sum(extract(epoch from (ends_at - starts_at))/60) filter (where status in ('concluido','em_atendimento')),0)::bigint as occupied,
            coalesce(sum(extract(epoch from (ends_at - starts_at))/60) filter (where status='agendado'),0)::bigint as reserved
     from appointments where unit_id=$1 and starts_at >= $2 and starts_at < $3 and ($4::uuid is null or staff_id=$4)`,
    [unitId, from, to, staffId],
  );
  const av = await availability(q, unitId, p, staffId);
  return { ...o, ...av };
}

// ---------- saldos ----------
export interface AccountBalance { id: string; name: string; kind: string; balance_cents: number }
export async function accountBalances(q: Q, unitId: string, upto?: Date): Promise<AccountBalance[]> {
  const limit = upto ?? new Date(Date.now() + 86400000 * 365);
  return q<AccountBalance>(
    `select a.id, a.name, a.kind,
       (a.opening_balance_cents
        + coalesce((select sum((case when p.kind='recebimento' then 1 else -1 end) * (p.amount_cents - p.fee_cents)) from payments p join payment_methods m on m.id=p.method_id
                    where m.account_id=a.id and p.status in ('confirmado','liquidado') and p.paid_at <= $2),0)
        + coalesce((select sum(c.amount_cents) from capital_entries c where c.account_id=a.id and c.entry_date <= ${LD("$2::timestamptz")}),0)
        - coalesce((select sum((case when pp.kind='pagamento' then 1 else -1 end) * pp.amount_cents) from payable_payments pp where pp.account_id=a.id and pp.paid_at <= $2),0)
       )::bigint as balance_cents
     from financial_accounts a where a.unit_id=$1 and a.is_active order by a.name`,
    [unitId, limit],
  );
}

// ---------- KPIs ----------
export interface DashboardData {
  period: Period; kpis: Kpi[]; accounts: AccountBalance[]; revenueByDay: { date: string; cents: number; expenses: number }[];
  resultSeries: { date: string; cents: number }[]; topServices: { name: string; qty: number; cents: number }[];
  byMethod: { name: string; cents: number }[]; heat: { dow: number; hour: number; n: number }[]; alerts: { severity: string; message: string; href?: string }[];
  warnings: string[]; updatedAt: Date;
}

export async function getDashboard(db: Db, ctx: Ctx, p: Period, staffFilter?: string | null): Promise<DashboardData> {
  need(ctx, "dashboard.full", "dashboard.own", "finance.view");
  const full = can(ctx, "dashboard.full") || can(ctx, "finance.view");
  const staffId = scopeStaff(ctx, staffFilter);
  const q = db.query;
  const now = new Date();
  const prevP = previousPeriod(p);
  const [rev, revPrev, rec, recPrev, occ] = await Promise.all([
    revenueStats(q, ctx.unitId, p, staffId), revenueStats(q, ctx.unitId, prevP, staffId),
    full ? receiptStats(q, ctx.unitId, p, staffId) : Promise.resolve(null), full ? receiptStats(q, ctx.unitId, prevP, staffId) : Promise.resolve(null),
    occupancyStats(q, ctx.unitId, p, staffId),
  ]);
  const occPrev = await occupancyStats(q, ctx.unitId, prevP, staffId);
  const kpis: Kpi[] = [];
  const base = { updatedAt: now };
  kpis.push({
    key: "revenue", label: "Receita operacional", value: rev.revenue, unit: "brl", previous: revPrev.revenue,
    definition: "Valor dos atendimentos concluídos no período, já descontados os descontos concedidos. Não é dinheiro recebido.",
    formula: "Σ total do atendimento (subtotal − desconto)", source: "attendances (status concluído), por data de conclusão", exclusions: "Atendimentos cancelados, em andamento e agendados.", ...base,
  });
  kpis.push({
    key: "attendances", label: "Atendimentos", value: rev.n, unit: "count", previous: revPrev.n,
    definition: "Quantidade de atendimentos concluídos no período.", formula: "contagem de atendimentos concluídos", source: "attendances", exclusions: "Cancelados e em andamento.", ...base,
  });
  kpis.push({
    key: "ticket", label: "Ticket médio", value: safeDiv(rev.eligible_revenue, rev.eligible) == null ? null : Math.round(rev.eligible_revenue / rev.eligible), unit: "brl",
    previous: revPrev.eligible ? Math.round(revPrev.eligible_revenue / revPrev.eligible) : null,
    definition: "Receita média por atendimento concluído com valor.", formula: "receita elegível ÷ nº de atendimentos elegíveis",
    source: "attendances", exclusions: "Atendimentos sem valor (cortesia) e cancelados.", warning: rev.eligible === 0 ? "Sem atendimentos no período." : undefined, ...base,
  });
  const [prod, prodPrev] = await Promise.all([productStats(q, ctx.unitId, p, staffId), productStats(q, ctx.unitId, prevP, staffId)]);
  if (prod.gross || prodPrev.gross) kpis.push({
    key: "products", label: "Receita de produtos", value: prod.net, unit: "brl", previous: prodPrev.net,
    definition: "Produtos vendidos no período, menos descontos e devoluções. É separada da receita de serviços.",
    formula: "Σ vendas − descontos − devoluções", source: "product_sales e product_returns", exclusions: "Vendas em aberto ou canceladas.", ...base,
  });
  if (full && rec && recPrev) {
    kpis.push({
      key: "receipts_registered", label: "Pagamentos registrados", value: rec.registered, unit: "brl", previous: recPrev.registered,
      definition: "Pagamentos lançados pelos operadores, ainda que não conferidos. Não prova que o dinheiro entrou na conta.",
      formula: "Σ recebimentos − Σ estornos, por data do pagamento", source: "payments", exclusions: "—", ...base,
    });
    kpis.push({
      key: "receipts_confirmed", label: "Recebimentos confirmados", value: rec.confirmed, unit: "brl", previous: recPrev.confirmed, notReconciledCents: rec.registered - rec.confirmed,
      definition: "Pagamentos conferidos por um operador (dinheiro: contagem do caixa; Pix/cartão: evidência registrada). É conferência manual, não verificação bancária automática.",
      formula: "Σ pagamentos com status confirmado ou liquidado, líquidos de estornos", source: "payments", exclusions: "Pagamentos apenas registrados (pendentes de conferência).", ...base,
    });
    kpis.push({
      key: "receipts_settled", label: "Recebimentos conciliados", value: rec.settled, unit: "brl", previous: recPrev.settled,
      definition: "Pagamentos com liquidação registrada manualmente (ex.: conferido no extrato).", formula: "Σ pagamentos com status liquidado, líquidos de estornos", source: "payments", exclusions: "Registrados e apenas confirmados.", ...base,
    });
  }
  let result: number | null = null;
  let resultPrev: number | null = null;
  let dreWarnings: string[] = [];
  if (full && can(ctx, "finance.view")) {
    const dre = await computeDre(q, ctx.unitId, p);
    const dp = await computeDre(q, ctx.unitId, prevP);
    result = dre.operatingResult; resultPrev = dp.operatingResult; dreWarnings = dre.warnings;
    kpis.push({
      key: "operating_result", label: "Resultado operacional", value: result, unit: "brl", previous: resultPrev,
      definition: "Resultado do período por competência: receita líquida − taxas − custos − despesas − impostos. Não inclui aportes, empréstimos nem distribuição de lucros.",
      formula: "receita líquida − taxas de pagamento − custos − despesas − impostos", source: "DRE gerencial (attendances, payables, payments)", exclusions: "Aportes, empréstimos, distribuição de lucros, itens não operacionais.",
      warning: dre.warnings.find((w) => w.includes("imposto")), ...base,
    });
  }
  const accounts = full && can(ctx, "finance.view") ? await accountBalances(q, ctx.unitId) : [];
  if (full && can(ctx, "finance.view")) {
    kpis.push({
      key: "cash_balance", label: "Saldo das contas", value: accounts.reduce((a, c) => a + c.balance_cents, 0), unit: "brl",
      definition: "Saldo inicial cadastrado + recebimentos confirmados (líquidos de taxas) + aportes − pagamentos de contas, por conta financeira.",
      formula: "saldo inicial + entradas confirmadas − saídas pagas", source: "financial_accounts, payments, payable_payments, capital_entries", exclusions: "Pagamentos apenas registrados; sangrias e suprimentos (movimentos internos).", ...base,
    });
    const [ar] = await q<{ open: number; n: number }>(
      "select coalesce(sum(r.amount_due_cents - b.registered_cents),0)::bigint as open, count(*)::bigint as n from receivables r join receivable_balances b on b.receivable_id=r.id where r.unit_id=$1 and r.status='ativo' and b.registered_cents < r.amount_due_cents", [ctx.unitId]);
    const [ap] = await q<{ open: number; overdue: number }>(
      `select coalesce(sum(p.amount_cents - b.paid_cents),0)::bigint as open, coalesce(sum(p.amount_cents - b.paid_cents) filter (where p.due_date < $2::date),0)::bigint as overdue
       from payables p join payable_balances b on b.payable_id=p.id where p.unit_id=$1 and p.status='ativo' and b.paid_cents < p.amount_cents`, [ctx.unitId, todayYmd()]);
    kpis.push({ key: "receivables_open", label: "A receber", value: ar.open, unit: "brl", definition: "Saldo ainda não pago de cobranças ativas (posição de hoje).", formula: "Σ (valor devido − pagamentos registrados)", source: "receivables, payments", exclusions: "Cobranças canceladas.", ...base });
    kpis.push({ key: "payables_open", label: "A pagar", value: ap.open, unit: "brl", definition: "Saldo de contas a pagar ativas (posição de hoje).", formula: "Σ (valor − pagamentos)", source: "payables, payable_payments", exclusions: "Contas canceladas.", warning: ap.overdue > 0 ? `${(ap.overdue / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} vencidos` : undefined, ...base });
  }
  kpis.push({
    key: "occupancy", label: "Ocupação", value: occ.configured && occ.availableMin > 0 ? (occ.occupied / occ.availableMin) * 100 : null, unit: "pct",
    previous: (await occupancyStats(q, ctx.unitId, prevP, staffId)).availableMin > 0 ? (occPrev.occupied / occPrev.availableMin) * 100 : null,
    definition: "Tempo efetivamente ocupado dividido pelo tempo disponibilizado para atendimento (horário de funcionamento × cadeiras ativas, até agora). Horas reservadas são mostradas à parte.",
    formula: "minutos de atendimentos concluídos/em andamento ÷ minutos disponíveis", source: "appointments, unit_settings.business_hours, chairs",
    exclusions: "Agendamentos futuros, cancelados e ausências.", warning: occ.configured ? (occ.reserved ? `${Math.round(occ.reserved / 60)} h reservadas ainda por realizar` : undefined) : "Cadastre o horário de funcionamento para calcular a ocupação.", ...base,
  });
  kpis.push({
    key: "revenue_per_hour", label: "Receita por hora disponível", value: occ.configured && occ.availableMin > 0 ? Math.round(rev.revenue / (occ.availableMin / 60)) : null, unit: "brl",
    definition: "Receita operacional dividida pelas horas disponibilizadas para atendimento.", formula: "receita operacional ÷ horas disponíveis", source: "attendances, unit_settings.business_hours",
    exclusions: "—", warning: occ.configured ? undefined : "Cadastre o horário de funcionamento.", ...base,
  });

  // séries
  const { from, to } = range(p);
  const byDay = await q<{ d: string; cents: number }>(
    `select to_char(${LD("finished_at")},'YYYY-MM-DD') as d, sum(total_cents)::bigint as cents from attendances where unit_id=$1 and status='concluido' and finished_at >= $2 and finished_at < $3 and ($4::uuid is null or staff_id=$4) group by 1`, [ctx.unitId, from, to, staffId]);
  const expDay = full && can(ctx, "finance.view")
    ? await q<{ d: string; cents: number }>(
        `select to_char(coalesce(b.competence_date,b.due_date),'YYYY-MM-DD') as d, sum(b.amount_cents)::bigint as cents from payables b join financial_categories c on c.id=b.category_id
         where b.unit_id=$1 and b.status='ativo' and c.kind in ('custo','despesa','pro_labore','imposto') and coalesce(b.competence_date,b.due_date) between $2::date and $3::date group by 1`, [ctx.unitId, p.start, p.end])
    : [];
  const revenueByDay: DashboardData["revenueByDay"] = [];
  const resultSeries: DashboardData["resultSeries"] = [];
  let acc = 0;
  for (let d = p.start; d <= p.end && revenueByDay.length < 400; d = addDays(d, 1)) {
    const r = byDay.find((x) => x.d === d)?.cents ?? 0;
    const e = expDay.find((x) => x.d === d)?.cents ?? 0;
    revenueByDay.push({ date: d, cents: r, expenses: e });
    acc += r - e;
    resultSeries.push({ date: d, cents: acc });
  }
  const topServices = await q<{ name: string; qty: number; cents: number }>(
    `select i.name_snapshot as name, sum(i.quantity)::bigint as qty, sum(i.line_total_cents)::bigint as cents from attendance_items i join attendances a on a.id=i.attendance_id
     where a.unit_id=$1 and a.status='concluido' and a.finished_at >= $2 and a.finished_at < $3 and ($4::uuid is null or a.staff_id=$4) group by 1 order by cents desc limit 8`, [ctx.unitId, from, to, staffId]);
  const byMethod = full ? await q<{ name: string; cents: number }>(
    `select m.name, sum(case when p.kind='recebimento' then p.amount_cents else -p.amount_cents end)::bigint as cents from payments p join payment_methods m on m.id=p.method_id
     where p.unit_id=$1 and p.paid_at >= $2 and p.paid_at < $3 group by 1 having sum(case when p.kind='recebimento' then p.amount_cents else -p.amount_cents end) <> 0 order by cents desc`, [ctx.unitId, from, to]) : [];
  const heat = await q<{ dow: number; hour: number; n: number }>(
    `select extract(dow from (starts_at at time zone 'UTC') - interval '3 hours')::int as dow, extract(hour from (starts_at at time zone 'UTC') - interval '3 hours')::int as hour, count(*)::bigint as n
     from appointments where unit_id=$1 and starts_at >= $2 and starts_at < $3 and status in ('concluido','em_atendimento','agendado') and ($4::uuid is null or staff_id=$4) group by 1,2`, [ctx.unitId, from, to, staffId]);

  const alerts: DashboardData["alerts"] = [];
  if (full && can(ctx, "finance.view")) {
    const [pend] = await q<{ n: number }>("select count(*)::bigint as n from payments p where p.unit_id=$1 and p.kind='recebimento' and p.status='registrado' and not exists (select 1 from payments x where x.reversal_of=p.id)", [ctx.unitId]);
    if (pend.n) alerts.push({ severity: "atencao", message: `${pend.n} pagamento(s) aguardando conferência`, href: "/financeiro/conciliacao" });
    const [od] = await q<{ n: number }>("select count(*)::bigint as n from payables p join payable_balances b on b.payable_id=p.id where p.unit_id=$1 and p.status='ativo' and b.paid_cents < p.amount_cents and p.due_date < $2::date", [ctx.unitId, todayYmd()]);
    if (od.n) alerts.push({ severity: "critico", message: `${od.n} conta(s) a pagar vencida(s)`, href: "/financeiro/pagar?f=abertas" });
    const [stale] = await q<{ n: number }>("select count(*)::bigint as n from cash_sessions where unit_id=$1 and status='aberto' and opened_at < now() - interval '16 hours'", [ctx.unitId]);
    if (stale.n) alerts.push({ severity: "atencao", message: "Há um caixa aberto há mais de 16 horas", href: "/financeiro/caixa" });
    const notes = await q<{ severity: string; message: string; ref_entity: string | null }>("select severity, message, ref_entity from notifications where unit_id=$1 and not is_read order by created_at desc limit 5", [ctx.unitId]);
    for (const n of notes) if (!alerts.some((a) => a.message === n.message)) alerts.push({ severity: n.severity, message: n.message });
  }
  return { period: p, kpis, accounts, revenueByDay, resultSeries, topServices, byMethod, heat, alerts, warnings: dreWarnings, updatedAt: now };
}

// ---------- registros que compõem um indicador ----------
export interface RecordRow { id: string; date: Date | string; title: string; detail: string; cents: number | null; href?: string }

export async function indicatorRecords(db: Db, ctx: Ctx, key: string, p: Period, staffFilter?: string | null): Promise<{ rows: RecordRow[]; total: number | null }> {
  need(ctx, "reports.view", "dashboard.full", "dashboard.own");
  const staffId = scopeStaff(ctx, staffFilter);
  const { from, to } = range(p);
  const q = db.query;
  const financial = can(ctx, "finance.view");
  switch (key) {
    case "revenue": case "attendances": case "ticket": {
      const rows = await q<RecordRow>(
        `select a.id, a.finished_at as date, c.name as title, (s.name || ' · ' || coalesce((select string_agg(i.name_snapshot,' + ') from attendance_items i where i.attendance_id=a.id),'')) as detail, a.total_cents as cents,
           '/atendimentos/' || a.id as href from attendances a join customers c on c.id=a.customer_id join staff s on s.id=a.staff_id
         where a.unit_id=$1 and a.status='concluido' and a.finished_at >= $2 and a.finished_at < $3 and ($4::uuid is null or a.staff_id=$4) order by a.finished_at desc limit 500`, [ctx.unitId, from, to, staffId]);
      return { rows, total: rows.reduce((a, r) => a + (r.cents ?? 0), 0) };
    }
    case "receipts_registered": case "receipts_confirmed": case "receipts_settled": {
      if (!financial) throw new DomainError("forbidden", "Sem permissão.");
      const cond = key === "receipts_confirmed" ? "p.status in ('confirmado','liquidado')" : key === "receipts_settled" ? "p.status='liquidado'" : "true";
      const rows = await q<RecordRow>(
        `select p.id, p.paid_at as date, coalesce(c.name,'—') as title, (m.name || ' · ' || p.status || case when p.kind='estorno' then ' · ESTORNO' else '' end || coalesce(' · ' || p.reference,'')) as detail,
           case when p.kind='recebimento' then p.amount_cents else -p.amount_cents end as cents, '/financeiro/receber/' || p.receivable_id as href
         from payments p join payment_methods m on m.id=p.method_id join receivables r on r.id=p.receivable_id left join customers c on c.id=r.customer_id
         where p.unit_id=$1 and p.paid_at >= $2 and p.paid_at < $3 and ${cond} order by p.paid_at desc limit 500`, [ctx.unitId, from, to]);
      return { rows, total: rows.reduce((a, r) => a + (r.cents ?? 0), 0) };
    }
    case "operating_result": case "costs": case "expenses": case "taxes": case "non_operating": {
      if (!financial) throw new DomainError("forbidden", "Sem permissão.");
      const kinds = key === "costs" ? ["custo"] : key === "expenses" ? ["despesa", "pro_labore"] : key === "taxes" ? ["imposto"] : key === "non_operating" ? ["nao_operacional"] : ["custo", "despesa", "pro_labore", "imposto", "nao_operacional"];
      const rows = await q<RecordRow>(
        `select b.id, coalesce(b.competence_date,b.due_date) as date, b.description as title, c.name as detail, -b.amount_cents as cents, '/financeiro/pagar/' || b.id as href
         from payables b join financial_categories c on c.id=b.category_id where b.unit_id=$1 and b.status='ativo' and c.kind = any($4::text[]) and coalesce(b.competence_date,b.due_date) between $2::date and $3::date order by 3 desc limit 500`,
        [ctx.unitId, p.start, p.end, kinds]);
      return { rows, total: rows.reduce((a, r) => a + (r.cents ?? 0), 0) };
    }
    case "receivables_open": {
      if (!financial) throw new DomainError("forbidden", "Sem permissão.");
      const rows = await q<RecordRow>(
        `select r.id, r.created_at as date, coalesce(c.name,'—') as title, r.description as detail, (r.amount_due_cents - b.registered_cents) as cents, '/financeiro/receber/' || r.id as href
         from receivables r join receivable_balances b on b.receivable_id=r.id left join customers c on c.id=r.customer_id where r.unit_id=$1 and r.status='ativo' and b.registered_cents < r.amount_due_cents order by r.created_at`, [ctx.unitId]);
      return { rows, total: rows.reduce((a, r) => a + (r.cents ?? 0), 0) };
    }
    case "payables_open": {
      if (!financial) throw new DomainError("forbidden", "Sem permissão.");
      const rows = await q<RecordRow>(
        `select p.id, p.due_date as date, p.description as title, c.name as detail, (p.amount_cents - b.paid_cents) as cents, '/financeiro/pagar/' || p.id as href
         from payables p join payable_balances b on b.payable_id=p.id join financial_categories c on c.id=p.category_id where p.unit_id=$1 and p.status='ativo' and b.paid_cents < p.amount_cents order by p.due_date`, [ctx.unitId]);
      return { rows, total: rows.reduce((a, r) => a + (r.cents ?? 0), 0) };
    }
    case "cash_balance": {
      if (!financial) throw new DomainError("forbidden", "Sem permissão.");
      const acc = await accountBalances(q, ctx.unitId);
      return { rows: acc.map((a) => ({ id: a.id, date: new Date(), title: a.name, detail: a.kind, cents: a.balance_cents })), total: acc.reduce((a, c) => a + c.balance_cents, 0) };
    }
    case "occupancy": case "revenue_per_hour": {
      const rows = await q<RecordRow>(
        `select a.id, a.starts_at as date, c.name as title, (s.name || ' · ' || a.status) as detail, null::int as cents, null as href
         from appointments a join customers c on c.id=a.customer_id join staff s on s.id=a.staff_id where a.unit_id=$1 and a.starts_at >= $2 and a.starts_at < $3 and ($4::uuid is null or a.staff_id=$4) order by a.starts_at limit 500`, [ctx.unitId, from, to, staffId]);
      return { rows, total: null };
    }
    default:
      throw new DomainError("not_found", "Indicador desconhecido.");
  }
}

// ---------- fluxo de caixa ----------
export interface FlowRow { date: string; inflow: number; outflow: number; balance: number; estimate: boolean }
export interface CashFlow {
  openingBalance: number; rows: FlowRow[]; pendingConfirmation: number; firstNegative: string | null; todayBalance: number; note: string[];
}

export async function getCashFlow(db: Db, ctx: Ctx, p: Period, projectDays = 30): Promise<CashFlow> {
  need(ctx, "finance.view");
  const q = db.query;
  const today = todayYmd();
  const from = dayStartUtc(p.start);
  const accs = await accountBalances(q, ctx.unitId, from);
  const opening = accs.reduce((a, c) => a + c.balance_cents, 0);
  const to = dayEndUtc(p.end);
  const ins = await q<{ d: string; c: number }>(
    `select to_char(${LD("p.paid_at")},'YYYY-MM-DD') as d, sum((case when p.kind='recebimento' then 1 else -1 end) * (p.amount_cents - p.fee_cents))::bigint as c
     from payments p join payment_methods m on m.id=p.method_id where p.unit_id=$1 and m.account_id is not null and p.status in ('confirmado','liquidado') and p.paid_at >= $2 and p.paid_at < $3 group by 1`, [ctx.unitId, from, to]);
  const cap = await q<{ d: string; c: number }>("select to_char(entry_date,'YYYY-MM-DD') as d, sum(amount_cents)::bigint as c from capital_entries where unit_id=$1 and account_id is not null and entry_date between $2::date and $3::date group by 1", [ctx.unitId, p.start, p.end]);
  const outs = await q<{ d: string; c: number }>(
    `select to_char(${LD("pp.paid_at")},'YYYY-MM-DD') as d, sum((case when pp.kind='pagamento' then 1 else -1 end) * pp.amount_cents)::bigint as c
     from payable_payments pp where pp.unit_id=$1 and pp.account_id is not null and pp.paid_at >= $2 and pp.paid_at < $3 group by 1`, [ctx.unitId, from, to]);
  const rows: FlowRow[] = [];
  let bal = opening;
  for (let d = p.start; d <= p.end && rows.length < 400; d = addDays(d, 1)) {
    const inflow = (ins.find((x) => x.d === d)?.c ?? 0) + (cap.find((x) => x.d === d)?.c ?? 0);
    const outflow = outs.find((x) => x.d === d)?.c ?? 0;
    bal += inflow - outflow;
    rows.push({ date: d, inflow, outflow, balance: bal, estimate: false });
  }
  const [pend] = await q<{ c: number }>(
    `select coalesce(sum(case when p.kind='recebimento' then p.amount_cents else -p.amount_cents end),0)::bigint as c from payments p where p.unit_id=$1 and p.status='registrado'`, [ctx.unitId]);

  // projeção (estimativa) a partir de hoje
  const nowBal = (await accountBalances(q, ctx.unitId)).reduce((a, c) => a + c.balance_cents, 0);
  let firstNegative: string | null = null;
  if (p.end >= today || projectDays > 0) {
    const horizon = addDays(today, projectDays);
    const rec = await q<{ d: string; c: number }>(
      `select to_char(greatest(r.due_date, $2::date),'YYYY-MM-DD') as d, sum(r.amount_due_cents - b.registered_cents)::bigint as c from receivables r join receivable_balances b on b.receivable_id=r.id
       where r.unit_id=$1 and r.status='ativo' and b.registered_cents < r.amount_due_cents and greatest(r.due_date,$2::date) <= $3::date group by 1`, [ctx.unitId, today, horizon]);
    const pay = await q<{ d: string; c: number }>(
      `select to_char(greatest(p.due_date, $2::date),'YYYY-MM-DD') as d, sum(p.amount_cents - b.paid_cents)::bigint as c from payables p join payable_balances b on b.payable_id=p.id
       where p.unit_id=$1 and p.status='ativo' and b.paid_cents < p.amount_cents and greatest(p.due_date,$2::date) <= $3::date group by 1`, [ctx.unitId, today, horizon]);
    let pb = nowBal;
    for (let d = today; d <= horizon; d = addDays(d, 1)) {
      const inflow = rec.find((x) => x.d === d)?.c ?? 0;
      const outflow = pay.find((x) => x.d === d)?.c ?? 0;
      pb += inflow - outflow;
      if (d > p.end) rows.push({ date: d, inflow, outflow, balance: pb, estimate: true });
      if (pb < 0 && !firstNegative) firstNegative = d;
    }
  }
  const note = ["Realizado: apenas recebimentos conferidos (confirmados/liquidados, líquidos de taxas), aportes e contas pagas.", "Estimativa: considera cobranças em aberto e contas a pagar nas datas de vencimento; é uma previsão, não um fato."];
  return { openingBalance: opening, rows, pendingConfirmation: pend.c, firstNegative, todayBalance: nowBal, note };
}

// ---------- metas ----------
export interface GoalProgress { id: string; name: string; kind: string; target: number; current: number; pct: number | null; expectedPct: number | null; status: "no_ritmo" | "atrasada" | "adiantada" | "atingida" | "sem_dados"; periodStart: string | null; periodEnd: string | null; isActive: boolean }

export async function goalsProgress(db: Db, ctx: Ctx): Promise<GoalProgress[]> {
  need(ctx, "finance.view");
  const q = db.query;
  const goals = await q<{ id: string; kind: string; name: string; target_cents: number; period_start: string | null; period_end: string | null; is_active: boolean }>(
    "select id, kind, name, target_cents, to_char(period_start,'YYYY-MM-DD') as period_start, to_char(period_end,'YYYY-MM-DD') as period_end, is_active from financial_goals where unit_id=$1 order by is_active desc, period_end nulls last", [ctx.unitId]);
  const today = todayYmd();
  const out: GoalProgress[] = [];
  for (const g of goals) {
    let current = 0;
    if (g.kind === "receita" && g.period_start && g.period_end) current = (await revenueStats(q, ctx.unitId, { start: g.period_start, end: g.period_end }, null)).revenue;
    else if (g.kind === "resultado" && g.period_start && g.period_end) current = (await computeDre(q, ctx.unitId, { start: g.period_start, end: g.period_end })).operatingResult;
    else if (g.kind === "reserva") current = (await accountBalances(q, ctx.unitId)).reduce((a, c) => a + c.balance_cents, 0);
    const pct = g.target_cents > 0 ? (current / g.target_cents) * 100 : null;
    let expected: number | null = null;
    if (g.period_start && g.period_end) {
      const total = daysBetween(g.period_start, g.period_end) + 1;
      const elapsed = Math.min(Math.max(daysBetween(g.period_start, today) + 1, 0), total);
      expected = (elapsed / total) * 100;
    }
    let status: GoalProgress["status"] = "sem_dados";
    if (pct != null) {
      if (pct >= 100) status = "atingida";
      else if (expected == null) status = "no_ritmo";
      else status = pct >= expected + 5 ? "adiantada" : pct < expected - 5 ? "atrasada" : "no_ritmo";
    }
    out.push({ id: g.id, name: g.name, kind: g.kind, target: g.target_cents, current, pct, expectedPct: expected, status, periodStart: g.period_start, periodEnd: g.period_end, isActive: g.is_active });
  }
  return out;
}

/** Simulação: quanto falta e quanto por dia/atendimento para atingir a meta de receita. */
export function simulateGoal(g: GoalProgress, avgTicketCents: number | null, today = todayYmd()) {
  if (!g.periodEnd || g.target <= g.current) return null;
  const daysLeft = Math.max(daysBetween(today, g.periodEnd) + 1, 1);
  const missing = g.target - g.current;
  return { missing, daysLeft, perDay: Math.ceil(missing / daysLeft), attendancesPerDay: avgTicketCents ? Math.ceil(missing / daysLeft / avgTicketCents * 10) / 10 : null };
}

