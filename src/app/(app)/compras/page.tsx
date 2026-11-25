import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { expenseCategories, listPurchases, purchaseSchedule } from "@/server/services/purchases";
import { addMonths, fmtDate, fmtYmd, monthStart, todayYmd } from "@/lib/dates";
import { fmtBRL } from "@/lib/money";
import { BarChart } from "@/components/charts";
import { Badge, ConfirmAction, Empty, Field, Flash, PageHead, Seg, Stat, money } from "@/components/ui";
import { PaymentFields } from "@/components/purchase-fields";
import { boughtAction, removePurchaseAction, savePurchaseAction, unboughtAction } from "@/app/actions/purchases";

export const metadata = { title: "Compras" };
const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mon = (ymd: string) => `${MON[Number(ymd.slice(5, 7)) - 1]}/${ymd.slice(2, 4)}`;

export default async function Purchases({ searchParams }: { searchParams: Promise<{ v?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("purchases.manage");
  const db = await getDb();
  const done = sp.v === "compradas";
  const [pending, bought, schedule, cats] = await Promise.all([listPurchases(db, ctx, "pendente"), listPurchases(db, ctx, "comprado"), purchaseSchedule(db, ctx), expenseCategories(db, ctx)]);
  const rows = done ? bought : pending;
  const finance = can(ctx, "finance.manage");
  const nextMonth = addMonths(monthStart(todayYmd()), 1);
  const defCat = cats.find((c) => /outras despesas/i.test(c.name))?.id ?? cats[0]?.id ?? "";
  const planned = pending.reduce((a, p) => a + p.total_cents, 0);
  return (
    <>
      <PageHead eyebrow="Estoque e compras" title="Compras" sub="O que a empresa precisa comprar. Ao marcar como comprado, o valor entra nas despesas do mês da fatura." />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="stats">
        <Stat label="Na lista" value={money(planned)} hint={`${pending.length} item(ns) a comprar`} tone="ol" />
        <Stat label="Comprometido este mês" value={money(schedule[0]?.cents ?? 0)} hint="Parcelas e compras do mês atual" tone="hi" />
        <Stat label="Próximo mês" value={money(schedule[1]?.cents ?? 0)} hint={mon(nextMonth)} />
        <Stat label="Próximos 6 meses" value={money(schedule.reduce((a, m) => a + m.cents, 0))} />
      </div>
      <div className="grid asym">
        <section className="card stack">
          <div className="calbar"><h2>{done ? "Compradas" : "Para comprar"}</h2><Seg items={[{ href: "/compras", label: "Para comprar", active: !done, n: pending.length }, { href: "/compras?v=compradas", label: "Compradas", active: done, n: bought.length }]} /></div>
          {rows.length === 0 ? <Empty title={done ? "Nada comprado ainda" : "Lista vazia"}>{done ? null : "Adicione o que precisa comprar ao lado."}</Empty> : (
            <div className="list">
              {rows.map((p) => (
                <div className="item2 buy" key={p.id} data-spot="">
                  <span className={`tick ${p.status === "comprado" ? "on" : ""}`} aria-hidden="true" />
                  <div>
                    <b>{p.name}</b>{p.quantity > 1 ? <small> · {p.quantity} un.</small> : null}
                    <div className="meta">
                      <span className="mono">{fmtBRL(p.total_cents)}</span>
                      <span>{p.payment === "credito" ? `Crédito ${p.installments}× de ${fmtBRL(Math.round(p.total_cents / p.installments))}` : "À vista"}</span>
                      {p.category_name ? <span>{p.category_name}</span> : null}
                      {p.first_due ? <span>{p.payment === "credito" ? "1ª fatura" : "Vencimento"} {fmtYmd(p.first_due)}</span> : null}
                      {p.bought_at ? <span>Comprado em {fmtDate(p.bought_at)}{p.bought_by_name ? ` por ${p.bought_by_name}` : ""}</span> : null}
                      {p.status === "comprado" && p.paid_cents ? <span>Pago {fmtBRL(p.paid_cents)}</span> : null}
                    </div>
                    {p.notes ? <small>{p.notes}</small> : null}
                  </div>
                  <div className="row act">
                    {p.priority === "alta" ? <Badge tone="warn">Prioridade</Badge> : null}
                    {p.status === "pendente" && finance ? (
                      <ConfirmAction label="Marcar como comprado" tone="neutral" action={boughtAction} submit="Confirmar compra" warn={p.installments > 1 ? `Serão lançadas ${p.installments} parcelas em Contas a pagar, uma por fatura.` : "A despesa será lançada em Contas a pagar."}>
                        <input type="hidden" name="id" value={p.id} />
                        <div className="fields">
                          <Field label={p.payment === "credito" ? "Vencimento da 1ª fatura" : "Data do pagamento"}><input type="date" name="firstDue" defaultValue={p.first_due ?? todayYmd()} required /></Field>
                          <Field label="Entra como"><select name="categoryId" defaultValue={p.category_id ?? defCat}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                        </div>
                      </ConfirmAction>
                    ) : null}
                    {p.status === "pendente" ? (
                      <ConfirmAction label="Editar" tone="neutral" action={savePurchaseAction} submit="Salvar">
                        <input type="hidden" name="id" value={p.id} />
                        <div className="fields"><Field label="O que comprar"><input name="name" defaultValue={p.name} required minLength={2} /></Field><Field label="Quantidade"><input name="quantity" type="number" min={1} defaultValue={p.quantity} /></Field></div>
                        <PaymentFields initial={p.payment} installments={p.installments} total={(p.total_cents / 100).toFixed(2).replace(".", ",")} />
                        <div className="fields"><Field label="1ª fatura / vencimento (opcional)"><input type="date" name="firstDue" defaultValue={p.first_due ?? ""} /></Field><Field label="Prioridade"><select name="priority" defaultValue={p.priority}><option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option></select></Field></div>
                        <Field label="Observação"><input name="notes" defaultValue={p.notes ?? ""} /></Field>
                      </ConfirmAction>
                    ) : null}
                    {p.status === "pendente" ? <form action={removePurchaseAction}><input type="hidden" name="id" value={p.id} /><button className="btn small ghost" type="submit">Remover</button></form> : null}
                    {p.status === "comprado" && finance && !p.paid_cents ? <form action={unboughtAction}><input type="hidden" name="id" value={p.id} /><button className="btn small ghost" type="submit">Desmarcar</button></form> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <div className="grid">
          <form action={savePurchaseAction} className="card form lit" id="nova">
            <h2>Adicionar à lista</h2>
            <div className="fields"><Field label="O que comprar"><input name="name" required minLength={2} placeholder="Ex.: Máquina de corte" /></Field><Field label="Quantidade"><input name="quantity" type="number" min={1} defaultValue={1} /></Field></div>
            <PaymentFields />
            <div className="fields">
              <Field label="1ª fatura / vencimento (opcional)"><input type="date" name="firstDue" /></Field>
              <Field label="Prioridade"><select name="priority" defaultValue="normal"><option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option></select></Field>
            </div>
            <Field label="Categoria da despesa"><select name="categoryId" defaultValue={defCat}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Observação (opcional)"><input name="notes" placeholder="Loja, link, modelo…" /></Field>
            <div><button className="btn accent" type="submit">Adicionar</button></div>
          </form>
          <section className="card stack">
            <h2>Compras nos próximos meses</h2>
            {schedule.some((m) => m.cents) ? <BarChart data={schedule.map((m) => ({ date: m.month, a: m.cents }))} labels={schedule.map((m) => mon(m.month))} /> : <Empty title="Nenhuma parcela futura" />}
            <small>Por mês da fatura, só compras já marcadas como compradas.</small>
          </section>
        </div>
      </div>
    </>
  );
}
