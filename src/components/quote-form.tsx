import { todayYmd } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { Field } from "@/components/ui";
import { saveQuoteAction } from "@/app/actions/eagle";
import type { QuoteItemRow, QuoteRow, QuoteTexts } from "@/server/services/eagle";

const ROWS = 8;
const brl = (c: number | null | undefined) => (c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
type Defaults = Required<{ [K in keyof QuoteTexts]: string }> & { paymentTerms: string };

/** Orçamento no modelo da Eagle. Novo orçamento já vem com os textos padrão de Configurações. */
export function QuoteForm({ customers, services, quote, items, customerId, defaults }: {
  customers: { id: string; name: string; phone: string | null }[];
  services: { id: string; name: string; price_cents: number | null }[];
  quote?: QuoteRow; items?: QuoteItemRow[]; customerId?: string; defaults: Defaults;
}) {
  const rows = Array.from({ length: ROWS }, (_, i) => items?.[i]);
  const v = (col: keyof QuoteRow, key: keyof Defaults) => (quote ? ((quote[col] as string | null) ?? "") : defaults[key]);
  const area = (name: string, label: string, value: string, rows = 3, placeholder?: string) => (
    <Field label={label}><textarea name={name} defaultValue={value} rows={rows} placeholder={placeholder} /></Field>
  );
  return (
    <form action={saveQuoteAction} className="stack">
      {quote ? <input type="hidden" name="id" value={quote.id} /> : null}
      <section className="card form">
        <h2>Cliente</h2>
        <div className="fields">
          <Field label="Cliente">
            <select name="customerId" defaultValue={quote?.customer_id ?? customerId ?? ""} required>
              <option value="">— escolher —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
            </select>
          </Field>
          <Field label="Data do orçamento"><input type="date" name="issueDate" defaultValue={quote?.issue_date ?? todayYmd()} /></Field>
        </div>
        <Field label="Local do serviço (em branco usa o endereço da ficha)"><input name="serviceAddress" defaultValue={quote?.service_address ?? ""} placeholder="Rua, número, bairro, cidade" /></Field>
      </section>
      <section className="card form">
        <h2>Serviços</h2>
        {area("servicesText", "Serviços a serem realizados", quote?.services_text ?? "", 7, "Ex.: Dedetização \\ Controle de insetos rasteiros, aplicação interna e externa…")}
        {area("applicationText", "Formas de aplicação", v("application_text", "applicationText"), 3)}
        {area("productsText", "Descrição dos produtos", v("products_text", "productsText"), 8)}
      </section>
      <section className="card form">
        <h2>Valor e condições</h2>
        <div className="fields">
          <Field label="Valor (R$)"><input name="value" inputMode="decimal" defaultValue={brl(quote?.value_cents)} placeholder="Em branco: soma dos itens abaixo" /></Field>
          <Field label="Validade do orçamento"><input name="validityText" defaultValue={v("validity_text", "validityText")} placeholder="30 dias" /></Field>
          <Field label="Vence em (para o sistema avisar)"><input type="date" name="validUntil" defaultValue={quote?.valid_until ?? ""} /></Field>
        </div>
        <Field label="Formas de pagamento"><input name="paymentTerms" defaultValue={quote ? quote.payment_terms ?? "" : defaults.paymentTerms} /></Field>
        <Field label="Prazo de execução dos serviços"><input name="executionTime" defaultValue={v("execution_time", "executionTime")} /></Field>
      </section>
      <section className="card form">
        <h2>Textos do orçamento</h2>
        {area("includesText", "Acompanha", v("includes_text", "includesText"), 2)}
        {area("schedulingText", "Agendamento", v("scheduling_text", "schedulingText"), 2)}
        {area("attentionText", "Atenção", v("attention_text", "attentionText"), 3)}
        {area("cancellationText", "Obs. (cancelamento)", v("cancellation_text", "cancellationText"), 3)}
        <div className="fields">
          <Field label="Assinatura (nome)"><input name="signatureName" defaultValue={v("signature_name", "signatureName")} /></Field>
          <Field label="Cargo"><input name="signatureRole" defaultValue={v("signature_role", "signatureRole")} /></Field>
          <Field label="Telefone da assinatura"><input name="signaturePhone" defaultValue={v("signature_phone", "signaturePhone")} /></Field>
          <Field label="Cidade"><input name="city" defaultValue={v("city", "city")} /></Field>
        </div>
        <small>Os textos padrão ficam em Configurações → Orçamento. Aqui você ajusta só para este cliente.</small>
      </section>
      <details className="card confirm neutral" open={!!items?.length}>
        <summary>Itens do catálogo (opcional: somam o valor e preenchem o agendamento)</summary>
        <div className="fields">
          <Field label="Desconto sobre os itens (R$)"><input name="discount" inputMode="decimal" defaultValue={quote?.discount_cents ? brl(quote.discount_cents) : ""} placeholder="0,00" /></Field>
        </div>
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
                  <td><input name={`item${i}_description`} defaultValue={it?.description ?? ""} aria-label={`Descrição do item ${i + 1}`} /></td>
                  <td className="n"><input name={`item${i}_quantity`} inputMode="decimal" defaultValue={it ? String(it.quantity).replace(".", ",") : ""} placeholder="1" style={{ width: 70 }} aria-label={`Quantidade do item ${i + 1}`} /></td>
                  <td className="n"><input name={`item${i}_price`} inputMode="decimal" defaultValue={it ? brl(it.unit_price_cents) : ""} placeholder="0,00" style={{ width: 120 }} aria-label={`Valor do item ${i + 1}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <section className="card form">
        <Field label="Observações internas (não saem no documento)"><textarea name="notes" defaultValue={quote?.notes ?? ""} rows={2} /></Field>
        <div><button className="btn accent" type="submit">{quote ? "Salvar alterações" : "Criar orçamento"}</button></div>
      </section>
    </form>
  );
}
