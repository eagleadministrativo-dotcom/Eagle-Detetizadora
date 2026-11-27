import { todayYmd } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { Field } from "@/components/ui";
import { OptionChecklist, OptionSelect, type PickOption } from "@/components/doc-pickers";
import { MiniAgenda } from "@/components/mini-agenda";
import { saveQuoteAction } from "@/app/actions/eagle";
import type { QuoteItemRow, QuoteRow, QuoteTexts } from "@/server/services/eagle";
import type { AgendaItem, DocOption, DocOptionKind } from "@/lib/doc-options";

const ROWS = 8;
const brl = (c: number | null | undefined) => (c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
type Defaults = Required<{ [K in keyof QuoteTexts]: string }> & { paymentTerms: string; productsIntro: string };

/**
 * Orçamento no modelo da Eagle. Serviços, aplicação, produtos, "acompanha", pagamento, prazo, validade e agendamento
 * são marcados entre as opções cadastradas em Serviços e preços; só Atenção e Obs. são escritos.
 */
export function QuoteForm({ customers, services, quote, items, customerId, defaults, options, agenda }: {
  customers: { id: string; name: string; phone: string | null }[];
  services: { id: string; name: string; description: string | null; price_cents: number | null }[];
  quote?: QuoteRow; items?: QuoteItemRow[]; customerId?: string; defaults: Defaults; options: DocOption[]; agenda: AgendaItem[];
}) {
  const isNew = !quote;
  const rows = Array.from({ length: ROWS }, (_, i) => items?.[i]);
  const v = (col: keyof QuoteRow, key: keyof Defaults) => (quote ? ((quote[col] as string | null) ?? "") : defaults[key]);
  const opts = (kind: DocOptionKind): PickOption[] => options.filter((o) => o.kind === kind && o.is_active)
    .map((o) => ({ key: o.id, text: o.text, group: o.group_label, isDefault: o.is_default }));
  const svcOptions: PickOption[] = services.map((s) => ({
    key: s.id, id: s.id, text: s.description?.trim() || s.name,
    label: s.description?.trim() ? `${s.name}: ${s.description.trim()}` : s.name,
  }));
  const where = <small className="muted">As opções ficam em Administração → Serviços e preços.</small>;
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
        <OptionChecklist name="svc" kind="servico" label="Serviços a serem realizados" options={svcOptions} current={quote?.services_text} isNew={isNew}
          empty="Nenhum serviço cadastrado. Cadastre em Serviços e preços (o campo Descrição é o texto que sai no orçamento)." />
        <Field label="Detalhes dos serviços (opcional: quantidade e tamanho de caixas d'água, áreas, etc.)"><textarea name="servicesDetails" rows={2} placeholder="Ex.: Sendo 1 caixa de 60 mil litros e 2 de 25 mil litros + 3 coletas estéreis de água e laudos." /></Field>
        <OptionChecklist name="opt_aplicacao" kind="aplicacao" label="Formas de aplicação" options={opts("aplicacao")} current={quote?.application_text} isNew={isNew} />
        <OptionChecklist name="opt_produto" kind="produto" label="Descrição dos produtos" options={opts("produto")} current={quote?.products_text} isNew={isNew} intro={defaults.productsIntro} />
        {where}
      </section>
      <section className="card form">
        <h2>Valor e condições</h2>
        <div className="fields">
          <Field label="Valor (R$)"><input name="value" inputMode="decimal" defaultValue={brl(quote?.value_cents)} placeholder="Em branco: soma dos itens abaixo" /></Field>
          <OptionSelect name="validityText" label="Validade do orçamento" options={opts("validade")} current={quote?.validity_text} isNew={isNew} />
          <Field label="Vence em (para o sistema avisar)"><input type="date" name="validUntil" defaultValue={quote?.valid_until ?? ""} /></Field>
        </div>
        <div className="fields">
          <OptionSelect name="paymentTerms" label="Formas de pagamento" options={opts("pagamento")} current={quote?.payment_terms} isNew={isNew} />
          <OptionSelect name="executionTime" label="Prazo de execução dos serviços" options={opts("prazo")} current={quote?.execution_time} isNew={isNew} />
        </div>
        <OptionChecklist name="opt_acompanha" kind="acompanha" label="Acompanha" options={opts("acompanha")} current={quote?.includes_text} isNew={isNew} />
      </section>
      <section className="card form">
        <h2>Agendamento</h2>
        <MiniAgenda items={agenda} today={todayYmd()} initialDate={quote?.scheduled_date} initialTime={quote?.scheduled_time} />
        <OptionSelect name="schedulingText" label="Texto do agendamento (usado quando não há data marcada)" options={opts("agendamento")}
          current={quote?.scheduled_date ? "" : quote?.scheduling_text} isNew={isNew} />
        <small className="muted">Com data marcada, o orçamento sai como “Agendado para dd/mm/aaaa (dia) às hh:mm”, e o botão Agendar o serviço já abre a agenda nesse dia.</small>
      </section>
      <section className="card form">
        <h2>Observações do orçamento</h2>
        <Field label="Atenção"><textarea name="attentionText" defaultValue={v("attention_text", "attentionText")} rows={3} /></Field>
        <Field label="Obs. (cancelamento)"><textarea name="cancellationText" defaultValue={v("cancellation_text", "cancellationText")} rows={3} /></Field>
        <div className="fields">
          <Field label="Assinatura (nome)"><input name="signatureName" defaultValue={v("signature_name", "signatureName")} /></Field>
          <Field label="Cargo"><input name="signatureRole" defaultValue={v("signature_role", "signatureRole")} /></Field>
          <Field label="Telefone da assinatura"><input name="signaturePhone" defaultValue={v("signature_phone", "signaturePhone")} /></Field>
          <Field label="Cidade"><input name="city" defaultValue={v("city", "city")} /></Field>
        </div>
        <small>Atenção, Obs., assinatura e cidade padrão ficam em Configurações.</small>
      </section>
      <details className="card confirm neutral" open={!!items?.length}>
        <summary>Itens com preço (opcional: somam o valor quando ele fica em branco)</summary>
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
