import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { listAttendances } from "@/server/services/attendance";
import { addDays, dayEndUtc, dayStartUtc, fmtDateTime, todayYmd } from "@/lib/dates";
import { ApptBadge, Empty, Flash, PageHead, PayBadge, Pager, money } from "@/components/ui";

export const metadata = { title: "Atendimentos" };
const SIZE = 30;

export default async function Attendances({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; st?: string; p?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("attendance.view_all", "attendance.view_own");
  const today = todayYmd();
  const de = /^\d{4}-\d{2}-\d{2}$/.test(sp.de ?? "") ? sp.de! : addDays(today, -6);
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(sp.ate ?? "") ? sp.ate! : today;
  const page = Math.max(1, Number(sp.p) || 1);
  const { rows, total } = await listAttendances(await getDb(), ctx, { from: dayStartUtc(de), to: dayEndUtc(ate), status: sp.st || undefined, limit: SIZE, offset: (page - 1) * SIZE });
  const base = `/atendimentos?de=${de}&ate=${ate}${sp.st ? `&st=${sp.st}` : ""}`;
  return (
    <>
      <PageHead title="Atendimentos" sub="Execução e cobrança. O estado operacional é separado do estado financeiro." />
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="filters" method="get">
        <label>De<input type="date" name="de" defaultValue={de} /></label>
        <label>Até<input type="date" name="ate" defaultValue={ate} /></label>
        <label>Situação<select name="st" defaultValue={sp.st ?? ""}><option value="">Todas</option><option value="iniciado">Em andamento</option><option value="concluido">Concluídos</option><option value="cancelado">Cancelados</option></select></label>
        <button className="btn ghost" type="submit">Filtrar</button>
      </form>
      {rows.length === 0 ? <Empty title="Nenhum atendimento no período">Atendimentos aparecem aqui quando iniciados pela agenda.</Empty> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Início</th><th>Cliente</th><th>Profissional</th><th>Situação</th><th>Financeiro</th><th className="n">Total</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap"><Link href={`/atendimentos/${a.id}`}>{fmtDateTime(a.started_at)}</Link></td>
                  <td>{a.customer_name}</td><td>{a.staff_name}</td>
                  <td><ApptBadge s={a.status} /></td>
                  <td>{a.status === "concluido" ? <PayBadge s={a.pay_status} /> : <small>—</small>}</td>
                  <td className="n">{money(a.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager base={base} page={page} total={total} size={SIZE} />
    </>
  );
}
