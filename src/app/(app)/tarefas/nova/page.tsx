import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { listPeople } from "@/server/services/tasks";
import { todayYmd } from "@/lib/dates";
import { Field, Flash, PageHead } from "@/components/ui";
import { FrequencyFields } from "@/components/client";
import { PeoplePick } from "@/components/task-ui";
import { createTaskAction } from "@/app/actions/tasks";

export const metadata = { title: "Nova tarefa" };

export default async function NewTask({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("tasks.create");
  const all = await listPeople(await getDb(), ctx);
  const people = can(ctx, "tasks.delegate") ? all : all.filter((p) => p.id === ctx.userId);
  return (
    <>
      <PageHead title="Nova tarefa"><Link className="btn ghost" href="/tarefas">Voltar</Link></PageHead>
      <Flash erro={sp.erro} />
      <form action={createTaskAction} className="card form">
        <Field label="Título"><input name="title" required minLength={3} maxLength={160} placeholder="Ex.: Higienizar equipamentos" /></Field>
        <Field label="Instruções"><textarea name="description" maxLength={4000} /></Field>
        <PeoplePick people={people} selected={people.length === 1 ? [people[0].id] : []} />
        <div className="fields">
          <Field label="Prioridade"><select name="priority" defaultValue="normal"><option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></Field>
          <Field label="Categoria (opcional)"><input name="category" list="cats" maxLength={40} /></Field>
          <Field label="Prazo"><input type="date" name="dueDate" min={todayYmd()} /></Field>
          <Field label="Horário (opcional)"><input type="time" name="dueTime" /></Field>
        </div>
        <datalist id="cats"><option value="Limpeza" /><option value="Estoque" /><option value="Manutenção" /><option value="Financeiro" /><option value="Atendimento" /></datalist>
        {people.length > 1 ? (
          <fieldset>
            <legend>Quando há mais de um responsável</legend>
            <div className="chips">
              <label className="chip"><input type="radio" name="mode" value="individual" defaultChecked />Cada um conclui a sua parte</label>
              <label className="chip"><input type="radio" name="mode" value="coletiva" />Uma conclusão vale para todos</label>
            </div>
          </fieldset>
        ) : null}
        <fieldset>
          <legend>Repetição</legend>
          <FrequencyFields label="Repetir" none="Não repetir" daily />
          <label style={{ marginTop: 12 }}>Repetir até (opcional)<input type="date" name="recEnd" /></label>
          <small>Com repetição, o prazo é a primeira data. Cada execução vira uma tarefa própria, com histórico separado.</small>
        </fieldset>
        <Field label="Anexos (imagem, PDF ou texto, até 2 MB cada)"><input type="file" name="files" multiple accept="image/png,image/jpeg,image/webp,application/pdf,text/plain" /></Field>
        <label className="switch">Exigir aprovação antes de encerrar<input type="checkbox" role="switch" name="requiresApproval" /></label>
        <div className="sticky-actions"><button className="btn accent" type="submit">Criar tarefa</button></div>
      </form>
    </>
  );
}
