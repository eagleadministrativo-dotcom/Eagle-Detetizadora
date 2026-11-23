import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can, getSettings } from "@/server/core";
import { listRules } from "@/server/services/commissions";
import { listCatalog, listServices } from "@/server/services/catalog";
import { fmtYmd, todayYmd } from "@/lib/dates";
import { fmtPct } from "@/lib/money";
import { Badge, Empty, Field, Flash, PageHead } from "@/components/ui";
import { endRuleAction, saveRuleAction, triggerAction } from "@/app/actions/commissions";

export const metadata = { title: "Regras de comissão" };

export default async function Rules({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("commissions.rules", "commissions.view_all");
  const db = await getDb();
  const edit = can(ctx, "commissions.rules");
  const [rules, cat, services, st] = await Promise.all([listRules(db, ctx), listCatalog(db, ctx.unitId), listServices(db, ctx.unitId), getSettings(db.query, ctx.unitId)]);
  const products = await db.query<{ id: string; name: string }>("select id, name from products where unit_id=$1 and is_active and commission_enabled order by name", [ctx.unitId]);
  const trigger = (st as unknown as { commission_trigger: string }).commission_trigger;
  const staff = cat.staff.filter((s) => s.is_active);
  const form = (scope: "servico" | "produto") => (
    <form action={saveRuleAction} className="card form">
      <h2>{scope === "servico" ? "Regra de serviço" : "Regra de produto"}</h2>
      <input type="hidden" name="scope" value={scope} />
      <div className="fields">
        <Field label="Profissional"><select name="staffId" defaultValue=""><option value="">Todos</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label={scope === "servico" ? "Serviço" : "Produto"}>
          <select name="target" defaultValue="">
            <option value="">Todos</option>
            {scope === "servico" ? <><optgroup label="Categorias">{cat.svcCats.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}</optgroup><optgroup label="Serviços">{services.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>)}</optgroup></> : products.map((x) => <option key={x.id} value={`p:${x.id}`}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Percentual (%)"><input name="pct" inputMode="decimal" required placeholder="Ex.: 40" /></Field>
        <Field label="Calcular sobre"><select name="base" defaultValue="" required><option value="" disabled>Escolha</option><option value="bruto">Valor bruto</option><option value="liquido">Valor após descontos</option></select></Field>
        <Field label="Vale a partir de"><input type="date" name="validFrom" min={todayYmd()} defaultValue={todayYmd()} required /></Field>
        <Field label="Observação (opcional)"><input name="note" /></Field>
      </div>
      <div><button className="btn accent" type="submit">Salvar regra</button></div>
    </form>
  );
  return (
    <>
      <PageHead title="Regras de comissão" sub="Sem regra, nada é gerado. Vale a mais específica: profissional com item, profissional com categoria, profissional, item, categoria, geral."><Link className="btn ghost" href="/comissoes">Voltar</Link></PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      {edit ? (
        <>
          <div className="grid cols-2">{form("servico")}{products.length ? form("produto") : <section className="card"><Empty title="Nenhum produto com comissão">Ative &quot;Gera comissão&quot; no cadastro do produto.</Empty></section>}</div>
          <form action={triggerAction} className="card form">
            <h2>Quando a comissão pode ser paga</h2>
            <div className="chips"><label className="chip"><input type="radio" name="trigger" value="recebimento" defaultChecked={trigger === "recebimento"} />Depois que o pagamento do cliente for conferido</label><label className="chip"><input type="radio" name="trigger" value="conclusao" defaultChecked={trigger === "conclusao"} />Assim que o atendimento terminar</label></div>
            <small>Confirme com o contador qual regra vale no contrato de cada profissional.</small>
            <div><button className="btn" type="submit">Salvar política</button></div>
          </form>
        </>
      ) : null}
      {rules.length === 0 ? <Empty title="Nenhuma regra cadastrada" /> : (
        <div className="tablewrap"><table className="rtable">
          <thead><tr><th>Tipo</th><th>Profissional</th><th>Item</th><th className="n">%</th><th>Base</th><th>Vigência</th><th>Criada por</th><th /></tr></thead>
          <tbody>{rules.map((r) => <tr key={r.id} className={r.active ? "" : "dim"}><td>{r.scope === "servico" ? "Serviço" : "Produto"}</td><td>{r.staff_name ?? "Todos"}</td><td>{r.target}{r.note ? <><br /><small>{r.note}</small></> : null}</td><td className="n">{fmtPct(r.pct_bps / 100, r.pct_bps % 100 ? 2 : 0)}</td><td>{r.base === "bruto" ? "Bruto" : "Após descontos"}</td><td>{fmtYmd(r.valid_from)}{r.valid_to ? <> a {fmtYmd(r.valid_to)}</> : null} {r.active ? null : <Badge>encerrada</Badge>}</td><td><small>{r.created_by_name}</small></td><td>{edit && r.active && !r.valid_to ? <form action={endRuleAction}><input type="hidden" name="id" value={r.id} /><button className="btn small ghost" type="submit">Encerrar hoje</button></form> : null}</td></tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}
