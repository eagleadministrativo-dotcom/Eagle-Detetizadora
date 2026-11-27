import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listQuotes, QUOTE_STATUS_LABEL } from "@/server/services/eagle";
import { fmtYmd, todayYmd } from "@/lib/dates";
import { Badge, Empty, Flash, PageHead, Pager, Seg, money } from "@/components/ui";
import { QuoteStatusBadge } from "@/components/eagle-ui";
import { importQuoteAction } from "@/app/actions/eagle";

export const metadata = { title: "Orçamentos" };
const SIZE = 40;

export default async function Quotes({ searchParams }: { searchParams: Promise<{ s?: string; p?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("quotes.view", "quotes.manage");
  const s = sp.s && sp.s in QUOTE_STATUS_LABEL ? sp.s : "";
  const page = Math.max(1, Number(sp.p) || 1);
  const { rows, total } = await listQuotes(await getDb(), ctx, { status: s || undefined, limit: SIZE, offset: (page - 1) * SIZE });
  const today = todayYmd();
  return (
    <>
      <PageHead title="Orçamentos" sub="No modelo da Eagle, prontos para imprimir, salvar em PDF ou baixar em Word. Aprovado, vira agendamento.">
        {can(ctx, "quotes.manage") ? <Link className="btn accent" href="/orcamentos/novo">+ Novo orçamento</Link> : null}
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      {can(ctx, "quotes.manage") && can(ctx, "customers.manage") ? (
        <details className="card confirm neutral">
          <summary>Importar orçamento de um arquivo (.docx ou .pdf)</summary>
          <form action={importQuoteAction} className="form">
            <input type="file" name="file" accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required />
            <small>O sistema lê os blocos do modelo (cliente, fone, serviços, aplicação, produtos, valor, pagamento, prazo, validade e os textos), acha ou cadastra o cliente e guarda o arquivo original na ficha dele. Depois é só conferir e salvar. Até 5 MB.</small>
            <div><button className="btn" type="submit">Importar</button></div>
          </form>
        </details>
      ) : null}
      <Seg items={[{ href: "/orcamentos", label: "Todos", active: !s }, ...Object.entries(QUOTE_STATUS_LABEL).map(([k, v]) => ({ href: `/orcamentos?s=${k}`, label: v, active: s === k }))]} />
      {rows.length === 0 ? (
        <Empty title={s ? "Nenhum orçamento nesta situação" : "Nenhum orçamento ainda"}>{can(ctx, "quotes.manage") && !s ? "Crie o primeiro em Novo orçamento." : null}</Empty>
      ) : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Nº</th><th>Cliente</th><th>Emissão</th><th>Validade</th><th className="n">Total</th><th>Situação</th></tr></thead>
            <tbody>
              {rows.map((q) => {
                const expired = q.valid_until && q.valid_until < today && (q.status === "rascunho" || q.status === "enviado");
                return (
                  <tr key={q.id}>
                    <td className="mono"><Link href={`/orcamentos/${q.id}`}>#{q.number}</Link></td>
                    <td><Link href={`/orcamentos/${q.id}`}>{q.customer_name}</Link></td>
                    <td className="nowrap">{fmtYmd(q.issue_date)}</td>
                    <td className="nowrap">{q.valid_until ? fmtYmd(q.valid_until) : "—"} {expired ? <Badge tone="bad">vencido</Badge> : null}</td>
                    <td className="n">{money(q.doc_value_cents)}</td>
                    <td><QuoteStatusBadge s={q.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager base={s ? `/orcamentos?s=${s}` : "/orcamentos"} page={page} total={total} size={SIZE} />
    </>
  );
}
