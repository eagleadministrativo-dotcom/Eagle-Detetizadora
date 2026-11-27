import { getDb } from "@/server/db";
import { requireSession } from "@/server/session";
import { can, need } from "@/server/core";
import { listFinanceEntries } from "@/server/services/eagle";
import { saveFinanceEntryAction } from "@/app/actions/eagle";

export const metadata = { title: "Financeiro" };

export default async function Finance() {
  const { ctx } = await requireSession();
  need(ctx, "finance.view");
  const db = await getDb();
  const { rows } = await listFinanceEntries(db, ctx, { limit: 50 });

  const receitas = rows.filter((r) => r.kind === "receita");
  const gastos = rows.filter((r) => r.kind === "gasto");
  const totalReceitas = receitas.reduce((sum, r) => sum + r.amountCents, 0);
  const totalGastos = gastos.reduce((sum, r) => sum + r.amountCents, 0);
  const saldo = totalReceitas - totalGastos;

  return (
    <div className="page">
      <h1>Financeiro</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "24px" }}>
        <div style={{ padding: "16px", background: "#e8f5e9", borderRadius: "4px" }}>
          <div style={{ fontSize: "12px", color: "#666" }}>Receitas</div>
          <div style={{ fontSize: "24px", fontWeight: "bold", color: "#2e7d32" }}>
            {(totalReceitas / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </div>
        </div>
        <div style={{ padding: "16px", background: "#ffebee", borderRadius: "4px" }}>
          <div style={{ fontSize: "12px", color: "#666" }}>Gastos</div>
          <div style={{ fontSize: "24px", fontWeight: "bold", color: "#c62828" }}>
            {(totalGastos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </div>
        </div>
        <div style={{ padding: "16px", background: "#f3e5f5", borderRadius: "4px" }}>
          <div style={{ fontSize: "12px", color: "#666" }}>Saldo</div>
          <div style={{ fontSize: "24px", fontWeight: "bold", color: saldo >= 0 ? "#2e7d32" : "#c62828" }}>
            {(saldo / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </div>
        </div>
      </div>

      {can(ctx, "finance.manage") ? (
        <details style={{ marginBottom: "24px", padding: "12px", border: "1px solid #ddd", borderRadius: "4px" }}>
          <summary style={{ cursor: "pointer", fontWeight: "bold" }}>+ Novo lançamento</summary>
          <form action={saveFinanceEntryAction} style={{ marginTop: "12px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
              <select name="kind" defaultValue="receita" required style={{ padding: "6px", borderRadius: "4px", border: "1px solid #ddd" }}>
                <option value="receita">Receita</option>
                <option value="gasto">Gasto</option>
              </select>
              <input name="category" type="text" placeholder="Categoria" required style={{ padding: "6px", borderRadius: "4px", border: "1px solid #ddd" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px", marginBottom: "12px" }}>
              <input name="description" type="text" placeholder="Descrição" required style={{ padding: "6px", borderRadius: "4px", border: "1px solid #ddd" }} />
              <input name="entryDate" type="date" defaultValue={new Date().toISOString().split("T")[0]} required style={{ padding: "6px", borderRadius: "4px", border: "1px solid #ddd" }} />
            </div>
            <div style={{ marginBottom: "12px" }}>
              <input name="amount" type="text" placeholder="Valor (ex: 100,00)" required style={{ width: "100%", padding: "6px", borderRadius: "4px", border: "1px solid #ddd" }} />
            </div>
            <button type="submit" style={{ padding: "8px 16px", background: "#0066cc", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}>
              Lançar
            </button>
          </form>
        </details>
      ) : null}

      <div style={{ marginBottom: "24px" }}>
        <h2>Últimos lançamentos</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #ddd" }}>
              <th style={{ textAlign: "left", padding: "8px" }}>Data</th>
              <th style={{ textAlign: "left", padding: "8px" }}>Tipo</th>
              <th style={{ textAlign: "left", padding: "8px" }}>Descrição</th>
              <th style={{ textAlign: "left", padding: "8px" }}>Categoria</th>
              <th style={{ textAlign: "right", padding: "8px" }}>Valor</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 20).map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "8px" }}>{new Date(r.entryDate).toLocaleDateString("pt-BR")}</td>
                <td style={{ padding: "8px" }}>
                  <span style={{ padding: "2px 6px", borderRadius: "3px", fontSize: "11px", backgroundColor: r.kind === "receita" ? "#c8e6c9" : "#ffcdd2", color: r.kind === "receita" ? "#1b5e20" : "#b71c1c" }}>
                    {r.kind === "receita" ? "Receita" : "Gasto"}
                  </span>
                </td>
                <td style={{ padding: "8px" }}>{r.description}</td>
                <td style={{ padding: "8px" }}>{r.category}</td>
                <td style={{ padding: "8px", textAlign: "right", color: r.kind === "receita" ? "#2e7d32" : "#c62828" }}>
                  {(r.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
