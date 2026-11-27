import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listReturns } from "@/server/services/eagle";
import { fmtYmd, todayYmd } from "@/lib/dates";
import { Badge, Empty, Flash, PageHead, Pager, Seg } from "@/components/ui";
import { ReturnKindBadge, ReturnStatusBadge } from "@/components/eagle-ui";

export const metadata = { title: "Retornos" };
const SIZE = 40;
const FILTERS = [["abertos", "Em aberto"], ["concluido", "Concluídos"], ["cancelado", "Cancelados"], ["todos", "Todos"]] as const;

export default async function Returns({ searchParams }: { searchParams: Promise<{ f?: string; p?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("returns.own", "returns.view_all", "returns.manage");
  const f = FILTERS.some(([k]) => k === sp.f) ? sp.f! : "abertos";
  const page = Math.max(1, Number(sp.p) || 1);
  const { rows, total } = await listReturns(await getDb(), ctx, { status: f, limit: SIZE, offset: (page - 1) * SIZE });
  const today = todayYmd();
  const all = can(ctx, "returns.view_all") || can(ctx, "returns.manage");
  return (
    <>
      <PageHead title="Retornos" sub={all ? "Garantias, manutenções periódicas e outras visitas de volta ao cliente." : "Os retornos que estão com você."}>
        {can(ctx, "returns.manage") ? <Link className="btn accent" href="/retornos/novo">+ Novo retorno</Link> : null}
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <Seg items={FILTERS.map(([k, label]) => ({ href: `/retornos?f=${k}`, label, active: f === k }))} />
      {rows.length === 0 ? (
        <Empty title={f === "abertos" ? "Nenhum retorno em aberto" : "Nenhum retorno aqui"}>
          {f === "abertos" ? "Retornos de garantia são criados sozinhos ao concluir uma ordem de serviço com garantia." : "Troque o filtro acima para ver os outros."}
        </Empty>
      ) : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Cliente</th><th>Tipo</th><th>Data prevista</th>{all ? <th>Técnico</th> : null}<th>Situação</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const late = (r.status === "pendente" || r.status === "agendado") && r.due_date < today;
                return (
                  <tr key={r.id}>
                    <td><Link href={`/retornos/${r.id}`}>{r.customer_name}</Link>{r.customer_phone ? <><br /><small>{r.customer_phone}</small></> : null}</td>
                    <td><ReturnKindBadge k={r.kind} /></td>
                    <td className="nowrap">{fmtYmd(r.due_date)} {late ? <Badge tone="bad">atrasado</Badge> : r.due_date === today && r.status === "pendente" ? <Badge tone="warn">hoje</Badge> : null}</td>
                    {all ? <td>{r.staff_name ?? <small>sem técnico</small>}</td> : null}
                    <td><ReturnStatusBadge s={r.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager base={`/retornos?f=${f}`} page={page} total={total} size={SIZE} />
    </>
  );
}
