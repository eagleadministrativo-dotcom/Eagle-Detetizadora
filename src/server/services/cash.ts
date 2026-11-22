import type { Db, Q } from "../db";
import { audit, finishAutomation, need, requirePositive, requireText } from "../core";
import { DomainError } from "../errors";
import type { Ctx } from "../permissions";

export interface OpenSession { id: string; account_id: string; opening_declared_cents: number; opened_at: Date }

export async function findOpenSession(q: Q, unitId: string): Promise<OpenSession | null> {
  const [s] = await q<OpenSession>("select id, account_id, opening_declared_cents, opened_at from cash_sessions where unit_id=$1 and status='aberto' order by opened_at limit 1", [unitId]);
  return s ?? null;
}

async function cashMethodId(q: Q, unitId: string): Promise<string> {
  const [m] = await q<{ id: string }>("select id from payment_methods where unit_id=$1 and kind='dinheiro' and is_active order by sort_order limit 1", [unitId]);
  if (!m) throw new DomainError("no_cash_method", "Cadastre uma forma de pagamento do tipo Dinheiro.");
  return m.id;
}

export interface MethodTotal { method_id: string; name: string; kind: string; expected_cents: number }

export async function expectedByMethod(q: Q, sessionId: string): Promise<MethodTotal[]> {
  const [s] = await q<{ unit_id: string; opening_declared_cents: number }>("select unit_id, opening_declared_cents from cash_sessions where id=$1", [sessionId]);
  if (!s) throw new DomainError("not_found", "Sessão de caixa não encontrada.");
  const rows = await q<MethodTotal>(
    `select m.id as method_id, m.name, m.kind,
       (coalesce((select sum(cm.amount_cents * cm.direction) from cash_movements cm where cm.cash_session_id=$1 and cm.method_id=m.id),0)
        + case when m.kind='dinheiro' then $3 else 0 end)::bigint as expected_cents
     from payment_methods m
     where m.unit_id=$2 and (m.kind='dinheiro' or exists (select 1 from cash_movements cm where cm.cash_session_id=$1 and cm.method_id=m.id))
     order by m.sort_order, m.name`,
    [sessionId, s.unit_id, s.opening_declared_cents],
  );
  // dinheiro: considera apenas a primeira forma de dinheiro para o saldo inicial
  let seenCash = false;
  return rows.map((r) => {
    if (r.kind !== "dinheiro") return r;
    if (!seenCash) { seenCash = true; return r; }
    return { ...r, expected_cents: r.expected_cents - s.opening_declared_cents };
  });
}

export async function openCash(db: Db, ctx: Ctx, input: { accountId?: string | null; declaredCents: number }) {
  need(ctx, "cash.manage");
  if (!Number.isInteger(input.declaredCents) || input.declaredCents < 0) throw new DomainError("invalid", "Saldo inicial inválido.");
  return db.tx(async (q) => {
    let accountId = input.accountId ?? null;
    if (!accountId) {
      const [a] = await q<{ id: string }>("select id from financial_accounts where unit_id=$1 and kind='caixa' and is_active order by name limit 1", [ctx.unitId]);
      if (!a) throw new DomainError("no_account", "Cadastre uma conta do tipo Caixa.");
      accountId = a.id;
    }
    const open = await findOpenSession(q, ctx.unitId);
    if (open) throw new DomainError("already_open", "Já existe um caixa aberto. Feche-o antes de abrir outro.");
    const [prev] = await q<{ closing_declared: { method_id: string; kind: string; declared_cents: number }[] | null }>(
      "select closing_declared from cash_sessions where account_id=$1 and status='fechado' order by closed_at desc limit 1", [accountId]);
    const [s] = await q<{ id: string }>("insert into cash_sessions(unit_id,account_id,opened_by,opening_declared_cents) values ($1,$2,$3,$4) returning id", [ctx.unitId, accountId, ctx.userId, input.declaredCents]);
    const prevCash = prev?.closing_declared?.filter((d) => d.kind === "dinheiro").reduce((a, d) => a + d.declared_cents, 0);
    if (prevCash != null && prevCash !== input.declaredCents) {
      await q("insert into notifications(unit_id,kind,severity,message,ref_entity,ref_id,dedupe_key) values ($1,'abertura_divergente','atencao',$2,'cash_session',$3,$4)", [
        ctx.unitId, `Saldo inicial declarado difere do último fechamento (${prevCash / 100} → ${input.declaredCents / 100}).`, s.id, `opendiff:${s.id}`,
      ]);
    }
    await audit(q, ctx, "CAIXA_ABERTO", "cash_session", s.id, null, { declared: input.declaredCents });
    return s.id;
  });
}

export async function addCashMovement(db: Db, ctx: Ctx, input: { kind: "sangria" | "suprimento"; amountCents: number; description: string; idempotencyKey: string }) {
  need(ctx, "cash.manage");
  requirePositive(input.amountCents, "Valor");
  const description = requireText(input.description, "Descrição", 3);
  return db.tx(async (q) => {
    const [dup] = await q<{ id: string }>("select id from cash_movements where idempotency_key=$1", [input.idempotencyKey]);
    if (dup) return dup.id;
    const s = await findOpenSession(q, ctx.unitId);
    if (!s) throw new DomainError("cash_closed", "Abra o caixa antes de lançar movimentações.");
    const methodId = await cashMethodId(q, ctx.unitId);
    if (input.kind === "sangria") {
      const totals = await expectedByMethod(q, s.id);
      const cash = totals.filter((t) => t.kind === "dinheiro").reduce((a, t) => a + t.expected_cents, 0);
      if (input.amountCents > cash) throw new DomainError("insufficient_cash", "A sangria é maior que o dinheiro esperado no caixa.");
    }
    const [m] = await q<{ id: string }>(
      "insert into cash_movements(unit_id,cash_session_id,kind,method_id,amount_cents,direction,description,idempotency_key,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id",
      [ctx.unitId, s.id, input.kind, methodId, input.amountCents, input.kind === "sangria" ? -1 : 1, description, input.idempotencyKey, ctx.userId],
    );
    await audit(q, ctx, input.kind === "sangria" ? "SANGRIA" : "SUPRIMENTO", "cash_movement", m.id, null, { amount: input.amountCents, description });
    return m.id;
  });
}

export async function closeCash(db: Db, ctx: Ctx, sessionId: string, input: { declared: Record<string, number>; justification?: string }) {
  need(ctx, "cash.manage");
  return db.tx(async (q) => {
    const [s] = await q<{ status: string; unit_id: string }>("select status, unit_id from cash_sessions where id=$1 and unit_id=$2 for update", [sessionId, ctx.unitId]);
    if (!s) throw new DomainError("not_found", "Sessão de caixa não encontrada.");
    if (s.status !== "aberto") throw new DomainError("already_closed", "Este caixa já foi fechado.");
    const totals = await expectedByMethod(q, sessionId);
    const missing = totals.filter((t) => typeof input.declared[t.method_id] !== "number" || !Number.isInteger(input.declared[t.method_id]) || input.declared[t.method_id] < 0);
    if (missing.length) throw new DomainError("missing_declared", `Informe o valor contado de: ${missing.map((m) => m.name).join(", ")}.`);
    const declaredRows = totals.map((t) => ({ method_id: t.method_id, name: t.name, kind: t.kind, declared_cents: input.declared[t.method_id] }));
    const expectedRows = totals.map((t) => ({ method_id: t.method_id, name: t.name, kind: t.kind, expected_cents: t.expected_cents }));
    const diff = totals.reduce((a, t) => a + (input.declared[t.method_id] - t.expected_cents), 0);
    const anyDiff = totals.some((t) => input.declared[t.method_id] !== t.expected_cents);
    const justification = input.justification?.trim() ?? "";
    if (anyDiff && justification.length < 5) throw new DomainError("justification_required", "Há diferença no caixa: informe a justificativa para fechar.");
    await q(
      "update cash_sessions set status='fechado', closed_by=$2, closed_at=now(), closing_declared=$3, closing_expected=$4, difference_cents=$5, justification=$6 where id=$1",
      [sessionId, ctx.userId, JSON.stringify(declaredRows), JSON.stringify(expectedRows), diff, justification || null],
    );
    if (anyDiff) {
      await q("insert into notifications(unit_id,kind,severity,message,ref_entity,ref_id,dedupe_key) values ($1,'diferenca_caixa','atencao',$2,'cash_session',$3,$4) on conflict (dedupe_key) do nothing", [
        ctx.unitId, `Caixa fechado com diferença de ${(diff / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`, sessionId, `cashdiff:${sessionId}`,
      ]);
    }
    await finishAutomation(q, "A06", ctx.unitId, `close:${sessionId}`, "FECHAMENTO_CAIXA", { sessionId }, { diff, anyDiff });
    await audit(q, ctx, "CAIXA_FECHADO", "cash_session", sessionId, null, { diff, justification });
    return { diff, anyDiff };
  });
}

export async function addCashCorrection(db: Db, ctx: Ctx, sessionId: string, note: string) {
  need(ctx, "cash.manage");
  const text = requireText(note, "Correção", 5);
  await db.tx(async (q) => {
    const [s] = await q<{ status: string }>("select status from cash_sessions where id=$1 and unit_id=$2 for update", [sessionId, ctx.unitId]);
    if (!s) throw new DomainError("not_found", "Sessão de caixa não encontrada.");
    if (s.status !== "fechado") throw new DomainError("bad_status", "Só é possível registrar correções em caixas fechados.");
    await q("update cash_sessions set corrections = corrections || $2::jsonb where id=$1", [sessionId, JSON.stringify([{ at: new Date().toISOString(), by: ctx.userId, note: text }])]);
    await audit(q, ctx, "CAIXA_CORRECAO", "cash_session", sessionId, null, { note: text });
  });
}

export interface CashSessionRow {
  id: string; status: string; opened_at: Date; closed_at: Date | null; opening_declared_cents: number; difference_cents: number | null;
  justification: string | null; opened_by_name: string; closed_by_name: string | null; account_name: string;
}
export async function listCashSessions(db: Db, ctx: Ctx, limit = 30): Promise<CashSessionRow[]> {
  need(ctx, "cash.manage", "finance.view");
  return db.query<CashSessionRow>(
    `select cs.id, cs.status, cs.opened_at, cs.closed_at, cs.opening_declared_cents, cs.difference_cents, cs.justification,
       uo.full_name as opened_by_name, uc.full_name as closed_by_name, fa.name as account_name
     from cash_sessions cs join users uo on uo.id=cs.opened_by left join users uc on uc.id=cs.closed_by join financial_accounts fa on fa.id=cs.account_id
     where cs.unit_id=$1 order by cs.opened_at desc limit $2`,
    [ctx.unitId, limit],
  );
}

export async function getCashSession(db: Db, ctx: Ctx, sessionId: string) {
  need(ctx, "cash.manage", "finance.view");
  const [s] = await db.query<Record<string, any>>("select cs.*, fa.name as account_name from cash_sessions cs join financial_accounts fa on fa.id=cs.account_id where cs.id=$1 and cs.unit_id=$2", [sessionId, ctx.unitId]);
  if (!s) throw new DomainError("not_found", "Sessão de caixa não encontrada.");
  const movements = await db.query<{ id: string; kind: string; amount_cents: number; direction: number; description: string | null; created_at: Date; method_name: string | null; by_name: string }>(
    `select cm.id, cm.kind, cm.amount_cents, cm.direction, cm.description, cm.created_at, m.name as method_name, u.full_name as by_name
     from cash_movements cm left join payment_methods m on m.id=cm.method_id join users u on u.id=cm.created_by where cm.cash_session_id=$1 order by cm.created_at`,
    [sessionId],
  );
  const totals = await expectedByMethod(db.query, sessionId);
  return { session: s, movements, totals };
}
