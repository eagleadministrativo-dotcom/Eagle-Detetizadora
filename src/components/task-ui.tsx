import Link from "next/link";
import type { TaskRow } from "@/server/services/tasks";
import { TASK_STATUS_LABEL } from "@/server/services/tasks";
import { taskStepAction } from "@/app/actions/tasks";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { Badge } from "./ui";

export const TaskBadge = ({ s }: { s: string }) => <Badge tone={s === "concluida" ? "ok" : s === "em_andamento" ? "info" : s === "aguardando_aprovacao" ? "warn" : ""}>{TASK_STATUS_LABEL[s] ?? s}</Badge>;
export const due = (t: Pick<TaskRow, "due_at" | "due_has_time">) => (t.due_at ? (t.due_has_time ? fmtDateTime(t.due_at) : fmtDate(t.due_at)) : null);

export function TaskItem({ t, back }: { t: TaskRow; back: string }) {
  const open = t.my_status && t.my_status !== "concluida" && (t.status === "pendente" || t.status === "em_andamento");
  return (
    <div className="item2" data-spot="">
      <span className={`pri ${t.priority}`} title={`Prioridade ${t.priority}`} aria-label={`Prioridade ${t.priority}`} role="img" />
      <div>
        <Link href={`/tarefas/${t.id}`} style={{ textDecoration: "none" }}><b>{t.title}</b></Link>
        <div className="meta">
          {due(t) ? <span className={t.overdue ? "late" : ""}>{t.overdue ? "Atrasada: " : "Prazo "}{due(t)}</span> : null}
          <span>{t.people}</span>
          {t.n > 1 ? <span>{t.mode === "coletiva" ? "Coletiva" : `${t.done} de ${t.n} concluíram`}</span> : null}
          {t.recurring ? <span>Recorrente</span> : null}
          {t.category ? <span>{t.category}</span> : null}
        </div>
      </div>
      <div className="row act"><TaskBadge s={t.status} />{open ? <form action={taskStepAction} style={{ display: "contents" }}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="step" value="concluir" /><button className="btn small" type="submit">Concluir</button></form> : null}</div>
    </div>
  );
}

export function PeoplePick({ people, selected = [], main }: { people: { id: string; full_name: string }[]; selected?: string[]; main?: string | null }) {
  return (
    <fieldset>
      <legend>Responsáveis</legend>
      <div className="chips">{people.map((p) => <label className="chip" key={p.id}><input type="checkbox" name="assignees" value={p.id} defaultChecked={selected.includes(p.id)} />{p.full_name}</label>)}</div>
      {people.length > 1 ? <label style={{ marginTop: 12 }}>Responsável principal<select name="main" defaultValue={main ?? ""}><option value="">O primeiro selecionado</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label> : null}
    </fieldset>
  );
}
