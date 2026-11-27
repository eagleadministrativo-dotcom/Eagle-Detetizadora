import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { getQuote } from "@/server/services/eagle";
import { getSettings } from "@/server/core";
import { fmtYmd, todayYmd } from "@/lib/dates";
import { Badge, Flash, PageHead, money } from "@/components/ui";
import { QuoteStatusBadge } from "@/components/eagle-ui";
import { PrintButton } from "@/components/client";
import { quoteStatusAction } from "@/app/actions/eagle";

export const metadata = { title: "Orçamento" };

export default async function QuotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("quotes.view", "quotes.manage");
  const db = await getDb();
  const data = await getQuote(db, ctx, id).catch(() => null);
  if (!data) notFound();
  const { quote: q, items } = data;
  const company = (await getSettings(db.query, ctx.unitId)) as unknown as { company_name?: string | null; company_cnpj?: string | null; company_phone?: string | null; company_email?: string | null; company_address?: string | null };
  const manage = can(ctx, "quotes.manage");
  const editable = q.status === "rascunho" || q.status === "enviado";
  const expired = q.valid_until && q.valid_until < todayYmd() && editable;
  const services = [...new Set(items.map((i) => i.service_id).filter(Boolean))].join(",");
  const status = (value: string, label: string, cls = "btn") => (
    <form action={quoteStatusAction}><input type="hidden" name="id" value={q.id} /><input type="hidden" name="status" value={value} /><button className={cls} type="submit">{label}</button></form>
  );

  return (
    <>
      <PageHead title={`Orçamento nº ${q.number}`} sub={<>{q.customer_name} · emitido em {fmtYmd(q.issue_date)}{q.valid_until ? ` · válido até ${fmtYmd(q.valid_until)}` : ""}</>}>
        <QuoteStatusBadge s={q.status} />
        {expired ? <Badge tone="bad">vencido</Badge> : null}
        <PrintButton />
        <Link className="btn ghost" href="/orcamentos">Voltar</Link>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      {manage ? (
        <section className="card row noprint" style={{ gap: 10 }}>
          {editable ? <Link className="btn" href={`/orcamentos/${q.id}/editar`}>Editar</Link> : null}
          {q.status === "rascunho" ? status("enviado", "Marcar como enviado") : null}
          {editable ? status("aprovado", "Cliente aprovou", "btn accent") : null}
          {editable ? status("recusado", "Cliente recusou", "btn ghost") : null}
          {!editable ? status("rascunho", "Voltar para rascunho", "btn ghost") : null}
          {q.status === "aprovado" && can(ctx, "agenda.create") ? <Link className="btn accent" href={`/agenda/novo?cust=${q.customer_id}${services ? `&svc=${services}` : ""}`}>Agendar o serviço</Link> : null}
        </section>
      ) : null}
      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <b>{company.company_name || "Eagle Detetizadora"}</b>
            {company.company_cnpj ? <><br /><small>CNPJ {company.company_cnpj}</small></> : null}
            {company.company_address ? <><br /><small>{company.company_address}</small></> : null}
            {company.company_phone || company.company_email ? <><br /><small>{[company.company_phone, company.company_email].filter(Boolean).join(" · ")}</small></> : null}
          </div>
          <div style={{ textAlign: "right" }}>
            <b>Cliente: {q.customer_name}</b>
            {q.customer_phone ? <><br /><small>{q.customer_phone}</small></> : null}
            {q.service_address ? <><br /><small>Local do serviço: {q.service_address}</small></> : null}
          </div>
        </div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Descrição</th><th className="n">Qtd.</th><th className="n">Valor unitário</th><th className="n">Total</th></tr></thead>
            <tbody>
              {items.map((i) => <tr key={i.id}><td>{i.description}</td><td className="n">{i.quantity.toLocaleString("pt-BR")}</td><td className="n">{money(i.unit_price_cents)}</td><td className="n">{money(i.total_cents)}</td></tr>)}
              <tr className="sub"><td colSpan={3}>Subtotal</td><td className="n">{money(q.items_cents)}</td></tr>
              {q.discount_cents ? <tr className="sub"><td colSpan={3}>Desconto</td><td className="n">− {money(q.discount_cents)}</td></tr> : null}
              <tr className="total"><td colSpan={3}>Total</td><td className="n">{money(q.total_cents)}</td></tr>
            </tbody>
          </table>
        </div>
        {q.payment_terms ? <div><small>Condições de pagamento</small><br />{q.payment_terms}</div> : null}
        {q.conditions ? <div><small>Condições e garantia</small><br /><span style={{ whiteSpace: "pre-line" }}>{q.conditions}</span></div> : null}
      </section>
      {q.notes && manage ? <section className="card noprint"><small>Observações internas (não saem na impressão)</small><p style={{ whiteSpace: "pre-line" }}>{q.notes}</p></section> : null}
    </>
  );
}
