import { getDb } from "@/server/db";
import { currentSession } from "@/server/session";
import { addDays, dayEndUtc, dayStartUtc, todayYmd } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * "Versão" da agenda: um resumo (hash) dos agendamentos e bloqueios de ontem até daqui a 3 semanas.
 * A tela compara com o valor anterior e só recarrega quando algo mudou — em outro aparelho, por exemplo.
 * Não devolve nenhum dado de cliente.
 */
export async function GET() {
  const s = await currentSession();
  if (!s?.mfaVerified) return new Response(null, { status: 401 });
  const t = todayYmd();
  const [r] = await (await getDb()).query<{ v: string | null }>(
    `select md5(coalesce((select string_agg(id::text || status || starts_at::text || ends_at::text || staff_id::text || coalesce(chair_id::text,'') || coalesce(service_address,'')
         || coalesce((select string_agg(h.staff_id::text, '' order by h.staff_id) from appointment_helpers h where h.appointment_id=appointments.id),''), ',' order by id)
       from appointments where unit_id=$1 and starts_at >= $2 and starts_at < $3), '')
     || coalesce((select string_agg(id::text || starts_at::text || ends_at::text, ',' order by id) from schedule_blocks where unit_id=$1 and ends_at >= $2 and starts_at < $3), '')) as v`,
    [s.ctx.unitId, dayStartUtc(addDays(t, -1)), dayEndUtc(addDays(t, 21))]);
  return Response.json({ v: r?.v ?? "" }, { headers: { "cache-control": "no-store" } });
}
