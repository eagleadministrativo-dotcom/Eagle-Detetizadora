import type { Db, Q } from "../db";
import { audit, can, requireText, requireUuid } from "../core";
import { DomainError, ForbiddenError } from "../errors";
import type { Ctx } from "../permissions";
import { addDays, atLocal, fmtDate, fmtDateTime, todayYmd } from "@/lib/dates";
import { occurrences, parseRule, type Rule } from "@/lib/recurrence";
import { emit } from "./events";
import { notifyUsers } from "./notify";

export const PRIORITIES = ["baixa", "normal", "alta", "urgente"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const TASK_STATUS_LABEL: Record<string, string> = { pendente: "Pendente", em_andamento: "Em andamento", aguardando_aprovacao: "Aguardando aprovação", concluida: "Concluída", cancelada: "Cancelada" };
const OPEN = "('pendente','em_andamento','aguardando_aprovacao')";
const MAX_FILE = 2 * 1024 * 1024;
const MIMES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain"]);

export interface FileInput { name: string; mime: string; bytes: Uint8Array }
export interface TaskInput {
  title: string; description?: string | null; category?: string | null; priority?: Priority; mode?: "individual" | "coletiva"; requiresApproval?: boolean;
  assignees: string[]; mainAssignee?: string | null; dueDate?: string | null; dueTime?: string | null; parentId?: string | null;
  recurrence?: Rule | null; recurrenceEnd?: string | null; files?: FileInput[];
}

async function assertAssignees(q: Q, ctx: Ctx, ids: string[]) {
  if (!ids.length) throw new DomainError("invalid", "Escolha pelo menos um responsável.");
  if (ids.some((i) => i !== ctx.userId) && !can(ctx, "tasks.delegate")) throw new ForbiddenError("Você só pode criar tarefas para você.");
  for (const id of ids) requireUuid(id, "Responsável");
  const [r] = await q<{ n: number }>("select count(*)::bigint as n from users u join user_units uu on uu.user_id=u.id where uu.unit_id=$1 and u.is_active and u.id = any($2::uuid[])", [ctx.unitId, ids]);
  if (r.n !== new Set(ids).size) throw new DomainError("invalid", "Responsável inexistente ou inativo.");
}

const dueFrom = (date?: string | null, time?: string | null) => {
  if (!date) return { at: null as Date | null, hasTime: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (time && !/^\d{2}:\d{2}$/.test(time))) throw new DomainError("invalid", "Prazo inválido.");
  return time ? { at: atLocal(date, time), hasTime: true } : { at: atLocal(date, "23:59"), hasTime: false };
};
const dueText = (at: Date | null, hasTime: boolean) => (at ? `, prazo ${hasTime ? fmtDateTime(at) : fmtDate(at)}` : "");

function checkFile(f: FileInput) {
  if (!MIMES.has(f.mime)) throw new DomainError("invalid", "Anexo não permitido. Use imagem, PDF ou texto.");
  if (f.bytes.byteLength === 0 || f.bytes.byteLength > MAX_FILE) throw new DomainError("invalid", "Cada anexo pode ter até 2 MB.");
}
async function addFileTx(q: Q, ctx: Ctx, taskId: string, f: FileInput) {
  checkFile(f);
  await q("insert into task_attachments(task_id,user_id,name,mime,size_bytes,content_b64) values ($1,$2,$3,$4,$5,$6)", [taskId, ctx.userId, f.name.replace(/[^\w.\- ()À-ÿ]/g, "_").slice(0, 120) || "anexo", f.mime, f.bytes.byteLength, Buffer.from(f.bytes).toString("base64")]);
}

async function insertTask(q: Q, ctx: Ctx, i: TaskInput, occ?: { ruleId: string; date: string }): Promise<string | null> {
  const due = dueFrom(occ?.date ?? i.dueDate, i.dueTime);
  const main = i.mainAssignee && i.assignees.includes(i.mainAssignee) ? i.mainAssignee : i.assignees[0];
  const [t] = await q<{ id: string }>(
    `insert into tasks(unit_id,parent_id,recurrence_rule_id,occurrence_date,title,description,category,priority,mode,requires_approval,main_assignee_id,due_at,due_has_time,created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (recurrence_rule_id, occurrence_date) where recurrence_rule_id is not null do nothing returning id`,
    [ctx.unitId, i.parentId ?? null, occ?.ruleId ?? null, occ?.date ?? null, i.title, i.description ?? null, i.category ?? null, i.priority ?? "normal", i.mode ?? "individual", i.requiresApproval ?? false, main, due.at, due.hasTime, ctx.userId],
  );
  if (!t) return null;
  for (const u of new Set(i.assignees)) await q("insert into task_assignees(task_id,user_id) values ($1,$2)", [t.id, u]);
  await emit(q, ctx, "task.assigned", "task", t.id, { assignees: i.assignees }, `task.assigned:${t.id}`);
  await notifyUsers(q, {
    unitId: ctx.unitId, userIds: i.assignees.filter((u) => u !== ctx.userId || occ), kind: "tarefa_atribuida", severity: i.priority === "urgente" ? "critico" : i.priority === "alta" ? "atencao" : "info",
    message: `Nova tarefa: ${i.title}${dueText(due.at, due.hasTime)}.`, url: `/tarefas/${t.id}`, ref: ["task", t.id], dedupe: `task.assigned:${t.id}`,
  });
  return t.id;
}

/** Cria a tarefa. Com recorrência, cria a regra e gera a primeira leva; cada execução é uma tarefa própria. */
export async function createTask(db: Db, ctx: Ctx, input: TaskInput): Promise<string> {
  if (!can(ctx, "tasks.create")) throw new ForbiddenError("Você não tem permissão para criar tarefas.");
  const i: TaskInput = { ...input, title: requireText(input.title, "Título", 3).slice(0, 160), assignees: [...new Set(input.assignees)] };
  if (i.priority && !PRIORITIES.includes(i.priority)) throw new DomainError("invalid", "Prioridade inválida.");
  return db.tx(async (q) => {
    await assertAssignees(q, ctx, i.assignees);
    if (i.parentId) {
      const [p] = await q<{ parent_id: string | null }>("select parent_id from tasks where id=$1 and unit_id=$2", [requireUuid(i.parentId, "Tarefa principal"), ctx.unitId]);
      if (!p) throw new DomainError("not_found", "Tarefa principal não encontrada.");
      if (p.parent_id) throw new DomainError("invalid", "Uma subtarefa não pode ter outras subtarefas.");
      await access(q, ctx, i.parentId, "edit");
    }
    let id: string | null;
    if (i.recurrence) {
      if (!i.dueDate) throw new DomainError("invalid", "Informe a data inicial da recorrência.");
      const rule = parseRule(i.recurrence);
      if (!rule) throw new DomainError("invalid", "Recorrência inválida.");
      dueFrom(i.dueDate, i.dueTime);
      const { files: _f, recurrence: _r, ...template } = i;
      void _f; void _r;
      const [r] = await q<{ id: string }>("insert into task_recurrence_rules(unit_id,template,rule,start_date,end_date,created_by) values ($1,$2,$3,$4,$5,$6) returning id", [ctx.unitId, JSON.stringify(template), JSON.stringify(rule), i.dueDate, i.recurrenceEnd ?? null, ctx.userId]);
      const first = occurrences(rule, i.dueDate, addDays(i.dueDate, 400), 1)[0];
      id = first ? await insertTask(q, ctx, i, { ruleId: r.id, date: first }) : null;
      if (!id) throw new DomainError("invalid", "A recorrência não gera nenhuma data.");
    } else id = (await insertTask(q, ctx, i))!;
    for (const f of i.files ?? []) await addFileTx(q, ctx, id, f);
    await audit(q, ctx, "TAREFA_CRIADA", "task", id, null, { title: i.title, assignees: i.assignees, recurrence: i.recurrence ?? null });
    return id;
  });
}

interface TaskCore { id: string; title: string; status: string; mode: string; requires_approval: boolean; created_by: string; due_at: Date | null; due_has_time: boolean; parent_id: string | null; recurrence_rule_id: string | null }

/** Carrega a tarefa com trava e confere o acesso: ver (participante ou equipe), editar (criador com tasks.edit, ou quem gere a equipe) e aprovar. */
async function access(q: Q, ctx: Ctx, id: string, need: "view" | "edit" | "approve", lock = false): Promise<TaskCore & { mine: boolean }> {
  const [t] = await q<TaskCore>(`select id,title,status,mode,requires_approval,created_by,due_at,due_has_time,parent_id,recurrence_rule_id from tasks where id=$1 and unit_id=$2 ${lock ? "for update" : ""}`, [requireUuid(id, "Tarefa"), ctx.unitId]);
  if (!t) throw new DomainError("not_found", "Tarefa não encontrada.");
  const [m] = await q("select 1 from task_assignees where task_id=$1 and user_id=$2", [id, ctx.userId]);
  const mine = Boolean(m), team = can(ctx, "tasks.view_team"), creator = t.created_by === ctx.userId;
  const ok = need === "view" ? mine || team || creator : need === "edit" ? can(ctx, "tasks.edit") && (creator || team) : can(ctx, "tasks.approve") && (creator || team);
  if (!ok) throw new ForbiddenError("Você não tem acesso a esta tarefa.");
  return { ...t, mine };
}

async function people(q: Q, taskId: string) {
  return (await q<{ user_id: string }>("select user_id from task_assignees where task_id=$1", [taskId])).map((r) => r.user_id);
}

export async function startTask(db: Db, ctx: Ctx, id: string) {
  await db.tx(async (q) => {
    const t = await access(q, ctx, id, "view", true);
    if (!t.mine) throw new ForbiddenError("Só os responsáveis podem iniciar a tarefa.");
    if (t.status !== "pendente" && t.status !== "em_andamento") throw new DomainError("bad_status", "Esta tarefa não pode ser iniciada.");
    await q("update tasks set status='em_andamento', updated_at=now() where id=$1", [id]);
    await q("update task_assignees set status='em_andamento' where task_id=$1 and user_id=$2 and status='pendente'", [id, ctx.userId]);
    await audit(q, ctx, "TAREFA_INICIADA", "task", id);
  });
}

/** Conclusão. Individual: cada responsável conclui a sua parte. Coletiva: a conclusão de um vale para o grupo. */
export async function completeTask(db: Db, ctx: Ctx, id: string): Promise<{ status: string }> {
  return db.tx(async (q) => {
    const t = await access(q, ctx, id, "view", true);
    if (!t.mine) throw new ForbiddenError("Só os responsáveis podem concluir a tarefa.");
    if (t.status === "concluida" || t.status === "cancelada" || t.status === "aguardando_aprovacao") throw new DomainError("bad_status", "Esta tarefa já foi encerrada ou enviada para aprovação.");
    const [sub] = await q<{ n: number }>(`select count(*)::bigint as n from tasks where parent_id=$1 and status in ${OPEN}`, [id]);
    if (sub.n > 0) throw new DomainError("subtasks_open", "Conclua as subtarefas antes.");
    if (t.mode === "coletiva") await q("update task_assignees set status='concluida', completed_at=now() where task_id=$1 and user_id=$2", [id, ctx.userId]);
    else await q("update task_assignees set status='concluida', completed_at=coalesce(completed_at, now()) where task_id=$1 and user_id=$2", [id, ctx.userId]);
    const [left] = await q<{ n: number }>("select count(*)::bigint as n from task_assignees where task_id=$1 and status<>'concluida'", [id]);
    const finished = t.mode === "coletiva" || left.n === 0;
    const status = !finished ? "em_andamento" : t.requires_approval ? "aguardando_aprovacao" : "concluida";
    await q("update tasks set status=$2, updated_at=now(), completed_at=case when $2='concluida' then now() end, completed_by=case when $2='concluida' then $3::uuid end where id=$1", [id, status, ctx.userId]);
    await audit(q, ctx, "TAREFA_CONCLUSAO", "task", id, { status: t.status }, { status });
    if (status === "concluida") await emit(q, ctx, "task.completed", "task", id, {}, `task.completed:${id}:${Date.now()}`);
    if (finished) await notifyUsers(q, { unitId: ctx.unitId, userIds: [t.created_by].filter((u) => u !== ctx.userId), kind: "tarefa_conclusao", message: status === "concluida" ? `Tarefa concluída: ${t.title}.` : `Tarefa aguardando sua aprovação: ${t.title}.`, url: `/tarefas/${id}`, ref: ["task", id], dedupe: `task.done:${id}:${Date.now()}` });
    return { status };
  });
}

export async function reviewTask(db: Db, ctx: Ctx, id: string, approve: boolean, note?: string) {
  await db.tx(async (q) => {
    const t = await access(q, ctx, id, "approve", true);
    if (t.status !== "aguardando_aprovacao") throw new DomainError("bad_status", "Esta tarefa não está aguardando aprovação.");
    const why = approve ? null : requireText(note, "Motivo da devolução", 3);
    if (approve) {
      await q("update tasks set status='concluida', completed_at=now(), completed_by=$2, updated_at=now() where id=$1", [id, ctx.userId]);
      await emit(q, ctx, "task.completed", "task", id, { approved: true }, `task.completed:${id}:${Date.now()}`);
    } else {
      await q("update tasks set status='em_andamento', updated_at=now() where id=$1", [id]);
      await q("update task_assignees set status='em_andamento', completed_at=null where task_id=$1", [id]);
      await q("insert into task_comments(task_id,user_id,body) values ($1,$2,$3)", [id, ctx.userId, `Devolvida para revisão: ${why}`]);
    }
    await audit(q, ctx, approve ? "TAREFA_APROVADA" : "TAREFA_DEVOLVIDA", "task", id, null, null, why ?? undefined);
    await notifyUsers(q, { unitId: ctx.unitId, userIds: (await people(q, id)).filter((u) => u !== ctx.userId), kind: approve ? "tarefa_aprovada" : "tarefa_devolvida", severity: approve ? "info" : "atencao", message: approve ? `Tarefa aprovada: ${t.title}.` : `Tarefa devolvida para revisão: ${t.title}.`, url: `/tarefas/${id}`, ref: ["task", id], dedupe: `task.review:${id}:${Date.now()}` });
  });
}

export async function updateTask(db: Db, ctx: Ctx, id: string, p: { title: string; description?: string | null; category?: string | null; priority: Priority; dueDate?: string | null; dueTime?: string | null; assignees: string[]; mainAssignee?: string | null }) {
  await db.tx(async (q) => {
    const t = await access(q, ctx, id, "edit", true);
    if (t.status === "concluida" || t.status === "cancelada") throw new DomainError("bad_status", "Tarefas encerradas não podem ser editadas.");
    if (!PRIORITIES.includes(p.priority)) throw new DomainError("invalid", "Prioridade inválida.");
    const ids = [...new Set(p.assignees)];
    const before = await people(q, id);
    // manter quem já estava não exige permissão de delegar
    const added = ids.filter((u) => !before.includes(u));
    if (!ids.length) throw new DomainError("invalid", "Escolha pelo menos um responsável.");
    if (added.length) await assertAssignees(q, ctx, added);
    const due = dueFrom(p.dueDate, p.dueTime);
    const title = requireText(p.title, "Título", 3).slice(0, 160);
    await q("update tasks set title=$2, description=$3, category=$4, priority=$5, due_at=$6, due_has_time=$7, main_assignee_id=$8, updated_at=now() where id=$1", [id, title, p.description ?? null, p.category ?? null, p.priority, due.at, due.hasTime, p.mainAssignee && ids.includes(p.mainAssignee) ? p.mainAssignee : ids[0]]);
    await q("delete from task_assignees where task_id=$1 and not (user_id = any($2::uuid[]))", [id, ids]);
    for (const u of added) await q("insert into task_assignees(task_id,user_id) values ($1,$2)", [id, u]);
    await audit(q, ctx, "TAREFA_ALTERADA", "task", id, { title: t.title, due: t.due_at, assignees: before }, { ...p, assignees: ids });
    await emit(q, ctx, "task.updated", "task", id, {});
    const stamp = Date.now();
    await notifyUsers(q, { unitId: ctx.unitId, userIds: added.filter((u) => u !== ctx.userId), kind: "tarefa_atribuida", message: `Nova tarefa: ${title}${dueText(due.at, due.hasTime)}.`, url: `/tarefas/${id}`, ref: ["task", id], dedupe: `task.assigned:${id}:${stamp}` });
    const relevant = t.title !== title || (t.due_at?.getTime() ?? 0) !== (due.at?.getTime() ?? 0);
    if (relevant) await notifyUsers(q, { unitId: ctx.unitId, userIds: ids.filter((u) => u !== ctx.userId && !added.includes(u)), kind: "tarefa_alterada", message: `Tarefa alterada: ${title}${dueText(due.at, due.hasTime)}.`, url: `/tarefas/${id}`, ref: ["task", id], dedupe: `task.updated:${id}:${stamp}` });
  });
}

export async function cancelTask(db: Db, ctx: Ctx, id: string, reason: string, stopRecurrence = false) {
  const why = requireText(reason, "Motivo", 3);
  await db.tx(async (q) => {
    const t = await access(q, ctx, id, "edit", true);
    if (t.status === "concluida" || t.status === "cancelada") throw new DomainError("bad_status", "Esta tarefa já foi encerrada.");
    await q(`update tasks set status='cancelada', cancel_reason=$2, updated_at=now() where (id=$1 or parent_id=$1) and status in ${OPEN}`, [id, why]);
    if (stopRecurrence && t.recurrence_rule_id) await q("update task_recurrence_rules set is_active=false where id=$1", [t.recurrence_rule_id]);
    await audit(q, ctx, "TAREFA_CANCELADA", "task", id, { status: t.status }, { stopRecurrence }, why);
    await notifyUsers(q, { unitId: ctx.unitId, userIds: (await people(q, id)).filter((u) => u !== ctx.userId), kind: "tarefa_cancelada", message: `Tarefa cancelada: ${t.title}.`, url: `/tarefas/${id}`, ref: ["task", id], dedupe: `task.cancel:${id}` });
  });
}

export async function commentTask(db: Db, ctx: Ctx, id: string, body: string, mentions: string[] = []) {
  const text = requireText(body, "Comentário").slice(0, 2000);
  await db.tx(async (q) => {
    const t = await access(q, ctx, id, "view");
    const allowed = new Set([...(await people(q, id)), t.created_by]);
    const ids = mentions.filter((m) => allowed.has(m) && m !== ctx.userId);
    await q("insert into task_comments(task_id,user_id,body,mentions) values ($1,$2,$3,$4)", [id, ctx.userId, text, ids]);
    await audit(q, ctx, "TAREFA_COMENTARIO", "task", id);
    await notifyUsers(q, { unitId: ctx.unitId, userIds: ids, kind: "tarefa_mencao", message: `Você foi mencionado na tarefa: ${t.title}.`, url: `/tarefas/${id}`, ref: ["task", id], dedupe: `task.mention:${id}:${Date.now()}` });
  });
}

export async function attachToTask(db: Db, ctx: Ctx, id: string, f: FileInput) {
  await db.tx(async (q) => {
    await access(q, ctx, id, "view");
    const [n] = await q<{ n: number }>("select count(*)::bigint as n from task_attachments where task_id=$1", [id]);
    if (n.n >= 10) throw new DomainError("limit", "Limite de 10 anexos por tarefa.");
    await addFileTx(q, ctx, id, f);
    await audit(q, ctx, "TAREFA_ANEXO", "task", id, null, { name: f.name });
  });
}
export async function getAttachment(db: Db, ctx: Ctx, attachmentId: string) {
  const [f] = await db.query<{ task_id: string; name: string; mime: string; content_b64: string }>("select a.task_id, a.name, a.mime, a.content_b64 from task_attachments a join tasks t on t.id=a.task_id where a.id=$1 and t.unit_id=$2", [requireUuid(attachmentId, "Anexo"), ctx.unitId]);
  if (!f) throw new DomainError("not_found", "Anexo não encontrado.");
  await access(db.query, ctx, f.task_id, "view");
  return { name: f.name, mime: f.mime, bytes: Buffer.from(f.content_b64, "base64") };
}

export interface TaskRow {
  id: string; title: string; category: string | null; priority: Priority; status: string; mode: string; due_at: Date | null; due_has_time: boolean; overdue: boolean; recurring: boolean;
  creator: string; people: string; done: number; n: number; my_status: string | null; parent_id: string | null;
}
const LIST = `select t.id, t.title, t.category, t.priority, t.status, t.mode, t.due_at, t.due_has_time, (t.status in ${OPEN} and t.due_at < now()) as overdue, t.recurrence_rule_id is not null as recurring,
    cu.full_name as creator, t.parent_id,
    (select string_agg(u.full_name, ', ' order by (u.id=t.main_assignee_id) desc, u.full_name) from task_assignees a join users u on u.id=a.user_id where a.task_id=t.id) as people,
    (select count(*) from task_assignees a where a.task_id=t.id and a.status='concluida')::bigint as done, (select count(*) from task_assignees a where a.task_id=t.id)::bigint as n,
    (select a.status from task_assignees a where a.task_id=t.id and a.user_id=$2) as my_status
  from tasks t join users cu on cu.id=t.created_by`;

export async function listTasks(db: Db, ctx: Ctx, o: { scope?: "minhas" | "criadas" | "equipe"; state?: "abertas" | "atrasadas" | "aprovar" | "encerradas"; userId?: string | null; limit?: number; offset?: number } = {}) {
  const scope = o.scope === "equipe" && can(ctx, "tasks.view_team") ? "equipe" : o.scope === "criadas" ? "criadas" : "minhas";
  const rows = await db.query<TaskRow & { total: number }>(
    `select *, count(*) over()::bigint as total from (${LIST}
       where t.unit_id=$1 and case $3 when 'equipe' then true when 'criadas' then t.created_by=$2 else exists (select 1 from task_assignees a where a.task_id=t.id and a.user_id=$2) end
         and ($7::uuid is null or exists (select 1 from task_assignees a where a.task_id=t.id and a.user_id=$7))
         and case $4 when 'atrasadas' then t.status in ${OPEN} and t.due_at < now() when 'aprovar' then t.status='aguardando_aprovacao' when 'encerradas' then t.status in ('concluida','cancelada') else t.status in ${OPEN} end) x
     order by case when status in ('concluida','cancelada') then 1 else 0 end, overdue desc, array_position(array['urgente','alta','normal','baixa'], priority), due_at nulls last limit $5 offset $6`,
    [ctx.unitId, ctx.userId, scope, o.state ?? "abertas", o.limit ?? 50, o.offset ?? 0, o.userId ?? null],
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

export async function taskCounts(db: Db, ctx: Ctx) {
  const [r] = await db.query<{ open: number; overdue: number }>(
    `select count(*)::bigint as open, count(*) filter (where t.due_at < now())::bigint as overdue from tasks t join task_assignees a on a.task_id=t.id and a.user_id=$2 and a.status<>'concluida' where t.unit_id=$1 and t.status in ${OPEN}`, [ctx.unitId, ctx.userId]);
  return r;
}

export async function getTask(db: Db, ctx: Ctx, id: string) {
  const core = await access(db.query, ctx, id, "view");
  const [task] = await db.query<TaskRow & { description: string | null; requires_approval: boolean; created_by: string; created_at: Date; completed_at: Date | null; cancel_reason: string | null; main_assignee_id: string | null; rule: Rule | null }>(
    `select x.*, t.description, t.requires_approval, t.created_by, t.created_at, t.completed_at, t.cancel_reason, t.main_assignee_id, rr.rule from (${LIST} where t.unit_id=$1 and t.id=$3) x join tasks t on t.id=x.id left join task_recurrence_rules rr on rr.id=t.recurrence_rule_id`, [ctx.unitId, ctx.userId, id]);
  const assignees = await db.query<{ user_id: string; full_name: string; status: string; completed_at: Date | null }>("select a.user_id, u.full_name, a.status, a.completed_at from task_assignees a join users u on u.id=a.user_id where a.task_id=$1 order by u.full_name", [id]);
  const comments = await db.query<{ id: string; full_name: string; body: string; created_at: Date }>("select c.id, u.full_name, c.body, c.created_at from task_comments c join users u on u.id=c.user_id where c.task_id=$1 order by c.created_at", [id]);
  const files = await db.query<{ id: string; name: string; size_bytes: number }>("select id, name, size_bytes from task_attachments where task_id=$1 order by created_at", [id]);
  const subs = await db.query<{ id: string; title: string; status: string; people: string }>("select t.id, t.title, t.status, (select string_agg(u.full_name, ', ') from task_assignees a join users u on u.id=a.user_id where a.task_id=t.id) as people from tasks t where t.parent_id=$1 order by t.created_at", [id]);
  const history = await db.query<{ action: string; created_at: Date; user_name: string | null; note: string | null }>("select l.action, l.created_at, u.full_name as user_name, l.note from audit_logs l left join users u on u.id=l.user_id where l.entity='task' and l.entity_id=$1 order by l.id desc limit 30", [id]);
  const team = can(ctx, "tasks.view_team"), creator = core.created_by === ctx.userId;
  return { task, assignees, comments, files, subs, history, mine: core.mine, canEdit: can(ctx, "tasks.edit") && (creator || team), canApprove: can(ctx, "tasks.approve") && (creator || team) };
}

export async function listPeople(db: Db, ctx: Ctx) {
  return db.query<{ id: string; full_name: string }>("select u.id, u.full_name from users u join user_units uu on uu.user_id=u.id where uu.unit_id=$1 and u.is_active order by u.full_name", [ctx.unitId]);
}

/** Gera as próximas execuções recorrentes (hoje e amanhã) e avisa sobre prazo próximo e atraso. Idempotente. */
export async function runTaskJobs(db: Db, unitId: string, now = new Date()) {
  const today = todayYmd(now);
  let generated = 0;
  const rules = await db.query<{ id: string; template: TaskInput; rule: Rule; start_date: string; end_date: string | null; created_by: string }>(
    `select id, template, rule, to_char(start_date,'YYYY-MM-DD') as start_date, to_char(end_date,'YYYY-MM-DD') as end_date, created_by from task_recurrence_rules where unit_id=$1 and is_active and start_date <= $2::date + 1`, [unitId, today]);
  for (const r of rules) {
    const horizon = addDays(today, 1);
    const until = r.end_date && r.end_date < horizon ? r.end_date : horizon;
    // no máximo 3 dias para trás: evita uma enxurrada se a rotina ficou parada
    const dates = occurrences(r.rule, r.start_date, until, 4000).filter((d) => d >= addDays(today, -3));
    for (const d of dates) {
      await db.tx(async (q) => {
        const alive = (await q<{ id: string }>("select u.id from users u join user_units uu on uu.user_id=u.id where uu.unit_id=$1 and u.is_active and u.id = any($2::uuid[])", [unitId, r.template.assignees])).map((u) => u.id);
        if (!alive.length) return;
        const id = await insertTask(q, { unitId, userId: r.created_by } as Ctx, { ...r.template, assignees: alive, parentId: null }, { ruleId: r.id, date: d });
        if (id) generated++;
      });
    }
  }
  const soon = await db.query<{ id: string; title: string; due_at: Date; due_has_time: boolean; users: string[]; late: boolean }>(
    `select t.id, t.title, t.due_at, t.due_has_time, t.due_at < $2 as late, (select array_agg(a.user_id) from task_assignees a where a.task_id=t.id and a.status<>'concluida') as users
     from tasks t where t.unit_id=$1 and t.status in ('pendente','em_andamento') and t.due_at is not null and t.due_at < $2::timestamptz + case when t.due_has_time then interval '2 hours' else interval '16 hours' end and t.due_at > $2::timestamptz - interval '7 days'`, [unitId, now]);
  let alerts = 0;
  for (const t of soon) {
    if (!t.users?.length) continue;
    const key = t.due_at.getTime();
    await db.tx(async (q) => {
      if (t.late) await emit(q, { unitId }, "task.overdue", "task", t.id, {}, `task.overdue:${t.id}:${key}`);
      alerts += await notifyUsers(q, { unitId, userIds: t.users, kind: t.late ? "prazo_atrasada" : "prazo_proximo", severity: t.late ? "atencao" : "info", message: t.late ? `Tarefa atrasada: ${t.title}.` : `Tarefa perto do prazo: ${t.title}${dueText(t.due_at, t.due_has_time)}.`, url: `/tarefas/${t.id}`, ref: ["task", t.id], dedupe: `task.${t.late ? "late" : "soon"}:${t.id}:${key}` });
    });
  }
  return { generated, alerts };
}
