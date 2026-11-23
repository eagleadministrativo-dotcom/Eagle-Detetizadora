"use server";
import { after } from "next/server";
import { getDb, type Db } from "@/server/db";
import { bool, optStr, requireSession, run, str } from "@/server/session";
import { flushPush } from "@/server/services/push";
import { attachToTask, cancelTask, commentTask, completeTask, createTask, reviewTask, startTask, updateTask, type FileInput, type Priority } from "@/server/services/tasks";
import { DomainError } from "@/server/errors";
import { ruleFromForm } from "@/lib/recurrence";

const push = (db: Db) => after(() => flushPush(db).catch((e) => console.error("[push]", e)));
async function files(fd: FormData, k: string): Promise<FileInput[]> {
  const out: FileInput[] = [];
  for (const f of fd.getAll(k)) {
    if (!(f instanceof File) || f.size === 0) continue;
    if (f.size > 2 * 1024 * 1024) throw new DomainError("invalid", "Cada anexo pode ter até 2 MB.");
    out.push({ name: f.name, mime: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
  }
  return out.slice(0, 5);
}

export async function createTaskAction(fd: FormData) {
  const { ctx } = await requireSession();
  const parentId = optStr(fd, "parentId");
  await run(parentId ? `/tarefas/${parentId}` : "/tarefas/nova", async () => {
    const db = await getDb();
    const assignees = fd.getAll("assignees").map(String);
    const id = await createTask(db, ctx, {
      title: str(fd, "title"), description: optStr(fd, "description"), category: optStr(fd, "category"), priority: (str(fd, "priority") || "normal") as Priority, mode: str(fd, "mode") === "coletiva" ? "coletiva" : "individual",
      requiresApproval: bool(fd, "requiresApproval"), assignees: assignees.length ? assignees : [ctx.userId], mainAssignee: optStr(fd, "main"), dueDate: optStr(fd, "dueDate"), dueTime: optStr(fd, "dueTime"), parentId,
      recurrence: ruleFromForm((k) => str(fd, k)), recurrenceEnd: optStr(fd, "recEnd"), files: await files(fd, "files"),
    });
    push(db);
    return { to: `/tarefas/${parentId ?? id}`, ok: parentId ? "Subtarefa criada." : "Tarefa criada." };
  });
}
export async function updateTaskAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/tarefas/${id}`, async () => {
    const db = await getDb();
    await updateTask(db, ctx, id, { title: str(fd, "title"), description: optStr(fd, "description"), category: optStr(fd, "category"), priority: str(fd, "priority") as Priority, dueDate: optStr(fd, "dueDate"), dueTime: optStr(fd, "dueTime"), assignees: fd.getAll("assignees").map(String), mainAssignee: optStr(fd, "main") });
    push(db);
    return "Tarefa atualizada.";
  });
}
export async function taskStepAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(str(fd, "back") || `/tarefas/${id}`, async () => {
    const db = await getDb();
    const step = str(fd, "step");
    if (step === "iniciar") { await startTask(db, ctx, id); return "Tarefa iniciada."; }
    if (step === "concluir") { const r = await completeTask(db, ctx, id); push(db); return r.status === "concluida" ? "Tarefa concluída." : r.status === "aguardando_aprovacao" ? "Enviada para aprovação." : "Sua parte foi concluída. Faltam outros responsáveis."; }
    if (step === "aprovar") { await reviewTask(db, ctx, id, true); push(db); return "Tarefa aprovada."; }
    if (step === "devolver") { await reviewTask(db, ctx, id, false, str(fd, "note")); push(db); return "Tarefa devolvida para revisão."; }
    if (step === "cancelar") { await cancelTask(db, ctx, id, str(fd, "reason"), bool(fd, "stop")); push(db); return "Tarefa cancelada."; }
    throw new DomainError("invalid", "Ação inválida.");
  });
}
export async function commentTaskAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/tarefas/${id}`, async () => {
    const db = await getDb();
    const list = await files(fd, "files");
    if (str(fd, "body") || !list.length) await commentTask(db, ctx, id, str(fd, "body"), fd.getAll("mentions").map(String));
    for (const f of list) await attachToTask(db, ctx, id, f);
    push(db);
    return list.length ? "Enviado." : "Comentário publicado.";
  });
}
