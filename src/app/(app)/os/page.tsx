import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { listServiceOrders, OS_STATUS_LABEL } from "@/server/services/eagle";
import { fmtDateTime } from "@/lib/dates";
import { Empty, Flash, PageHead, Pager, Seg } from "@/components/ui";
import { OSPaymentBadge, OSStatusBadge } from "@/components/eagle-ui";

export const metadata = { title: "Ordens de serviço" };
const SIZE = 40;

export default async function Orders({ searchParams }: { searchParams: Promise<{ s?: string; p?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("agenda.manage", "agenda.view_all", "agenda.manage_own", "agenda.view_own");
  const s = sp.s && sp.s in OS_STATUS_LABEL ? sp.s : "";
  const page = Math.max(1, Number(sp.p) || 1);
  const { rows, total } = await listServiceOrders(await getDb(), ctx, { status: s || undefined, limit: SIZE, offset: (page - 1) * SIZE });
  return (
    <>
      <PageHead title="Ordens de serviço" sub="O registro de cada visita: pragas, produtos, áreas tratadas, pagamento e garantia. Abra a OS pelo agendamento." />
      <Flash ok={sp.ok} erro={sp.erro} />
      <Seg items={[{ href: "/os", label: "Todas", active: !s }, ...Object.entries(OS_STATUS_LABEL).map(([k, v]) => ({ href: `/os?s=${k}`, label: v, active: s === k }))]} />
      {rows.length === 0 ? (
        <Empty title="Nenhuma ordem de serviço aqui">Na Agenda, abra o agendamento e toque em &quot;Abrir ordem de serviço&quot;.</Empty>
      ) : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Nº</th><th>Cliente</th><th>Visita</th><th>Técnico</th><th>Serviços</th><th>Situação</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td className="mono"><Link href={`/os/${o.id}`}>#{o.number}</Link></td>
                  <td><Link href={`/os/${o.id}`}>{o.customer_name}</Link>{o.service_address ? <><br /><small>{o.service_address}</small></> : null}</td>
                  <td className="nowrap">{fmtDateTime(o.starts_at)}</td>
                  <td>{o.staff_name}</td>
                  <td>{o.services || "—"}</td>
                  <td><OSStatusBadge s={o.status} /> {o.status !== "cancelada" ? <OSPaymentBadge s={o.payment_status} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager base={s ? `/os?s=${s}` : "/os"} page={page} total={total} size={SIZE} />
    </>
  );
}
