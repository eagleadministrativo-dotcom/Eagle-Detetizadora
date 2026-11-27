import { addDays, todayYmd } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { Field } from "@/components/ui";
import { saveQuoteAction } from "@/app/actions/eagle";
import type { QuoteItemRow, QuoteRow } from "@/server/services/eagle";

const ROWS = 8;
const brl = (c: number | null | undefined) => (c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Formulário único de criar/editar orçamento. Sem JavaScript: escolher o serviço e deixar descrição/valor em branco usa o nome e o preço do serviço. */
export function QuoteForm({ customers, services, quote, items, customerId }: {
  customers: { id: string; name: string; phone: string | null }[];
  services: { id: string; name: string; price_cents: number | null }[];
  quote?: QuoteRow; items?: QuoteItemRow[]; customerId?: string;
}) {
  const rows = Array.from({ length: ROWS }, (_, i) => items?.[i]);
  return (
    <form action={saveQuoteAction} className="stack">
      {quote ? <input type="hidden" name="id" value={quote.id} /> : null}
      <section className="card form">
        <h2>Cliente e condições</h2>
        <div className="fields">
          <Field label="Cliente">
            <select name="customerId" defaultValue={quote?.customer_id ?? customerId ?? ""} required>
              <option value="">— escolher —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
            </select>
          </Field>
          <Field label="Validade"><input type="date" name="validUntil" defaultValue={quote?.valid_until ?? addDays(todayYmd(), 15)} /></Field>
        </div>
        <Field label="Endereço do serviço (em branco usa o do cliente)"><input name="serviceAddress" defaultValue={quote?.service_address ?? ""} placeholder="Rua, número, bairro, cidade" /></Field>
        <div className="fields">
          <Field label="Condições de pagamento"><input name="paymentTerms" defaultValue={quote?.payment_terms ?? ""} placeholder="Ex.: 50% na aprovação e 50% na execução; Pix ou cartão" /></Field>
          <Field label="Desconto (R$)"><input name="discount" inputMode="decimal" defaultValue={quote?.discount_cents ? brl(quote.discount_cents) : ""} placeholder="0,00" /></Field>
        </div>
      </section>
      <section className="card form">
        <h2>Itens</h2>
        <small>Escolha o serviço e deixe descrição e valor em branco para usar o nome e o preço cadastrados. Linhas vazias são ignoradas.</small>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Serviço</th><th>Descrição</th><th className="n">Qtd.</th><th className="n">Valor unitário (R$)</th></tr></thead>
            <tbody>
              {rows.map((it, i) => (
                <tr key={i}>
                  <td>
                    <select name={`item${i}_service`} defaultValue={it?.service_id ?? ""} aria-label={`Serviço do item ${i + 1}`}>
                      <option value="">— nenhum —</option>
                      {services.map((s) => <option key={s.id} value={s.id}>{s.name}{s.price_cents != null ? ` · ${fmtBRL(s.price_cents)}` : ""}</option>)}
                    </select>
                  </td>
                  <td><input name={`item${i}_description`} defaultValue={it?.description ?? ""} aria-label={`Descrição do item ${i + 1}`} placeholder={i === 0 ? "Ex.: Dedetização de cozinha e área externa" : ""} /></td>
                  <td className="n"><input name={`item${i}_quantity`} inputMode="decimal" defaultValue={it ? String(it.quantity).replace(".", ",") : ""} placeholder="1" style={{ width: 70 }} aria-label={`Quantidade do item ${i + 1}`} /></td>
                  <td className="n"><input name={`item${i}_price`} inputMode="decimal" defaultValue={it ? brl(it.unit_price_cents) : ""} placeholder="0,00" style={{ width: 120 }} aria-label={`Valor do item ${i + 1}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card form">
        <h2>Textos do orçamento</h2>
        <Field label="Condições e garantia"><textarea name="conditions" defaultValue={quote?.conditions ?? ""} placeholder="Ex.: Garantia de 90 dias. Manter o ambiente fechado por 4 horas após a aplicação." /></Field>
        <Field label="Observações internas"><textarea name="notes" defaultValue={quote?.notes ?? ""} /></Field>
        <div><button className="btn accent" type="submit">{quote ? "Salvar alterações" : "Criar orçamento"}</button></div>
      </section>
    </form>
  );
}
