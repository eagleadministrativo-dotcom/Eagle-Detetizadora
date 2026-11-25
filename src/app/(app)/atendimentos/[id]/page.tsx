import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { isDomainError } from "@/server/errors";
import { getAttendance } from "@/server/services/attendance";
import { getReceivable } from "@/server/services/payments";
import { findOpenSession } from "@/server/services/cash";
import { listCatalog, listServices } from "@/server/services/catalog";
import { fmtBRL } from "@/lib/money";
import { fmtDateTime, fmtTime } from "@/lib/dates";
import { ApptBadge, ConcBadge, ConfirmAction, Empty, Field, Flash, PageHead, PayBadge, PaymentStatusBadge, money, newKey } from "@/components/ui";
import { listProducts, saleOfAttendance } from "@/server/services/products";
import { attendanceProductsAction } from "@/app/actions/products";
import { ProductPicker } from "@/components/client";
import { cancelAttendanceAction, completeAction, completeLaterAction, discountAction, registerPaymentAction, setServicesAction } from "@/app/actions/attendance";

export const metadata = { title: "Atendimento" };
const brl = (c: number) => (c / 100).toFixed(2).replace(".", ",");

export default async function AttendancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("attendance.view_all", "attendance.view_own");
  const db = await getDb();
  let data;
  try {
    data = await getAttendance(db, ctx, id);
  } catch (e) {
    if (isDomainError(e) && e.code === "not_found") notFound();
    throw e;
  }
  const { attendance: a, items, appointment } = data;
  const inProgress = a.status === "iniciado";
  const done = a.status === "concluido";
  const cat = await listCatalog(db, ctx.unitId);
  const services = inProgress ? await listServices(db, ctx.unitId) : [];
  const methods = cat.methods.filter((m) => m.is_active);
  const canPay = can(ctx, "payments.register");
  const session = await findOpenSession(db.query, ctx.unitId);
  const sale = await saleOfAttendance(db, a.id);
  const saleOn = sale && sale.status !== "cancelada" && sale.items.length > 0 ? sale : null;
  const canSell = can(ctx, "products.sell");
  const products = inProgress && canSell ? (await listProducts(db, ctx, { activeOnly: true })).map((p) => ({ id: p.id, name: p.name, price: p.price_cents, stock: p.track_stock ? p.stock_qty : null })) : [];
  const grand = a.total_cents + (saleOn?.total_cents ?? 0);
  const rec = a.receivable_id ? await getReceivable(db, ctx, a.receivable_id) : null;
  const selected = new Set(items.map((i) => i.service_id));
  const balance = rec ? rec.receivable.amount_due_cents - rec.receivable.registered_cents : 0;
  const keys = [newKey(), newKey(), newKey()];
  const payKey = newKey();

  return (
    <>
      <PageHead title={a.customer_name} sub={<>{a.staff_name} · {a.chair_name} · iniciado às {fmtTime(a.started_at)}{a.finished_at ? ` · concluído às ${fmtTime(a.finished_at)}` : ""}</>}>
        <ApptBadge s={a.status} />
        {done ? <PayBadge s={a.pay_status} /> : null}
        <Link className="btn ghost" href="/atendimentos">Voltar</Link>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      {appointment?.customer_notes ? <div className="alert">Observação do cliente: {appointment.customer_notes}</div> : null}

      <div className="grid cols-2">
        <section className="card stack">
          <h2>Serviços e valores</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Serviço</th><th className="n">Preço aplicado</th></tr></thead>
              <tbody>
                {items.map((i) => <tr key={i.id}><td>{i.name_snapshot}</td><td className="n">{money(i.line_total_cents)}</td></tr>)}
                <tr><td>Subtotal</td><td className="n">{money(a.subtotal_cents)}</td></tr>
                {a.discount_cents > 0 ? <tr><td>Desconto <small>({a.discount_reason})</small></td><td className="n">− {fmtBRL(a.discount_cents)}</td></tr> : null}
                <tr className="total"><td>Total</td><td className="n">{money(a.total_cents)}</td></tr>
              </tbody>
            </table>
          </div>
          {saleOn ? (
            <>
              <h3>Produtos</h3>
              <div className="tablewrap"><table><tbody>
                {saleOn.items.map((i) => <tr key={i.id}><td>{i.quantity}× {i.name_snapshot}{i.returned_qty ? <small> · {i.returned_qty} devolvido(s)</small> : null}</td><td className="n">{money(i.gross_cents)}</td></tr>)}
                {saleOn.discount_cents > 0 ? <tr><td>Desconto <small>({saleOn.discount_reason})</small></td><td className="n">− {fmtBRL(saleOn.discount_cents)}</td></tr> : null}
                <tr className="total"><td>Total de produtos</td><td className="n">{money(saleOn.total_cents)}</td></tr>
              </tbody></table></div>
              <div className="sumrow big"><span>Total final</span>{money(grand)}</div>
              {done ? <Link className="btn small ghost" href={`/produtos/vendas/${saleOn.id}`}>Ver venda</Link> : null}
            </>
          ) : null}
          {inProgress ? (
            <>
              <ConfirmAction label="Alterar serviços" tone="neutral" action={setServicesAction} submit="Salvar serviços">
                <input type="hidden" name="id" value={a.id} />
                <div className="stack">
                  {services.map((s) => (
                    <label key={s.id} className="check"><input type="checkbox" name="services" value={s.id} defaultChecked={selected.has(s.id)} disabled={s.price_cents == null && !selected.has(s.id)} />
                      <span>{s.name} <small>· {s.price_cents == null ? "sem preço" : fmtBRL(s.price_cents)}</small></span></label>
                  ))}
                </div>
              </ConfirmAction>
              <ConfirmAction label="Aplicar desconto" tone="neutral" action={discountAction} submit="Aplicar desconto" warn="O desconto fica registrado com motivo e responsável. Acima do limite, exige o administrador.">
                <input type="hidden" name="id" value={a.id} />
                <div className="fields">
                  <Field label="Valor do desconto (R$)"><input name="discount" inputMode="decimal" defaultValue={a.discount_cents ? brl(a.discount_cents) : ""} placeholder="0,00" /></Field>
                  <Field label="Motivo"><input name="reason" minLength={3} /></Field>
                </div>
              </ConfirmAction>
            </>
          ) : null}
        </section>

        {inProgress ? (
          <section className="card stack">
            <h2>Concluir atendimento</h2>
            <form action={completeAction} className="form">
              <input type="hidden" name="id" value={a.id} />
              {canSell && products.length ? (
                <fieldset>
                  <legend>Produto(s) vendido(s)</legend>
                  <input type="hidden" name="withProducts" value="1" />
                  <ProductPicker key={saleOn?.total_cents ?? 0} products={products} initial={(saleOn?.items ?? []).map((i) => ({ id: i.product_id, qty: i.quantity }))} discount={saleOn?.discount_cents ?? 0} reason={saleOn?.discount_reason ?? ""} serviceCents={a.total_cents} syncField={canPay ? "amount0" : undefined} />
                  <div style={{ marginTop: 10 }}><button className="btn small ghost" type="submit" formAction={attendanceProductsAction} formNoValidate>Salvar produtos e continuar atendendo</button></div>
                </fieldset>
              ) : null}
              {canPay ? (
                <>
                  {!session ? <div className="alert warn">Caixa fechado: recebimento em dinheiro só depois de <Link href="/financeiro/caixa">abrir o caixa</Link>. Pix e cartão podem ser registrados.</div> : null}
                  <p className="muted">Receber agora (pagamento dividido: preencha mais de uma linha). Deixe em branco para cobrar depois.</p>
                  {[0, 1, 2].map((i) => (
                    <fieldset key={i}>
                      <legend>Pagamento {i + 1}</legend>
                      <input type="hidden" name={`key${i}`} value={keys[i]} />
                      <div className="fields">
                        <Field label="Forma"><select name={`method${i}`} defaultValue={methods[0]?.id}>{methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
                        <Field label="Valor (R$)"><input name={`amount${i}`} inputMode="decimal" key={grand} defaultValue={i === 0 ? brl(grand) : ""} placeholder="0,00" /></Field>
                        <Field label="Referência (opcional)"><input name={`ref${i}`} placeholder="Ex.: ID do Pix, final do cartão" /></Field>
                      </div>
                    </fieldset>
                  ))}
                  <small>Pix e cartão ficam &quot;registrados&quot; até a conferência na tela de Conciliação. Dinheiro é conferido na contagem do caixa.</small>
                </>
              ) : <p className="muted">Ao concluir, a cobrança fica pendente para quem recebe o pagamento.</p>}
              <div className="row sticky-actions">
                {canPay ? <button className="btn accent" type="submit">Concluir e receber</button> : null}
                <button className={canPay ? "btn ghost" : "btn accent"} type="submit" formAction={completeLaterAction}>{canPay ? "Concluir e cobrar depois" : "Concluir atendimento"}</button>
              </div>
            </form>
            <ConfirmAction label="Cancelar atendimento" action={cancelAttendanceAction} submit="Cancelar atendimento" warn="O horário será liberado e nenhuma cobrança será criada.">
              <input type="hidden" name="id" value={a.id} />
              <Field label="Motivo"><input name="reason" minLength={3} required /></Field>
            </ConfirmAction>
          </section>
        ) : null}

        {done && rec ? (
          <section className="card stack">
            <h2>Cobrança</h2>
            <div className="row"><PayBadge s={rec.receivable.pay_status} /><ConcBadge s={rec.receivable.conc_status} /></div>
            <div className="tablewrap"><table><tbody>
              <tr><td>Valor devido</td><td className="n">{money(rec.receivable.amount_due_cents)}</td></tr>
              <tr><td>Registrado</td><td className="n">{money(rec.receivable.registered_cents)}</td></tr>
              <tr><td>Conferido</td><td className="n">{money(rec.receivable.confirmed_cents)}</td></tr>
              <tr className="total"><td>Saldo a receber</td><td className="n">{money(balance)}</td></tr>
            </tbody></table></div>
            {rec.payments.length ? (
              <div className="tablewrap"><table>
                <thead><tr><th>Quando</th><th>Forma</th><th>Situação</th><th className="n">Valor</th></tr></thead>
                <tbody>{rec.payments.map((p) => (
                  <tr key={p.id} className={p.kind === "estorno" ? "dim" : ""}>
                    <td className="nowrap">{fmtDateTime(p.paid_at)}</td><td>{p.method_name}{p.kind === "estorno" ? " (estorno)" : ""}</td>
                    <td><PaymentStatusBadge s={p.status} />{p.reversed ? " estornado" : ""}</td><td className="n">{p.kind === "estorno" ? "−" : ""}{money(p.amount_cents)}</td>
                  </tr>))}</tbody>
              </table></div>
            ) : <Empty title="Nenhum pagamento registrado">A cobrança está pendente.</Empty>}
            {balance > 0 && canPay ? (
              <form action={registerPaymentAction} className="form">
                <h3>Registrar pagamento</h3>
                <input type="hidden" name="receivableId" value={rec.receivable.id} /><input type="hidden" name="key" value={payKey} /><input type="hidden" name="back" value={`/atendimentos/${a.id}`} />
                <div className="fields">
                  <Field label="Forma"><select name="methodId" defaultValue={methods[0]?.id}>{methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
                  <Field label="Valor (R$)"><input name="amount" inputMode="decimal" defaultValue={brl(balance)} required /></Field>
                  <Field label="Referência (opcional)"><input name="reference" /></Field>
                </div>
                <div><button className="btn accent" type="submit">Registrar pagamento</button></div>
              </form>
            ) : null}
            {can(ctx, "finance.view") ? <Link className="btn ghost" href={`/financeiro/receber/${rec.receivable.id}`}>Ver cobrança completa</Link> : null}
          </section>
        ) : null}
      </div>
    </>
  );
}
