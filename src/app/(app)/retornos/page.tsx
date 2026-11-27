import Link from "next/link";
import { getDb } from "@/server/db";
import { requireSession } from "@/server/session";
import { can } from "@/server/core";
import { listReturns } from "@/server/services/eagle";
import { fmtYmd, todayYmd } from "@/lib/dates";

export const metadata = { title: "Retornos" };

export default async function Returns() {
  const { ctx } = await requireSession();
  const db = await getDb();
  if (!can(ctx, "returns.own") && !can(ctx, "returns.view_all")) throw new Error("Sem permissão");
  const { rows } = await listReturns(db, ctx, { limit: 50 });
  const today = todayYmd();
  const dateStr = (d: Date) => d.toISOString().split("T")[0];
  const isLate = (dueDate: Date) => dateStr(dueDate) <= today;
  const isOpen = (status: string) => status === "pendente" || status === "agendado";

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <h1>Retornos (Garantia, Manutenção, Outros)</h1>
      </div>

      {rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "#666" }}>
          <p>Nenhum retorno criado.</p>
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #ddd" }}>
              <th style={{ textAlign: "left", padding: "12px" }}>Cliente</th>
              <th style={{ textAlign: "left", padding: "12px" }}>Tipo</th>
              <th style={{ textAlign: "left", padding: "12px" }}>Vencimento</th>
              <th style={{ textAlign: "center", padding: "12px" }}>Situação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "12px" }}>
                  {can(ctx, "customers.view") ? (
                    <Link href={`/clientes/${r.customerId}`} style={{ textDecoration: "none", color: "#0066cc" }}>
                      {r.customer_name}
                    </Link>
                  ) : (
                    r.customer_name
                  )}
                </td>
                <td style={{ padding: "12px" }}>
                  {r.kind === "garantia" ? "Garantia" : r.kind === "manutencao" ? "Manutenção" : "Outro"}
                </td>
                <td style={{ padding: "12px", color: isLate(r.dueDate) && isOpen(r.status) ? "#d32f2f" : "inherit" }}>
                  {fmtYmd(dateStr(r.dueDate))} {isLate(r.dueDate) && isOpen(r.status) ? "⚠️ ATRASADO" : ""}
                </td>
                <td style={{ padding: "12px", textAlign: "center" }}>
                  <span
                    style={{
                      padding: "4px 8px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      backgroundColor:
                        r.status === "concluido" ? "#4caf50" : r.status === "cancelado" ? "#9e9e9e" : r.status === "agendado" ? "#2196f3" : "#ffc107",
                      color: "white",
                    }}
                  >
                    {r.status === "pendente"
                      ? "Pendente"
                      : r.status === "agendado"
                        ? "Agendado"
                        : r.status === "concluido"
                          ? "Concluído"
                          : "Cancelado"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
