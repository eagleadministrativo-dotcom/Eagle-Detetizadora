import Link from "next/link";
import { getDb } from "@/server/db";
import { requireSession } from "@/server/session";
import { can } from "@/server/core";
import { listPeople, listTasks } from "@/server/services/tasks";
import { Empty, Flash, PageHead, Pager, Seg } from "@/components/ui";
import { TaskItem } from "@/components/task-ui";

export const metadata = { title: "Tarefas" };
type SP = { e?: string; s?: string; u?: string; p?: string; ok?: string; erro?: string };
const SCOPES = ["minhas", "criadas", "equipe"] as const, STATES = ["abertas", "atrasadas", "aprovar", "encerradas"] as const;

export default async function Tasks({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx } = await requireSession();
  const db = await getDb();
  const team = can(ctx, "tasks.view_team"), create = can(ctx, "tasks.create");
  const scope = SCOPES.find((x) => x === sp.e) ?? "minhas", state = STATES.find((x) => x === sp.s) ?? "abertas";
  const page = Math.max(1, Number(sp.p) || 1);
  const user = scope === "equipe" && /^[0-9a-f-]{36}$/.test(sp.u ?? "") ? sp.u! : null;
  const { rows, total } = await listTasks(db, ctx, { scope, state, userId: user, limit: 30, offset: (page - 1) * 30 });
  const people = team && scope === "equipe" ? await listPeople(db, ctx) : [];
  const href = (o: Partial<SP>) => `/tarefas?${new URLSearchParams({ e: scope, s: state, ...(user ? { u: user } : {}), ...(o as Record<string, string>) }).toString()}`;
  return (
    <>
      <PageHead title="Tarefas" sub={scope === "equipe" ? "O que a equipe tem em aberto." : "O que está com você, por urgência e prazo."}>
        {create ? <Link className="btn accent" href="/tarefas/nova">Nova tarefa</Link> : null}
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="calbar">
        {team || create ? <Seg items={[{ href: href({ e: "minhas" }), label: "Minhas", active: scope === "minhas" }, ...(create ? [{ href: href({ e: "criadas" }), label: "Que criei", active: scope === "criadas" }] : []), ...(team ? [{ href: href({ e: "equipe" }), label: "Equipe", active: scope === "equipe" }] : [])]} /> : null}
        <Seg items={[{ href: href({ s: "abertas" }), label: "Abertas", active: state === "abertas" }, { href: href({ s: "atrasadas" }), label: "Atrasadas", active: state === "atrasadas" }, { href: href({ s: "aprovar" }), label: "Aguardando aprovação", active: state === "aprovar" }, { href: href({ s: "encerradas" }), label: "Encerradas", active: state === "encerradas" }]} />
      </div>
      {people.length ? <form className="filters" method="get"><input type="hidden" name="e" value={scope} /><input type="hidden" name="s" value={state} /><label>Funcionário<select name="u" defaultValue={user ?? ""}><option value="">Todos</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label><button className="btn ghost" type="submit">Filtrar</button></form> : null}
      {rows.length === 0 ? <Empty title={state === "abertas" ? "Nada pendente" : "Nenhuma tarefa aqui"}>{create && state === "abertas" ? "Crie uma tarefa para você ou delegue à equipe." : null}</Empty> : <div className="list">{rows.map((t) => <TaskItem key={t.id} t={t} back={href({})} />)}</div>}
      {total > 30 ? <Pager base={href({})} page={page} total={total} size={30} /> : null}
    </>
  );
}
