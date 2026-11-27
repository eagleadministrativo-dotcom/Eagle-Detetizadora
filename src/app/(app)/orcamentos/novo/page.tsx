import { getDb } from "@/server/db";
import { requireSession } from "@/server/session";
import { can } from "@/server/core";
import { listCustomers } from "@/server/services/customers";
import { saveQuoteAction } from "@/app/actions/eagle";

export const metadata = { title: "Novo orçamento" };

export default async function NewQuote() {
  const { ctx } = await requireSession();
  if (!can(ctx, "quotes.manage")) throw new Error("Sem permissão");
  const db = await getDb();
  const { rows: customers } = await listCustomers(db, ctx);

  return (
    <div className="page">
      <h1>Novo orçamento</h1>
      <form action={saveQuoteAction} style={{ maxWidth: "600px" }}>
        <div style={{ marginBottom: "16px" }}>
          <label>Cliente *</label>
          <select name="customerId" required style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ddd" }}>
            <option value="">Selecione...</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <label>Endereço do serviço</label>
          <input name="serviceAddress" type="text" style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ddd" }} />
        </div>

        <div style={{ marginBottom: "16px" }}>
          <label>Válido até</label>
          <input name="validUntil" type="date" style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ddd" }} />
        </div>

        <div style={{ marginBottom: "16px" }}>
          <label>Condições de pagamento</label>
          <input name="paymentTerms" type="text" placeholder="Ex: 50% à vista, 50% na conclusão" style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ddd" }} />
        </div>

        <fieldset style={{ marginBottom: "16px", padding: "12px", border: "1px solid #ddd", borderRadius: "4px" }}>
          <legend>Itens do orçamento</legend>
          <div id="items-container">
            <div style={{ marginBottom: "12px", padding: "12px", background: "#f9f9f9", borderRadius: "4px" }}>
              <input name="items[0][description]" type="text" placeholder="Descrição do item *" required style={{ width: "100%", marginBottom: "8px", padding: "6px", borderRadius: "4px", border: "1px solid #ddd" }} />
              <input name="items[0][quantity]" type="number" placeholder="Qtd" defaultValue="1" style={{ width: "48%", marginRight: "4%", marginBottom: "8px", padding: "6px", borderRadius: "4px", border: "1px solid #ddd" }} />
              <input name="items[0][unitPrice]" type="text" placeholder="Preço unitário (ex: 100,00)" required style={{ width: "48%", marginBottom: "8px", padding: "6px", borderRadius: "4px", border: "1px solid #ddd" }} />
            </div>
          </div>
        </fieldset>

        <div style={{ marginBottom: "16px" }}>
          <label>Desconto (R$)</label>
          <input name="discount" type="text" placeholder="0,00" style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ddd" }} />
        </div>

        <div style={{ marginBottom: "16px" }}>
          <label>Observações</label>
          <textarea name="notes" style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ddd", minHeight: "80px" }} />
        </div>

        <button type="submit" style={{ padding: "10px 20px", background: "#0066cc", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "14px" }}>
          Salvar orçamento
        </button>
      </form>
    </div>
  );
}
