import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listServiceOrders, OS_STATUS_LABEL } from "@/server/services/eagle";
import { fmtYmd } from "@/lib/dates";
import { Empty, Flash, PageHead, Pager, Seg, money } from "@/components/ui";
import { OSPaymentBadge, OSStatusBadge } from "@/components/eagle-ui";
import { importServiceOrderAction } from "@/app/actions/eagle";

export const metadata = { title: "Ordens de serviço" };
const SIZE = 40;

export default async function Orders({ searchParams }: { searchParams: Promise<{ s?: string; p?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("agenda.manage", "agenda.view_all", "agenda.manage_own", "agenda.view_own");
  const s = sp.s && sp.s in OS_STATUS_LABEL ? sp.s : "";
  const page = Math.max(1, Number(sp.p) || 1);
  const { rows, total } = await listServiceOrders(await getDb(), ctx, { status: s || undefined, limit: SIZE, offset: (page - 1) * SIZE });
  const manage = can(ctx, "agenda.manage") && can(ctx, "customers.manage");
  return (
    <>
      <PageHead title="Ordens de serviço" sub="No modelo da Eagle: abra pelo agendamento, crie avulsa ou importe um arquivo antigo (Word ou PDF).">
        {can(ctx, "agenda.manage") ? <Link className="btn accent" href="/os/nova">+ Nova OS</Link> : null}
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      {manage ? (
        <details className="card confirm neutral">
          <summary>Importar OS de um arquivo (.docx ou .pdf)</summary>
          <form action={importServiceOrderAction} className="form">
            <input type="file" name="file" accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required />
            <small>O sistema lê os campos do modelo (cliente, fone, data, serviços, dados do cliente, valor, laudo, situação…), acha ou cadastra o cliente e guarda o arquivo original na ficha dele. Depois é só conferir e salvar. Até 5 MB.</small>
            <div><button className="btn" type="submit">Importar</button></div>
          </form>
        </details>
      ) : null}
      <Seg items={[{ href: "/os", label: "Todas", active: !s }, ...Object.entries(OS_STATUS_LABEL).map(([k, v]) => ({ href: `/os?s=${k}`, label: v, active: s === k }))]} />
      {rows.length === 0 ? (
        <Empty title="Nenhuma ordem de serviço aqui">Na Agenda, abra o agendamento e toque em &quot;Abrir ordem de serviço&quot;, ou importe um arquivo acima.</Empty>
      ) : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Nº</th><th>Cliente</th><th>Data</th><th>Serviços</th><th className="n">Valor</th><th>Situação</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td className="mono"><Link href={`/os/${o.id}`}>#{o.number}</Link></td>
                  <td><Link href={`/os/${o.id}`}>{o.trade_name || o.customer_name}</Link>{o.staff_name ? <><br /><small>{o.staff_name}</small></> : null}</td>
                  <td className="nowrap">{o.service_date ? fmtYmd(o.service_date) : "—"}{o.service_time ? <><br /><small>{o.service_time}</small></> : null}</td>
                  <td>{o.services || "—"}</td>
                  <td className="n">{money(o.total_cents)}</td>
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
