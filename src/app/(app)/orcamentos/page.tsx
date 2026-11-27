import { getDb } from "@/server/db";
import { requireSession } from "@/server/session";
import { can } from "@/server/core";
import { listQuotes } from "@/server/services/eagle";
import Link from "next/link";

export const metadata = { title: "Orçamentos" };

export default async function QuotesPage() {
  const { ctx } = await requireSession();
  if (!can(ctx, "quotes.view")) throw new Error("Sem permissão");
  const { rows } = await listQuotes(await getDb(), ctx, { limit: 50 });

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <h1>Orçamentos</h1>
        {can(ctx, "quotes.manage") ? (
          <Link href="/orcamentos/novo" style={{ padding: "8px 16px", background: "#0066cc", color: "white", borderRadius: "4px", textDecoration: "none" }}>
            + Novo orçamento
          </Link>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#666" }}>Nenhum orçamento criado.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #ddd" }}>
              <th style={{ textAlign: "left", padding: "12px" }}>Nº</th>
              <th style={{ textAlign: "left", padding: "12px" }}>Cliente</th>
              <th style={{ textAlign: "left", padding: "12px" }}>Data</th>
              <th style={{ textAlign: "right", padding: "12px" }}>Total</th>
              <th style={{ textAlign: "center", padding: "12px" }}>Situação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "12px" }}>#{r.number}</td>
                <td style={{ padding: "12px" }}>{r.customer_name}</td>
                <td style={{ padding: "12px" }}>{r.issueDate ? new Date(r.issueDate).toLocaleDateString("pt-BR") : "-"}</td>
                <td style={{ padding: "12px", textAlign: "right" }}>
                  {((r.total_items_cents - r.discountCents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </td>
                <td style={{ padding: "12px", textAlign: "center" }}>
                  <span style={{ padding: "4px 8px", borderRadius: "4px", fontSize: "12px", backgroundColor: "#ffc107", color: "white" }}>
                    {r.status === "rascunho"
                      ? "Rascunho"
                      : r.status === "enviado"
                        ? "Enviado"
                        : r.status === "aprovado"
                          ? "Aprovado"
                          : "Recusado"}
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
