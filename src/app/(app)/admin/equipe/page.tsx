import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { listCatalog } from "@/server/services/catalog";
import { Badge, Field, Flash, PageHead } from "@/components/ui";
import { saveStaffAction } from "@/app/actions/admin";

export const metadata = { title: "Equipe" };
const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const CONTRACT: Record<string, string> = { clt: "CLT", pj: "PJ", autonomo: "Autônomo", proprietario: "Proprietário" };

export default async function StaffAdmin({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("admin.catalog");
  const cat = await listCatalog(await getDb(), ctx.unitId);

  const form = (p?: (typeof cat.staff)[number]) => {
    const sch = cat.schedules.filter((s) => p && s.staff_id === p.id);
    return (
      <form action={saveStaffAction} className="form">
        {p ? <input type="hidden" name="id" value={p.id} /> : null}
        <div className="fields">
          <Field label="Nome"><input name="name" defaultValue={p?.name ?? ""} required /></Field>
          <Field label="Telefone"><input name="phone" defaultValue={p?.phone ?? ""} /></Field>
          <Field label="Vínculo">
            <select name="contractType" defaultValue={p?.contract_type ?? ""}><option value="">Não informado</option>{Object.entries(CONTRACT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
          <Field label="Cor na agenda"><input type="color" name="color" defaultValue={p?.color ?? "#8b6b4a"} /></Field>
        </div>
        <fieldset>
          <legend>Escala semanal (em branco = sem restrição de horário)</legend>
          <div className="stack">
            {DAYS.map((d, i) => {
              const s = sch.find((x) => x.day_of_week === i);
              return <div className="dayrow" key={i}><span>{d}</span><input type="time" name={`s_${i}`} defaultValue={s?.start_time ?? ""} aria-label={`${d} início`} /><span>às</span><input type="time" name={`e_${i}`} defaultValue={s?.end_time ?? ""} aria-label={`${d} fim`} /></div>;
            })}
          </div>
        </fieldset>
        {p ? <label className="check"><input type="checkbox" name="isActive" defaultChecked={p.is_active} />Ativo</label> : null}
        <div><button className="btn accent" type="submit">{p ? "Salvar" : "Adicionar profissional"}</button></div>
      </form>
    );
  };
  return (
    <>
      <PageHead title="Equipe" sub="Profissionais que atendem. O acesso ao sistema é criado em Usuários e permissões." />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="stack">
        {cat.staff.map((p) => (
          <details className="card" key={p.id}>
            <summary><b>{p.name}</b> {p.contract_type ? <Badge>{CONTRACT[p.contract_type]}</Badge> : null} {!p.is_active ? <Badge>inativo</Badge> : null} {p.user_id ? <Badge tone="info">tem acesso</Badge> : null}</summary>
            <div style={{ marginTop: 12 }}>{form(p)}</div>
          </details>
        ))}
      </div>
      <details className="card" open={cat.staff.length === 0}>
        <summary><b>+ Novo profissional</b></summary>
        <div style={{ marginTop: 12 }}>{form()}</div>
      </details>
    </>
  );
}
