import type { Db } from "../db";
import { audit, need, requireText } from "../core";
import { DomainError } from "../errors";
import type { Ctx } from "../permissions";
import { dayEndUtc, dayStartUtc, todayYmd, type Period } from "@/lib/dates";
import { computeDre } from "./reports";

export interface Check { key: string; label: string; passed: boolean; blocking: boolean; detail: string }

/** A15 — verifica se o período pode ser fechado. Bloqueantes impedem o fechamento; avisos não. */
export async function validateClosure(db: Db, ctx: Ctx, p: Period) {
  need(ctx, "finance.view");
  const q = db.query;
  const from = dayStartUtc(p.start), to = dayEndUtc(p.end);
  const checks: Check[] = [];
  const add = (key: string, label: string, n: number, blocking: boolean, ok: string, bad: (n: number) => string) =>
    checks.push({ key, label, passed: n === 0, blocking, detail: n === 0 ? ok : bad(n) });

  const today = todayYmd();
  checks.push({ key: "ended", label: "Período já terminou", passed: p.end < today, blocking: true, detail: p.end < today ? "OK" : "O período ainda não terminou." });
  const [prior] = await q<{ n: number }>(
    `select count(*)::bigint as n from period_closures pc where pc.unit_id=$1 and pc.status='fechado' and pc.period_start <= $3::date and pc.period_end >= $2::date
       and pc.version = (select max(version) from period_closures x where x.unit_id=pc.unit_id and x.period_start=pc.period_start)`, [ctx.unitId, p.start, p.end]);
  add("not_closed", "Período ainda não fechado", prior.n, true, "OK", () => "Já existe fechamento para este período. Reabra-o para fechar novamente.");

  const [a1] = await q<{ n: number }>("select count(*)::bigint as n from attendances a where a.unit_id=$1 and a.status='concluido' and a.finished_at >= $2 and a.finished_at < $3 and not exists (select 1 from receivables r where r.attendance_id=a.id)", [ctx.unitId, from, to]);
  add("no_receivable", "Todos os atendimentos concluídos têm cobrança", a1.n, true, "OK", (n) => `${n} atendimento(s) concluído(s) sem cobrança.`);
  const [a2] = await q<{ n: number }>("select count(*)::bigint as n from appointments where unit_id=$1 and status in ('agendado','em_atendimento') and starts_at >= $2 and starts_at < $3 and starts_at < now()", [ctx.unitId, from, to]);
  add("stale_appointments", "Sem agendamentos vencidos em aberto", a2.n, true, "OK", (n) => `${n} agendamento(s) do período continuam como Agendado/Em atendimento. Conclua, cancele ou marque ausência.`);
  const [a3] = await q<{ n: number }>("select count(*)::bigint as n from payments p where p.unit_id=$1 and p.kind='recebimento' and p.status='registrado' and p.paid_at >= $2 and p.paid_at < $3 and not exists (select 1 from payments x where x.reversal_of=p.id)", [ctx.unitId, from, to]);
  add("unconfirmed", "Todos os pagamentos foram conferidos", a3.n, true, "OK", (n) => `${n} pagamento(s) registrado(s) ainda sem conferência.`);
  const [a4] = await q<{ n: number }>("select count(*)::bigint as n from cash_sessions where unit_id=$1 and status='aberto' and opened_at < $2", [ctx.unitId, to]);
  add("open_cash", "Nenhum caixa aberto", a4.n, true, "OK", () => "Há caixa aberto. Feche-o antes de fechar o período.");
  const [w1] = await q<{ n: number }>("select count(*)::bigint as n from payments p join payment_methods m on m.id=p.method_id where p.unit_id=$1 and p.kind='recebimento' and p.status='confirmado' and m.kind <> 'dinheiro' and p.paid_at >= $2 and p.paid_at < $3 and not exists (select 1 from payments x where x.reversal_of=p.id)", [ctx.unitId, from, to]);
  add("unsettled", "Pagamentos confirmados já liquidados", w1.n, false, "OK", (n) => `${n} pagamento(s) confirmado(s) sem liquidação registrada.`);
  const [w2] = await q<{ n: number }>("select count(*)::bigint as n from receivables r join receivable_balances b on b.receivable_id=r.id where r.unit_id=$1 and r.status='ativo' and b.registered_cents < r.amount_due_cents and r.created_at >= $2 and r.created_at < $3", [ctx.unitId, from, to]);
  add("open_receivables", "Cobranças do período quitadas", w2.n, false, "OK", (n) => `${n} cobrança(s) do período ainda com saldo a receber (continuam como contas a receber).`);
  const [w3] = await q<{ n: number }>("select count(*)::bigint as n from payables p join payable_balances b on b.payable_id=p.id where p.unit_id=$1 and p.status='ativo' and b.paid_cents < p.amount_cents and p.due_date between $2::date and $3::date", [ctx.unitId, p.start, p.end]);
  add("open_payables", "Contas a pagar do período quitadas", w3.n, false, "OK", (n) => `${n} conta(s) a pagar do período em aberto (competência permanece no mês).`);

  const dre = await computeDre(q, ctx.unitId, p);
  const ready = checks.filter((c) => c.blocking).every((c) => c.passed);
  return { ready, checks, dre };
}

export async function closePeriod(db: Db, ctx: Ctx, p: Period) {
  need(ctx, "finance.close_period");
  const v = await validateClosure(db, ctx, p);
  if (!v.ready) throw new DomainError("not_ready", "O período não pode ser fechado: " + v.checks.filter((c) => c.blocking && !c.passed).map((c) => c.detail).join(" "), v);
  return db.tx(async (q) => {
    const [ver] = await q<{ v: number }>("select coalesce(max(version),0)::bigint + 1 as v from period_closures where unit_id=$1 and period_start=$2::date", [ctx.unitId, p.start]);
    const snapshot = { dre: v.dre, checks: v.checks, closedAt: new Date().toISOString(), generatedBy: ctx.userId };
    const [c] = await q<{ id: string }>("insert into period_closures(unit_id,period_start,period_end,version,snapshot,closed_by) values ($1,$2,$3,$4,$5,$6) returning id", [ctx.unitId, p.start, p.end, ver.v, JSON.stringify(snapshot), ctx.userId]);
    await audit(q, ctx, "PERIODO_FECHADO", "period_closure", c.id, null, { period: p, version: ver.v, netResult: v.dre.netResult });
    return c.id;
  });
}

export async function reopenPeriod(db: Db, ctx: Ctx, closureId: string, reason: string) {
  need(ctx, "finance.close_period");
  const why = requireText(reason, "Motivo da reabertura", 5);
  await db.tx(async (q) => {
    const [c] = await q<{ status: string }>("select status from period_closures where id=$1 and unit_id=$2 for update", [closureId, ctx.unitId]);
    if (!c) throw new DomainError("not_found", "Fechamento não encontrado.");
    if (c.status !== "fechado") throw new DomainError("bad_status", "Este fechamento já foi reaberto.");
    await q("update period_closures set status='reaberto' where id=$1", [closureId]);
    await audit(q, ctx, "PERIODO_REABERTO", "period_closure", closureId, null, null, why);
  });
}

export async function listClosures(db: Db, ctx: Ctx) {
  need(ctx, "finance.view");
  return db.query<{ id: string; period_start: string; period_end: string; version: number; status: string; closed_at: Date; closed_by_name: string; snapshot: { dre: { netRevenue: number; operatingResult: number; netResult: number } } }>(
    `select pc.id, to_char(pc.period_start,'YYYY-MM-DD') as period_start, to_char(pc.period_end,'YYYY-MM-DD') as period_end, pc.version, pc.status, pc.closed_at, u.full_name as closed_by_name, pc.snapshot
     from period_closures pc join users u on u.id=pc.closed_by where pc.unit_id=$1 order by pc.period_start desc, pc.version desc`, [ctx.unitId]);
}
