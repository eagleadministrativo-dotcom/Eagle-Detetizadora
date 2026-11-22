import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { getSettings } from "@/server/core";
import { Field, Flash, PageHead } from "@/components/ui";
import { updateSettingsAction } from "@/app/actions/admin";

export const metadata = { title: "Configurações" };
const brl = (c: number) => (c / 100).toFixed(2).replace(".", ",");

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("admin.settings");
  const st = await getSettings((await getDb()).query, ctx.unitId);
  return (
    <>
      <PageHead title="Configurações" sub="Políticas da unidade. Cada alteração fica registrada na auditoria." />
      <Flash ok={sp.ok} erro={sp.erro} />
      <form action={updateSettingsAction} className="form">
        <section className="card form">
          <h2>Descontos</h2>
          <label className="check"><input type="checkbox" name="ownerOnly" defaultChecked={st.discount_owner_only} />Somente o proprietário concede desconto</label>
          <div className="fields"><Field label="Limite para quem tem permissão de desconto limitado (%)"><input name="limit" inputMode="decimal" defaultValue={st.discount_limit_bps != null ? (st.discount_limit_bps / 100).toString().replace(".", ",") : ""} placeholder="Ex.: 10" /></Field></div>
          <small>Se a opção acima estiver marcada, o limite é ignorado. O limite vale para gerente e para barbeiros com permissão individual.</small>
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
          <h2>Segurança e notificações</h2>
          <label className="check"><input type="checkbox" name="mfa" defaultChecked={st.mfa_required} />Exigir verificação em duas etapas para proprietário e gerente</label>
          <small>Canal de alertas: dentro do sistema. E-mail e WhatsApp dependem de serviços externos e só serão ativados com sua autorização.</small>
        </section>
        <div className="sticky-actions"><button className="btn accent" type="submit">Salvar configurações</button></div>
      </form>
    </>
  );
}
