import { Field } from "@/components/ui";
import { OptionChecklist } from "@/components/doc-pickers";
import { CLIENT_SITUATION_LABEL, OS_PAYMENT_LABEL, type ServiceOrderRow } from "@/server/services/eagle";

const brl = (c: number | null | undefined) => (c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Campos da OS na ordem do modelo da Eagle. Usado para criar (sem `o`) e editar. Os serviços são marcados entre os cadastrados. */
export function OrderFieldsForm({ o, services }: { o?: ServiceOrderRow; services: { id: string; name: string }[] }) {
  return (
    <>
      <fieldset>
        <legend>Visita</legend>
        <div className="fields">
          <Field label="Data"><input type="date" name="serviceDate" defaultValue={o?.service_date ?? ""} /></Field>
          <Field label="Horário"><input type="time" name="serviceTime" defaultValue={o?.service_time ?? ""} /></Field>
        </div>
        <OptionChecklist name="svc_os" kind="servico_os" label="Serviços" isNew={!o} current={o?.services}
          options={services.map((s) => ({ key: s.id, id: s.id, text: s.name }))} attrs={(s) => ({ "data-service": s.id ?? "" })}
          empty="Nenhum serviço cadastrado. Cadastre em Serviços e preços." />
        <Field label="Detalhes dos serviços (opcional)"><input name="servicesDetails" placeholder="Ex.: limpeza de 3 caixas d'água de 500 litros cada" /></Field>
      </fieldset>
      <fieldset>
        <legend>Valor e pagamento</legend>
        <div className="fields">
          <Field label="Valor (R$)"><input name="value" inputMode="decimal" defaultValue={brl(o?.total_cents)} placeholder="0,00" /></Field>
          <Field label="Forma de pagamento"><input name="paymentMethod" defaultValue={o?.payment_method ?? ""} placeholder="Ex.: Boleto 10 dias, Pix" /></Field>
          <Field label="Banco"><input name="bank" defaultValue={o?.bank ?? ""} /></Field>
          <Field label="Pagamento"><select name="paymentStatus" defaultValue={o?.payment_status ?? "pendente"}>{Object.entries(OS_PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
      </fieldset>
      <Field label="Observações gerais"><textarea name="notes" defaultValue={o?.notes ?? ""} rows={5} /></Field>
      <fieldset>
        <legend>Laudo e situação do cliente</legend>
        <div className="fields">
          <Field label="Laudo (meses)"><input name="reportMonths" type="number" min={0} max={60} defaultValue={o?.report_months ?? ""} placeholder="6" /></Field>
          <Field label="Garantia (dias)"><input name="warrantyDays" type="number" min={0} max={1095} defaultValue={o?.warranty_days ?? ""} placeholder="Gera o retorno de garantia" /></Field>
          <Field label="Situação do cliente">
            <select name="clientSituation" defaultValue={o?.client_situation ?? ""}><option value="">— não marcada —</option>{Object.entries(CLIENT_SITUATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
        </div>
      </fieldset>
      <fieldset>
        <legend>Fechamento</legend>
        <div className="fields">
          <Field label="Data fechamento serviço"><input name="closingRef" defaultValue={o?.closing_ref ?? ""} placeholder="Ex.: Out 26" /></Field>
          <Field label="Nº NF"><input name="nfNumber" defaultValue={o?.nf_number ?? ""} /></Field>
          <Field label="Nº recibo"><input name="receiptNumber" defaultValue={o?.receipt_number ?? ""} /></Field>
          <Field label="Boleto"><input name="boleto" defaultValue={o?.boleto ?? ""} /></Field>
        </div>
        <div className="fields">
          <Field label="Serviço confirmado (data)"><input name="confirmedOn" defaultValue={o?.confirmed_on ?? ""} placeholder="Ex.: Ago 26" /></Field>
          <Field label="Resp. conf. cliente"><input name="confirmedByCustomer" defaultValue={o?.confirmed_by_customer ?? ""} /></Field>
          <Field label="Resp. Eagle"><input name="confirmedByEagle" defaultValue={o?.confirmed_by_eagle ?? ""} /></Field>
        </div>
      </fieldset>
      <details className="confirm neutral" open={!!(o?.pests || o?.products_used || o?.areas)}>
        <summary>Registro técnico (não sai no documento)</summary>
        <Field label="Pragas encontradas"><textarea name="pests" defaultValue={o?.pests ?? ""} placeholder="Ex.: baratas (cozinha), formigas (quintal)" /></Field>
        <Field label="Produtos utilizados"><textarea name="productsUsed" defaultValue={o?.products_used ?? ""} placeholder="Nome do produto, quantidade e lote" /></Field>
        <Field label="Áreas tratadas"><textarea name="areas" defaultValue={o?.areas ?? ""} /></Field>
      </details>
      <label className="check"><input type="checkbox" name="technicianConfirmed" defaultChecked={o?.technician_confirmed} />Técnico confirma que o serviço foi executado</label>
      <label className="check"><input type="checkbox" name="customerConfirmed" defaultChecked={o?.customer_confirmed} />Cliente confirmou o serviço</label>
    </>
  );
}
