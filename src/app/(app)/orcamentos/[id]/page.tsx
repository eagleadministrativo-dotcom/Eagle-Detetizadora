import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can, getSettings } from "@/server/core";
import { getQuote } from "@/server/services/eagle";
import { fmtYmd, todayYmd } from "@/lib/dates";
import { Badge, Flash, PageHead } from "@/components/ui";
import { QuoteStatusBadge } from "@/components/eagle-ui";
import { QuoteDocument, type DocSettings } from "@/components/documents";
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
  const s = (await getSettings(db.query, ctx.unitId)) as unknown as DocSettings;
  const manage = can(ctx, "quotes.manage");
  const editable = q.status === "rascunho" || q.status === "enviado";
  const expired = q.valid_until && q.valid_until < todayYmd() && editable;
  const services = [...new Set([...(q.service_ids ?? []), ...items.map((i) => i.service_id)].filter(Boolean))].join(",");
  const when = `${q.scheduled_date ? `&d=${q.scheduled_date}` : ""}${q.scheduled_date && q.scheduled_time ? `&t=${q.scheduled_time}` : ""}`;
  const status = (value: string, label: string, cls = "btn") => (
    <form action={quoteStatusAction}><input type="hidden" name="id" value={q.id} /><input type="hidden" name="status" value={value} /><button className={cls} type="submit">{label}</button></form>
  );

  return (
    <>
      <PageHead title={`Orçamento nº ${q.number}`} sub={<>{q.customer_name} · {fmtYmd(q.issue_date)}{q.valid_until ? ` · vence em ${fmtYmd(q.valid_until)}` : ""}</>}>
        <QuoteStatusBadge s={q.status} />
        {expired ? <Badge tone="bad">vencido</Badge> : null}
        <Link className="btn accent" href={`/documento/orcamento/${q.id}`}>Ver documento / PDF</Link>
        <a className="btn ghost" href={`/api/documento/orcamento/${q.id}`}>Baixar Word</a>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <section className="card row noprint" style={{ gap: 10 }}>
        {manage && editable ? <Link className="btn" href={`/orcamentos/${q.id}/editar`}>Editar</Link> : null}
        {manage && q.status === "rascunho" ? status("enviado", "Marcar como enviado") : null}
        {manage && editable ? status("aprovado", "Cliente aprovou", "btn accent") : null}
        {manage && editable ? status("recusado", "Cliente recusou", "btn ghost") : null}
        {manage && !editable ? status("rascunho", "Voltar para rascunho", "btn ghost") : null}
        {q.status === "aprovado" && can(ctx, "agenda.create") ? <Link className="btn accent" href={`/agenda/novo?cust=${q.customer_id}${services ? `&svc=${services}` : ""}${when}`}>{q.scheduled_date ? `Agendar para ${fmtYmd(q.scheduled_date)}` : "Agendar o serviço"}</Link> : null}
        {can(ctx, "customers.view") ? <Link className="btn ghost" href={`/clientes/${q.customer_id}`}>Ficha do cliente</Link> : null}
        {q.file_id ? <a className="btn ghost" href={`/api/arquivo/cliente/${q.file_id}`}>Arquivo original</a> : null}
      </section>
      {q.notes && manage ? <div className="alert noprint"><b>Observações internas:</b> {q.notes}</div> : null}
      <div className="doc-preview"><QuoteDocument q={q} s={s} items={items} /></div>
    </>
  );
}
