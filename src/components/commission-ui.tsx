import Link from "next/link";
import type { EntryRow } from "@/server/services/commissions";
import { fmtDateTime } from "@/lib/dates";
import { fmtPct } from "@/lib/money";
import { Badge, Empty, money } from "./ui";

export const STATE: Record<string, ["" | "ok" | "warn" | "info" | "bad", string]> = { pendente: ["warn", "Pendente"], exigivel: ["info", "A receber"], aprovada: ["info", "Aprovada"], paga: ["ok", "Paga"], cancelada: ["", "Cancelada"], aprovado: ["info", "Aprovado"], parcial: ["warn", "Pago em parte"], pago: ["ok", "Pago"], cancelado: ["", "Cancelado"] };
export const StateBadge = ({ s }: { s: string }) => <Badge tone={STATE[s]?.[0]}>{STATE[s]?.[1] ?? s}</Badge>;

export function Entries({ rows, staff }: { rows: EntryRow[]; staff?: boolean }) {
  if (!rows.length) return <Empty title="Nenhuma comissão neste filtro" />;
  return (
    <div className="tablewrap"><table className="rtable">
      <thead><tr><th>Data</th><th>Item</th>{staff ? <th>Profissional</th> : null}<th className="n">Valor</th><th className="n">Base</th><th className="n">%</th><th className="n">Comissão</th><th>Situação</th></tr></thead>
      <tbody>{rows.map((e) => (
        <tr key={e.id} className={e.state === "cancelada" ? "dim" : ""}>
          <td className="nowrap">{fmtDateTime(e.reference_at)}</td>
          <td className="full">{e.attendance_id ? <Link href={`/atendimentos/${e.attendance_id}`}>{e.description}</Link> : e.description} <small>· {e.kind === "produto" ? "produto" : "serviço"}{e.customer_name ? ` · ${e.customer_name}` : ""}</small></td>
          {staff ? <td>{e.staff_name}</td> : null}
          <td className="n" data-l="Valor">{money(e.gross_cents)}</td>
          <td className="n" data-l="Base">{money(e.base_cents)}<br /><small>{e.base === "liquido" ? "após desconto" : "bruto"}</small></td>
          <td className="n" data-l="%">{fmtPct(e.pct_bps / 100, e.pct_bps % 100 ? 2 : 0)}</td>
          <td className="n" data-l="Comissão"><b>{money(e.amount_cents + e.adj_cents)}</b>{e.adj_cents ? <><br /><small>ajuste {money(e.adj_cents)}</small></> : null}</td>
          <td><StateBadge s={e.state} /></td>
        </tr>))}</tbody>
    </table></div>
  );
}
