import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { historySummary, listHistory, PAYMENT_KIND_LABEL } from "@/server/services/history";
import { fmtYmd } from "@/lib/dates";
import { Empty, PageHead, Pager, money } from "@/components/ui";

export const metadata = { title: "Histórico de serviços" };

export default async function History({ searchParams }: { searchParams: Promise<{ q?: string; ano?: string; pg?: string; p?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("customers.history");
  const db = await getDb();
  const year = Number(sp.ano) || null;
  const payment = sp.pg && sp.pg in PAYMENT_KIND_LABEL ? sp.pg : null;
  const q = sp.q?.trim() || null;
  const page = Math.max(1, Number(sp.p) || 1);
  const [list, sum] = await Promise.all([listHistory(db, ctx, { q, year, payment, page }), historySummary(db, ctx)]);
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (year) qs.set("ano", String(year));
  if (payment) qs.set("pg", payment);
  const base = `/historico${qs.size ? `?${qs}` : ""}`;
  const all = sum.years.reduce((a, y) => ({ n: a.n + y.n, total: a.total + y.total }), { n: 0, total: 0 });

  return (
    <>
      <PageHead title="Histórico de serviços" sub="Serviços já prestados pela Eagle, vindos das planilhas de vendas. Cada um também aparece na ficha do cliente." />
      {all.n === 0 ? <Empty title="Nenhum serviço no histórico ainda" /> : (
        <>
          <section className="card stack">
            <h2>Por ano</h2>
            <div className="tablewrap"><table>
              <thead><tr><th>Ano</th><th className="n">Serviços</th><th className="n">Clientes</th><th className="n">Valor</th></tr></thead>
              <tbody>
                {sum.years.map((y) => <tr key={y.year}><td><Link href={`/historico?ano=${y.year}`}>{y.year}</Link></td><td className="n">{y.n}</td><td className="n">{y.customers}</td><td className="n">{money(y.total)}</td></tr>)}
                <tr><td><b>Total</b></td><td className="n"><b>{all.n}</b></td><td /><td className="n"><b>{money(all.total)}</b></td></tr>
              </tbody>
            </table></div>
            <details>
              <summary>Por forma de pagamento</summary>
              <div className="tablewrap"><table>
                <thead><tr><th>Forma</th><th className="n">Serviços</th><th className="n">Valor</th></tr></thead>
                <tbody>{sum.pays.map((p) => <tr key={p.kind ?? "-"}><td>{p.kind ? <Link href={`/historico?pg=${p.kind}`}>{PAYMENT_KIND_LABEL[p.kind] ?? p.kind}</Link> : "Não informada"}</td><td className="n">{p.n}</td><td className="n">{money(p.total)}</td></tr>)}</tbody>
              </table></div>
            </details>
          </section>

          <form className="card form" method="get" action="/historico">
            <div className="fields">
              <label>Buscar<input name="q" defaultValue={q ?? ""} placeholder="Cliente, serviço, endereço, telefone ou CNPJ" /></label>
              <label>Ano<select name="ano" defaultValue={year ?? ""}><option value="">Todos</option>{sum.years.map((y) => <option key={y.year} value={y.year}>{y.year}</option>)}</select></label>
              <label>Pagamento<select name="pg" defaultValue={payment ?? ""}><option value="">Todos</option>{Object.entries(PAYMENT_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            </div>
            <div className="row"><button className="btn" type="submit">Filtrar</button>{qs.size ? <Link className="btn ghost" href="/historico">Limpar</Link> : null}<span className="grow" /><small className="muted">{list.count} serviço(s) · {money(list.totalCents)}</small></div>
          </form>

          {list.rows.length === 0 ? <Empty title="Nada encontrado com esses filtros" /> : (
            <div className="tablewrap"><table>
              <thead><tr><th>Data</th><th>Cliente</th><th>Serviço</th><th className="n">Valor</th><th>Pagamento</th></tr></thead>
              <tbody>
                {list.rows.map((h) => (
                  <tr key={h.id}>
                    <td className="nowrap">{fmtYmd(h.service_date)}</td>
                    <td><Link href={`/clientes/${h.customer_id}`}>{h.customer_name}</Link>{h.service_address ? <><br /><small>{h.service_address}</small></> : null}</td>
                    <td>{h.description || "—"}{h.seller ? <><br /><small>Vendedora: {h.seller}</small></> : null}</td>
                    <td className="n nowrap">{h.amount_cents != null ? money(h.amount_cents) : <small>{h.amount_note || "—"}</small>}</td>
                    <td>{h.payment_kind ? PAYMENT_KIND_LABEL[h.payment_kind] ?? h.payment_kind : "—"}{h.payment_detail ? <><br /><small>{h.payment_detail}</small></> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          <Pager base={base} page={list.page} total={list.count} size={100} />
        </>
      )}
    </>
  );
}
