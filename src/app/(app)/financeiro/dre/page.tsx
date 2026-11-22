import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { getDre } from "@/server/services/reports";
import { addMonths, fmtYmd, monthEnd, monthStart, todayYmd } from "@/lib/dates";
import { fmtBRL, fmtPct } from "@/lib/money";
import { PageHead, Seg } from "@/components/ui";

export const metadata = { title: "DRE gerencial" };

export default async function DrePage({ searchParams }: { searchParams: Promise<{ m?: string; de?: string; ate?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("finance.view");
  const today = todayYmd();
  const custom = /^\d{4}-\d{2}-\d{2}$/.test(sp.de ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(sp.ate ?? "") && sp.de! <= sp.ate!;
  const m = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? `${sp.m}-01` : monthStart(today);
  const p = custom ? { start: sp.de!, end: sp.ate! } : { start: m, end: monthEnd(m) };
  const { current: c, previous: pv } = await getDre(await getDb(), ctx, p);
  const prevMap = new Map(pv.lines.map((l) => [l.key, l.cents]));
  const prevLabel = `${fmtYmd(pv.period.start)} a ${fmtYmd(pv.period.end)}`;
  const nav = (n: number) => `/financeiro/dre?m=${addMonths(m, n).slice(0, 7)}`;
  return (
    <>
      <PageHead title="DRE gerencial" sub={<>Regime de <b>competência</b> · {fmtYmd(p.start)} a {fmtYmd(p.end)}. Não é demonstração contábil oficial.</>}>
        <Seg items={[{ href: nav(-1), label: "‹ Mês anterior", active: false }, { href: "/financeiro/dre", label: "Mês atual", active: !custom && m === monthStart(today) }, { href: nav(1), label: "Próximo ›", active: false }]} />
      </PageHead>
      <form className="filters" method="get">
        <label>De<input type="date" name="de" defaultValue={p.start} /></label>
        <label>Até<input type="date" name="ate" defaultValue={p.end} /></label>
        <button className="btn ghost" type="submit">Aplicar intervalo</button>
      </form>
      {c.warnings.length ? <div className="stack">{c.warnings.map((w) => <div className="alert warn" key={w}>{w}</div>)}</div> : null}
      <div className="tablewrap">
        <table>
          <thead><tr><th>Linha</th><th className="n">Valor</th><th className="n">% da receita líquida</th><th className="n">Período anterior</th></tr></thead>
          <tbody>
            {c.lines.map((l) => {
              const pc = prevMap.get(l.key);
              const link = l.categoryId ? `/relatorios/${l.group === "custo" ? "costs" : l.group === "imposto" ? "taxes" : l.group === "nao_operacional" ? "non_operating" : "expenses"}?de=${p.start}&ate=${p.end}` : l.key === "gross" || l.key === "net_revenue" ? `/relatorios/revenue?de=${p.start}&ate=${p.end}` : null;
              return (
                <tr key={l.key} className={l.group === "total" ? "total" : l.group ? "sub" : ""}>
                  <td>{link ? <Link href={link}>{l.label}</Link> : l.label}</td>
                  <td className="n" style={l.cents < 0 && l.group === "total" ? { color: "var(--bad)" } : undefined}>{fmtBRL(l.cents)}</td>
                  <td className="n">{c.netRevenue > 0 ? fmtPct((l.cents / c.netRevenue) * 100) : "—"}</td>
                  <td className="n">{pc == null ? <small>—</small> : fmtBRL(pc)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid cols-3">
        <div className="card"><small>Índice de margem de contribuição</small><div className="value mono" style={{ fontFamily: "var(--serif)", fontSize: "1.4rem" }}>{c.contributionRatio == null ? "—" : fmtPct(c.contributionRatio * 100)}</div><small>margem ÷ receita líquida</small></div>
        <div className="card"><small>Ponto de equilíbrio (receita mensal)</small><div className="mono" style={{ fontFamily: "var(--serif)", fontSize: "1.4rem" }}>{c.breakEven == null ? "—" : fmtBRL(c.breakEven)}</div><small>(despesas + impostos) ÷ índice de margem; só quando a margem é positiva</small></div>
        <div className="card"><small>Distribuição de lucros (fora da DRE)</small><div className="mono" style={{ fontFamily: "var(--serif)", fontSize: "1.4rem" }}>{fmtBRL(c.profitDistribution)}</div><small>Lançada por competência, não reduz o resultado operacional.</small></div>
      </div>
      <details className="card">
        <summary><b>Como esta DRE é calculada</b></summary>
        <ul>
          <li><b>Receita:</b> atendimentos concluídos no período (por data de conclusão), menos descontos; mais cobranças avulsas.</li>
          <li><b>Taxas de meios de pagamento:</b> taxas dos pagamentos registrados no período (usa a taxa cadastrada de cada forma).</li>
          <li><b>Custos, despesas e impostos:</b> contas a pagar ativas pela data de competência (ou vencimento, se não houver). Cancelar uma conta a retira.</li>
          <li><b>Pró-labore</b> entra nas despesas; <b>distribuição de lucros, aportes e empréstimos</b> não são receita nem despesa operacional.</li>
          <li>Comparação com o período anterior de mesma duração: {prevLabel}.</li>
        </ul>
      </details>
    </>
  );
}
