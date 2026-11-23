import type { Db, Q } from "../db";
import type { Ctx } from "../permissions";
import { evaluateRecords } from "./achievements";
import { refreshReturn } from "./returns";
import { syncCommissions } from "./commissions";

export type EventType =
  | "task.assigned" | "task.updated" | "task.completed" | "task.overdue"
  | "appointment.completed" | "appointment.cancelled" | "product.sold" | "product.refunded"
  | "commission.generated" | "commission.approved" | "commission.paid"
  | "return.due" | "return.contacted" | "record.achieved" | "receivable.cancelled";

/** Grava o evento na mesma transação da operação. A chave `dedupe` impede repetição. */
export async function emit(q: Q, ctx: Pick<Ctx, "unitId"> & { userId?: string | null }, type: EventType, entity: string, entityId: string, payload: Record<string, unknown> = {}, dedupe?: string, source = "sistema") {
  await q(
    "insert into domain_events(unit_id,type,entity,entity_id,source,actor_id,payload,dedupe_key) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (dedupe_key) do nothing",
    [ctx.unitId, type, entity, entityId, source, ctx.userId ?? null, JSON.stringify(payload), dedupe ?? null],
  );
}

interface EventRow { id: string; unit_id: string; type: EventType; entity_id: string; payload: Record<string, string> }

async function handle(q: Q, e: EventRow): Promise<unknown> {
  switch (e.type) {
    case "appointment.completed":
      await refreshReturn(q, e.unit_id, e.payload.customerId);
      return { records: await evaluateRecords(q, e.unit_id, e.payload.staffId) };
    case "appointment.cancelled":
      await refreshReturn(q, e.unit_id, e.payload.customerId);
      return {};
    case "product.sold":
    case "product.refunded":
      return { records: await evaluateRecords(q, e.unit_id, e.payload.staffId) };
    case "receivable.cancelled":
      await syncCommissions(q, e.unit_id, e.entity_id);
      return e.payload.staffId ? { records: await evaluateRecords(q, e.unit_id, e.payload.staffId) } : {};
    default:
      return {}; // eventos de registro: nada a reagir além do rastro
  }
}

/** Processa eventos pendentes, um por transação, com trava (duas execuções simultâneas não repetem o mesmo evento). */
export async function processEvents(db: Db, limit = 50): Promise<{ processed: number; failed: number }> {
  let processed = 0, failed = 0;
  for (let i = 0; i < limit; i++) {
    let current: EventRow | undefined;
    try {
      const done = await db.tx(async (q) => {
        const [e] = await q<EventRow>(
          "select id, unit_id, type, entity_id, payload from domain_events where status='pendente' and attempts < 5 and (attempts = 0 or processed_at < now() - interval '2 minutes') order by created_at limit 1 for update skip locked");
        if (!e) return true;
        current = e;
        const result = await handle(q, e);
        await q("update domain_events set status='processado', attempts=attempts+1, processed_at=now(), result=$2 where id=$1", [e.id, JSON.stringify(result ?? null)]);
        return false;
      });
      if (done) break;
      processed++;
    } catch (err) {
      if (!current) throw err;
      failed++;
      await db.query("update domain_events set attempts=attempts+1, processed_at=now(), error=$2, status=case when attempts+1 >= 5 then 'erro' else 'pendente' end where id=$1", [current.id, (err as Error).message.slice(0, 500)]);
    }
  }
  return { processed, failed };
}
