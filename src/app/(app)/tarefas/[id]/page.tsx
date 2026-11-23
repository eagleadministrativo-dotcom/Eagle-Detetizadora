import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { requireSession } from "@/server/session";
import { can } from "@/server/core";
import { isDomainError } from "@/server/errors";
import { getTask, listPeople } from "@/server/services/tasks";
import { fmtDateTime, fmtTime, toYmd } from "@/lib/dates";
import { ruleLabel } from "@/lib/recurrence";
import { Badge, ConfirmAction, Field, Flash, PageHead } from "@/components/ui";
import { PeoplePick, TaskBadge, due } from "@/components/task-ui";
import { commentTaskAction, createTaskAction, taskStepAction, updateTaskAction } from "@/app/actions/tasks";

export const metadata = { title: "Tarefa" };
const ACT: Record<string, string> = { TAREFA_CRIADA: "criou", TAREFA_INICIADA: "iniciou", TAREFA_CONCLUSAO: "concluiu", TAREFA_APROVADA: "aprovou", TAREFA_DEVOLVIDA: "devolveu para revisão", TAREFA_ALTERADA: "editou", TAREFA_CANCELADA: "cancelou", TAREFA_COMENTARIO: "comentou", TAREFA_ANEXO: "anexou um arquivo" };

const Step = ({ id, step, label, accent }: { id: string; step: string; label: string; accent?: boolean }) => <form action={taskStepAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="step" value={step} /><button className={`btn ${accent ? "accent" : ""}`} type="submit">{label}</button></form>;

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requireSession();
  const db = await getDb();
  let d;
  try { d = await getTask(db, ctx, id); } catch (e) { if (isDomainError(e)) { if (e.code === "forbidden") redirect("/sem-permissao"); notFound(); } throw e; }
  const { task: t } = d;
  const open = t.status === "pendente" || t.status === "em_andamento";
  const myOpen = d.mine && open && d.assignees.find((a) => a.user_id === ctx.userId)?.status !== "concluida";
  const all = d.canEdit ? await listPeople(db, ctx) : [];
  const current = new Set(d.assignees.map((a) => a.user_id));
  const people = can(ctx, "tasks.delegate") ? all : all.filter((p) => p.id === ctx.userId || current.has(p.id));
  return (
    <>
      <PageHead title={t.title} sub={<>Criada por {t.creator} em {fmtDateTime(t.created_at)}{t.rule ? <> · {ruleLabel(t.rule)}</> : null}</>}>
        <TaskBadge s={t.status} />{t.overdue ? <Badge tone="bad">Atrasada</Badge> : null}
        <Link className="btn ghost" href={t.parent_id ? `/tarefas/${t.parent_id}` : "/tarefas"}>Voltar</Link>
      </PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid asym">
        <div className="grid">
          <section className="card stack lit">
            <div className="row">
              {myOpen && t.status === "pendente" ? <Step id={t.id} step="iniciar" label="Iniciar" /> : null}
              {myOpen ? <Step id={t.id} step="concluir" label={t.n > 1 && t.mode === "individual" ? "Concluir a minha parte" : t.requires_approval ? "Enviar para aprovação" : "Concluir"} accent /> : null}
              {t.status === "aguardando_aprovacao" && d.canApprove ? <Step id={t.id} step="aprovar" label="Aprovar" accent /> : null}
            </div>
            {t.description ? <p style={{ whiteSpace: "pre-wrap" }}>{t.description}</p> : <p className="muted">Sem instruções.</p>}
            <div className="row"><Badge>Prioridade {t.priority}</Badge>{t.category ? <Badge>{t.category}</Badge> : null}{due(t) ? <Badge tone={t.overdue ? "bad" : ""}>Prazo {due(t)}</Badge> : null}{t.requires_approval ? <Badge>Exige aprovação</Badge> : null}</div>
            {t.cancel_reason ? <div className="alert">Cancelada: {t.cancel_reason}</div> : null}
            {t.status === "aguardando_aprovacao" && d.canApprove ? <ConfirmAction label="Devolver para revisão" tone="neutral" action={taskStepAction} submit="Devolver"><input type="hidden" name="id" value={t.id} /><input type="hidden" name="step" value="devolver" /><Field label="O que falta"><textarea name="note" required minLength={3} /></Field></ConfirmAction> : null}
          </section>
          <section className="card stack">
            <h2>Comentários e anexos</h2>
            {d.files.length ? <div className="chips">{d.files.map((f) => <a className="chip" key={f.id} href={`/api/arquivo/tarefa/${f.id}`} download>{f.name} · {Math.ceil(f.size_bytes / 1024)} KB</a>)}</div> : null}
            {d.comments.map((c) => <div key={c.id}><b>{c.full_name}</b> <small>{fmtDateTime(c.created_at)}</small><p style={{ whiteSpace: "pre-wrap" }}>{c.body}</p></div>)}
            <form action={commentTaskAction} className="form">
              <input type="hidden" name="id" value={t.id} />
              <Field label="Novo comentário"><textarea name="body" maxLength={2000} /></Field>
              {d.assignees.some((a) => a.user_id !== ctx.userId) ? <fieldset><legend>Mencionar</legend><div className="chips">{d.assignees.filter((a) => a.user_id !== ctx.userId).map((a) => <label className="chip" key={a.user_id}><input type="checkbox" name="mentions" value={a.user_id} />{a.full_name}</label>)}</div></fieldset> : null}
              <Field label="Anexar arquivo"><input type="file" name="files" accept="image/png,image/jpeg,image/webp,application/pdf,text/plain" /></Field>
              <div><button className="btn" type="submit">Publicar</button></div>
            </form>
          </section>
        </div>
        <div className="grid">
          <section className="card stack">
            <h2>Responsáveis</h2>
            {t.n > 1 ? <small>{t.mode === "coletiva" ? "Coletiva: uma conclusão vale para todos." : `${t.done} de ${t.n} concluíram.`}</small> : null}
            {d.assignees.map((a) => <div className="row" key={a.user_id}><span className="grow">{a.full_name}{a.user_id === t.main_assignee_id && t.n > 1 ? <small> · principal</small> : null}</span><TaskBadge s={a.status} /></div>)}
          </section>
          {d.subs.length || (d.canEdit && !t.parent_id && open) ? (
            <section className="card stack">
              <h2>Subtarefas</h2>
              {d.subs.map((x) => <Link key={x.id} className="row" href={`/tarefas/${x.id}`}><span className="grow">{x.title} <small>· {x.people}</small></span><TaskBadge s={x.status} /></Link>)}
              {d.canEdit && !t.parent_id && open && can(ctx, "tasks.create") ? <ConfirmAction label="Adicionar subtarefa" tone="neutral" action={createTaskAction} submit="Criar subtarefa"><input type="hidden" name="parentId" value={t.id} /><Field label="Título"><input name="title" required minLength={3} /></Field><PeoplePick people={people} selected={[...current]} /></ConfirmAction> : null}
            </section>
          ) : null}
          {d.canEdit && open ? (
            <section className="card stack">
              <h2>Gerenciar</h2>
              <ConfirmAction label="Editar" tone="neutral" action={updateTaskAction} submit="Salvar">
                <input type="hidden" name="id" value={t.id} />
                <Field label="Título"><input name="title" defaultValue={t.title} required minLength={3} /></Field>
                <Field label="Instruções"><textarea name="description" defaultValue={t.description ?? ""} /></Field>
                <div className="fields">
                  <Field label="Prioridade"><select name="priority" defaultValue={t.priority}><option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></Field>
                  <Field label="Categoria"><input name="category" defaultValue={t.category ?? ""} /></Field>
                  <Field label="Prazo"><input type="date" name="dueDate" defaultValue={t.due_at ? toYmd(t.due_at) : ""} /></Field>
                  <Field label="Horário"><input type="time" name="dueTime" defaultValue={t.due_at && t.due_has_time ? fmtTime(t.due_at) : ""} /></Field>
                </div>
                <PeoplePick people={people} selected={[...current]} main={t.main_assignee_id} />
              </ConfirmAction>
              <ConfirmAction label="Cancelar tarefa" action={taskStepAction} submit="Cancelar tarefa" warn="As subtarefas em aberto também são canceladas. O histórico é mantido.">
                <input type="hidden" name="id" value={t.id} /><input type="hidden" name="step" value="cancelar" />
                <Field label="Motivo"><input name="reason" required minLength={3} /></Field>
                {t.recurring ? <label className="check"><input type="checkbox" name="stop" />Parar também as próximas repetições</label> : null}
              </ConfirmAction>
            </section>
          ) : null}
          <section className="card stack">
            <h2>Histórico</h2>
            {d.history.map((h, i) => <small key={i}>{fmtDateTime(h.created_at)} · {h.user_name ?? "Sistema"} {ACT[h.action] ?? h.action}{h.note ? `: ${h.note}` : ""}</small>)}
          </section>
        </div>
      </div>
    </>
  );
}
