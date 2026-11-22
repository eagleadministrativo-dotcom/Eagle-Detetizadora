import { requirePerm } from "@/server/session";
import { DATASETS } from "@/server/services/ops";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Dados e backup" };
const LABEL: Record<string, string> = { atendimentos: "Atendimentos", pagamentos: "Pagamentos", contas_a_pagar: "Contas a pagar", contas_a_receber: "Contas a receber", clientes: "Clientes", auditoria: "Auditoria" };

export default async function DataPage() {
  await requirePerm("data.export");
  return (
    <>
      <PageHead title="Dados e backup" sub="Seus dados são seus: exporte quando quiser. Cada exportação fica registrada na auditoria." />
      <section className="card stack">
        <h2>Planilhas (CSV, abre no Excel)</h2>
        <div className="row">{DATASETS.map((d) => <a key={d} className="btn ghost" href={`/api/export/${d}`}>{LABEL[d]}</a>)}</div>
        <small>Campos que começam com =, +, - ou @ são neutralizados para evitar execução de fórmulas na planilha.</small>
      </section>
      <section className="card stack">
        <h2>Backup completo (JSON)</h2>
        <p className="muted">Todas as tabelas da unidade, exceto senhas e segredos. Serve para migração e conferência. Guarde em local seguro: contém dados pessoais de clientes.</p>
        <div><a className="btn accent" href="/api/backup">Baixar backup lógico</a></div>
        <small>O backup automático do banco (com restauração a um ponto no tempo) é responsabilidade da hospedagem do banco de dados; veja docs/OPERACAO.md.</small>
      </section>
    </>
  );
}
