import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { listCatalog } from "@/server/services/catalog";
import { Badge, Field, Flash, PageHead } from "@/components/ui";
import { saveAccountAction, saveFinCategoryAction, savePaymentMethodAction } from "@/app/actions/admin";

export const metadata = { title: "Pagamentos e plano de contas" };
const brl = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const KIND: Record<string, string> = { dinheiro: "Dinheiro", pix: "Pix", cartao_credito: "Cartão de crédito", cartao_debito: "Cartão de débito", outro: "Outro" };
const CAT: Record<string, string> = { receita: "Receita", custo: "Custo variável", despesa: "Despesa operacional", imposto: "Imposto", nao_operacional: "Não operacional", pro_labore: "Pró-labore", distribuicao_lucros: "Distribuição de lucros" };

export default async function FinanceAdmin({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("admin.settings");
  const cat = await listCatalog(await getDb(), ctx.unitId);
  const accountOpts = cat.accounts.filter((a) => a.is_active);
  return (
    <>
      <PageHead title="Pagamentos e plano de contas" sub="Formas de pagamento (com taxas), contas financeiras e categorias do plano de contas. Tudo editável." />
      <Flash ok={sp.ok} erro={sp.erro} />

      <section className="card stack">
        <h2>Formas de pagamento</h2>
        <div className="stack">
          {[...cat.methods, undefined].map((m) => (
            <form key={m?.id ?? "novo"} action={savePaymentMethodAction} className="card flat form">
              {m ? <input type="hidden" name="id" value={m.id} /> : <h3>Nova forma de pagamento</h3>}
              <div className="fields">
                <Field label="Nome"><input name="name" defaultValue={m?.name ?? ""} required /></Field>
                <Field label="Tipo"><select name="kind" defaultValue={m?.kind ?? "outro"}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Taxa (%)"><input name="fee" inputMode="decimal" defaultValue={m ? (m.fee_bps / 100).toString().replace(".", ",") : "0"} /></Field>
                <Field label="Taxa fixa (R$)"><input name="fixed" inputMode="decimal" defaultValue={m ? brl(m.fee_fixed_cents) : ""} /></Field>
                <Field label="Dias para receber"><input name="days" type="number" min={0} defaultValue={m?.settlement_days ?? 0} /></Field>
                <Field label="Conta de destino"><select name="accountId" defaultValue={m?.account_id ?? ""}><option value="">—</option>{accountOpts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
              </div>
              <div className="row">
                {m ? <label className="check"><input type="checkbox" name="isActive" defaultChecked={m.is_active} />Ativa {!m.is_active ? <Badge>inativa</Badge> : null}</label> : null}
                <button className="btn small accent" type="submit">{m ? "Salvar" : "Adicionar"}</button>
              </div>
            </form>
          ))}
        </div>
        <small>As taxas valem para novos pagamentos. Pagamentos já registrados mantêm a taxa calculada na época.</small>
      </section>

      <section className="card stack">
        <h2>Contas financeiras</h2>
        {[...cat.accounts, undefined].map((a) => (
          <form key={a?.id ?? "novo"} action={saveAccountAction} className="row">
            {a ? <input type="hidden" name="id" value={a.id} /> : null}
            <input name="name" defaultValue={a?.name ?? ""} placeholder="Nova conta" required style={{ maxWidth: 220 }} aria-label="Nome da conta" />
            <select name="kind" defaultValue={a?.kind ?? "banco"} style={{ maxWidth: 140 }} aria-label="Tipo"><option value="caixa">Caixa</option><option value="banco">Banco</option><option value="virtual">Virtual</option></select>
            <input name="opening" inputMode="decimal" defaultValue={a ? brl(a.opening_balance_cents) : ""} placeholder="Saldo inicial R$" style={{ maxWidth: 150 }} aria-label="Saldo inicial" />
            {a ? <label className="check"><input type="checkbox" name="isActive" defaultChecked={a.is_active} />ativa</label> : null}
            <button className="btn small ghost" type="submit">{a ? "Salvar" : "Adicionar"}</button>
          </form>
        ))}
        <small>O saldo inicial é o ponto de partida do saldo calculado da conta.</small>
      </section>

      <section className="card stack">
        <h2>Plano de contas (categorias financeiras)</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Código</th><th>Nome</th><th>Tipo</th><th /></tr></thead>
          <tbody>{cat.categories.map((c) => (
            <tr key={c.id}><td colSpan={4} style={{ padding: 6 }}>
              <form action={saveFinCategoryAction} className="row">
                <input type="hidden" name="id" value={c.id} />
                <input name="code" defaultValue={c.account_code ?? ""} style={{ maxWidth: 80 }} aria-label="Código" />
                <input name="name" defaultValue={c.name} style={{ maxWidth: 260 }} aria-label="Nome" />
                <select name="kind" defaultValue={c.kind} style={{ maxWidth: 200 }} aria-label="Tipo">{Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <label className="check"><input type="checkbox" name="isActive" defaultChecked={c.is_active} />ativa</label>
                <button className="btn small ghost" type="submit">Salvar</button>
              </form>
            </td></tr>))}</tbody>
        </table></div>
        <form action={saveFinCategoryAction} className="row">
          <input name="code" placeholder="Código" style={{ maxWidth: 80 }} /><input name="name" placeholder="Nova categoria" required style={{ maxWidth: 260 }} />
          <select name="kind" defaultValue="despesa" style={{ maxWidth: 200 }}>{Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button className="btn small" type="submit">Adicionar</button>
        </form>
        <small>O <b>tipo</b> define onde a categoria aparece na DRE. Categorias com lançamentos não podem ser desativadas, só renomeadas.</small>
      </section>
    </>
  );
}
