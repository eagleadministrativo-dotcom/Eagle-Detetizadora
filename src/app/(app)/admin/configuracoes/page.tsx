import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { getSettings } from "@/server/core";
import { Field, Flash, PageHead } from "@/components/ui";
import { PushToggle } from "@/components/push-toggle";
import { ThemeChoice } from "@/components/client";
import { getPrefs } from "@/server/services/access";
import { updateSettingsAction } from "@/app/actions/admin";
import { saveDocumentSettingsAction } from "@/app/actions/eagle";
import { getDocumentSettings } from "@/server/services/eagle";

export const metadata = { title: "Configurações" };
const brl = (c: number) => (c / 100).toFixed(2).replace(".", ",");

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("admin.settings");
  const db = await getDb();
  const st = await getSettings(db.query, ctx.unitId);
  const prefs = await getPrefs(db, ctx.userId);
  const doc = await getDocumentSettings(db, ctx);
  return (
    <>
      <PageHead title="Configurações" sub="Políticas da unidade. Cada alteração fica registrada na auditoria." />
      <Flash ok={sp.ok} erro={sp.erro} />
      <section className="card stack" id="aparencia">
        <h2>Aparência</h2>
        <p>Escolha entre claro e escuro. Muda na hora e fica salvo no seu usuário, em todos os aparelhos.</p>
        <ThemeChoice initial={prefs.theme} />
      </section>
      <form action={saveDocumentSettingsAction} className="card form" id="documentos">
        <h2>Empresa e textos do orçamento</h2>
        <p>Aparecem nas ordens de serviço e nos orçamentos. Os textos abaixo entram já preenchidos em cada orçamento novo, e dá para ajustar caso a caso.</p>
        <div className="fields">
          <Field label="Nome da empresa"><input name="company_name" defaultValue={doc.company_name ?? ""} /></Field>
          <Field label="CNPJ"><input name="company_cnpj" defaultValue={doc.company_cnpj ?? ""} /></Field>
          <Field label="Telefones"><input name="company_phone" defaultValue={doc.company_phone ?? ""} /></Field>
        </div>
        <div className="fields">
          <Field label="E-mail"><input name="company_email" defaultValue={doc.company_email ?? ""} /></Field>
          <Field label="Site"><input name="company_site" defaultValue={doc.company_site ?? ""} /></Field>
          <Field label="Endereço"><input name="company_address" defaultValue={doc.company_address ?? ""} /></Field>
        </div>
        <p className="muted">Aplicação, produtos, acompanha, agendamento, pagamento, prazo e validade são escolhidos entre as opções de <Link href="/admin/servicos#opcoes">Serviços e preços</Link>.</p>
        <Field label="Frase antes da lista de produtos"><textarea name="quote_products_intro" rows={2} defaultValue={doc.quote_products_intro ?? ""} /></Field>
        <Field label="Atenção"><textarea name="quote_attention_default" rows={3} defaultValue={doc.quote_attention_default ?? ""} /></Field>
        <Field label="Obs. (cancelamento)"><textarea name="quote_cancellation_default" rows={3} defaultValue={doc.quote_cancellation_default ?? ""} /></Field>
        <Field label="Fecho do orçamento"><textarea name="quote_closing" rows={4} defaultValue={doc.quote_closing ?? ""} /></Field>
        <div className="fields">
          <Field label="Assinatura (nome)"><input name="quote_signature_name" defaultValue={doc.quote_signature_name ?? ""} /></Field>
          <Field label="Cargo"><input name="quote_signature_role" defaultValue={doc.quote_signature_role ?? ""} /></Field>
          <Field label="Telefone da assinatura"><input name="quote_signature_phone" defaultValue={doc.quote_signature_phone ?? ""} /></Field>
          <Field label="Cidade"><input name="quote_city" defaultValue={doc.quote_city ?? ""} /></Field>
        </div>
        <small>O cabeçalho com o logo (do seu modelo de orçamento) e o logo da OS são imagens fixas. Para trocar, peça a atualização.</small>
        <div><button className="btn accent" type="submit">Salvar empresa e textos</button></div>
      </form>
      <form action={saveDocumentSettingsAction} className="card form" id="certificado">
        <h2>Certificado de execução</h2>
        <p className="muted">Sai da OS concluída (botão &quot;Certificado de execução&quot;), com os produtos, as áreas, a data e a validade do laudo. É o documento que o cliente apresenta à vigilância sanitária.</p>
        <div className="fields">
          <Field label="Responsável técnico"><input name="cert_responsible" defaultValue={doc.cert_responsible ?? ""} placeholder="Nome completo" /></Field>
          <Field label="Registro no conselho"><input name="cert_registration" defaultValue={doc.cert_registration ?? ""} placeholder="Ex.: CRQ 00000000" /></Field>
          <Field label="Licença sanitária da empresa"><input name="cert_license" defaultValue={doc.cert_license ?? ""} placeholder="Número da licença / alvará" /></Field>
        </div>
        <Field label="Texto no fim do certificado (opcional)"><textarea name="cert_notes" rows={3} defaultValue={doc.cert_notes ?? ""} placeholder="Ex.: Em caso de intoxicação, ligue para o CEATOX 0800..." /></Field>
        <div><button className="btn" type="submit">Salvar certificado</button></div>
      </form>
      <section className="card stack" id="notificacoes">
        <h2>Notificações</h2>
        <p>Ative ou desative os avisos do sistema neste aparelho. Vale para o navegador (Chrome) e para o aplicativo instalado: cada um é ativado separadamente.</p>
        <PushToggle />
        <small>Para instalar o aplicativo: no Chrome, menu e &quot;Instalar aplicativo&quot;. No iPhone, Safari e &quot;Adicionar à Tela de Início&quot;.</small>
      </section>
      <form action={updateSettingsAction} className="form">
        <section className="card form">
          <h2>Descontos</h2>
          <label className="check"><input type="checkbox" name="ownerOnly" defaultChecked={st.discount_owner_only} />Somente o administrador concede desconto</label>
          <div className="fields"><Field label="Limite para quem tem permissão de desconto limitado (%)"><input name="limit" inputMode="decimal" defaultValue={st.discount_limit_bps != null ? (st.discount_limit_bps / 100).toString().replace(".", ",") : ""} placeholder="Ex.: 10" /></Field></div>
          <small>Se a opção acima estiver marcada, o limite é ignorado. O limite vale para gerente e para técnicos com permissão individual.</small>
        </section>
        <section className="card form">
          <h2>Correções retroativas</h2>
          <div className="fields"><Field label="Dias permitidos para lançar/corrigir no passado"><input name="retro" type="number" min={0} defaultValue={st.retroactive_edit_days} /></Field></div>
          <small>Períodos já fechados continuam travados, independentemente desta janela.</small>
        </section>
        <section className="card form">
          <h2>Não comparecimento</h2>
          <div className="fields">
            <Field label="Política"><select name="noShow" defaultValue={st.no_show_policy}><option value="apenas_registrar">Apenas registrar</option><option value="cobrar_taxa">Cobrar taxa</option></select></Field>
            <Field label="Taxa (R$)"><input name="noShowFee" inputMode="decimal" defaultValue={st.no_show_fee_cents != null ? brl(st.no_show_fee_cents) : ""} /></Field>
          </div>
        </section>
        <section className="card form">
          <h2>Dados fiscais e privacidade</h2>
          <div className="fields">
            <Field label="Regime tributário"><select name="tax" defaultValue={st.tax_regime ?? ""}><option value="">Não definido</option><option>MEI</option><option>Simples Nacional</option><option>Lucro Presumido</option><option>Outro</option></select></Field>
            <Field label="Retenção de dados de clientes (meses, opcional)"><input name="retention" type="number" min={1} defaultValue={st.customer_retention_months ?? ""} /></Field>
          </div>
          <small>O regime é informativo: os impostos são lançados manualmente como contas a pagar na categoria &quot;Impostos&quot;. Defina a retenção com orientação jurídica/contábil (LGPD).</small>
        </section>
        <section className="card form">
          <h2>Acesso e notificações</h2>
          <small>Cada pessoa confirma o e-mail com um código no primeiro acesso; depois o login fica lembrado no aparelho até ela tocar em Sair.</small>
          <small>Os avisos aparecem dentro do sistema e, para quem ativar, como notificação no celular. O e-mail é usado para convites e códigos de acesso.</small>
        </section>
        <div className="sticky-actions"><button className="btn accent" type="submit">Salvar configurações</button></div>
      </form>
    </>
  );
}
