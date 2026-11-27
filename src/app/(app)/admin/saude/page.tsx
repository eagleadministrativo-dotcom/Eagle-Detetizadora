import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { healthReport } from "@/server/services/health";
import { fmtDateTime } from "@/lib/dates";
import { Badge, Empty, PageHead, Stat } from "@/components/ui";

export const metadata = { title: "Saúde do sistema" };
export const dynamic = "force-dynamic";

const JOB_LABEL: Record<string, string> = { lembretes: "Lembretes e avisos (a cada 5 min)", diaria: "Rotina diária (9h)" };
const EXPECT_MIN: Record<string, number> = { lembretes: 20, diaria: 26 * 60 };

export default async function Health() {
  const { ctx } = await requirePerm("audit.view");
  const r = await healthReport(await getDb(), ctx);
  const late = (j: { job: string; ageMin: number }) => j.ageMin > (EXPECT_MIN[j.job] ?? 60);
  const bad = r.jobs.filter((j) => j.status === "erro" || late(j)).length;
  return (
    <>
      <PageHead eyebrow="Sistema" title="Saúde do sistema" sub="Rotinas automáticas, erros do servidor e alterações feitas fora do aplicativo." />
      <section className="stats">
        <Stat label="Rotinas com problema" value={bad} tone={bad ? "hi" : ""} hint={bad ? "veja abaixo" : "tudo rodando"} />
        <Stat label="Erros nas últimas 24 h" value={r.errors24h} />
        <Stat label="Alterações diretas (30 dias)" value={r.directCount30d} hint="feitas fora do app" tone={r.directCount30d ? "ol" : ""} />
      </section>

      <section className="card">
        <h2>Rotinas agendadas</h2>
        {r.jobs.length === 0 ? <Empty title="Nenhuma execução registrada ainda">O registro começa na próxima execução de cada rotina.</Empty> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Rotina</th><th>Última execução</th><th>Situação</th><th>Sucesso em 7 dias</th><th>Execuções em 24 h</th></tr></thead>
            <tbody>{r.jobs.map((j) => (
              <tr key={j.job}>
                <td>{JOB_LABEL[j.job] ?? j.job}</td>
                <td>{j.last ? fmtDateTime(j.last) : "—"}</td>
                <td>{j.status === "erro" ? <Badge tone="bad">Falhou</Badge> : late(j) ? <Badge tone="warn">Atrasada</Badge> : j.status === "rodando" ? <Badge tone="info">Rodando</Badge> : <Badge tone="ok">Ok</Badge>}
                  {j.error ? <><br /><small>{j.error}</small></> : null}</td>
                <td>{j.okRate == null ? "—" : `${j.okRate}%`}</td>
                <td>{j.runs24h}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
        <small>Se uma rotina falhar, o administrador recebe um aviso crítico (e notificação no celular, se ativada).</small>
      </section>

      <section className="card">
        <h2>Erros recentes do servidor</h2>
        {r.recentErrors.length === 0 ? <Empty title="Nenhum erro registrado" /> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Quando</th><th>Onde</th><th>Mensagem</th></tr></thead>
            <tbody>{r.recentErrors.map((e, i) => <tr key={i}><td>{fmtDateTime(e.at)}</td><td><code>{e.path ?? "—"}</code></td><td>{e.message}{e.digest ? <><br /><small>ref. {e.digest}</small></> : null}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="card">
        <h2>Alterações feitas fora do aplicativo</h2>
        <p className="muted">Mudanças feitas direto no banco (editor SQL, ferramentas) ficam registradas aqui, com o antes e o depois. O registro não pode ser apagado.</p>
        {r.directChanges.length === 0 ? <Empty title="Nenhuma alteração direta registrada" /> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Quando</th><th>Tabela</th><th>Operação</th><th>Registro</th><th>Origem</th></tr></thead>
            <tbody>{r.directChanges.map((c, i) => <tr key={i}><td>{fmtDateTime(c.at)}</td><td>{c.table_name}</td><td>{c.op === "UPDATE" ? "Alteração" : c.op === "DELETE" ? "Exclusão" : "Inclusão"}</td><td><code>{c.row_id?.slice(0, 8) ?? "—"}</code></td><td>{c.app_name || "—"} · {c.db_user}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
