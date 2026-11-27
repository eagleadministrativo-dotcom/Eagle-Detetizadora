import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { getSettings } from "@/server/core";
import { listCatalog } from "@/server/services/catalog";
import { Flash, PageHead } from "@/components/ui";
import { saveBusinessHoursAction, saveChairAction } from "@/app/actions/admin";

export const metadata = { title: "Locais e horários" };
const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export default async function ChairsAdmin({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("admin.schedules");
  const db = await getDb();
  const cat = await listCatalog(db, ctx.unitId);
  const st = await getSettings(db.query, ctx.unitId);
  return (
    <>
      <PageHead title="Locais e horários" sub="Locais internos de atendimento e quando a empresa funciona. A ocupação é calculada sobre esses horários." />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid cols-2">
        <section className="card stack">
          <h2>Locais</h2>
          {cat.chairs.map((c) => (
            <form key={c.id} action={saveChairAction} className="editrow">
              <input type="hidden" name="id" value={c.id} /><input name="name" defaultValue={c.name} aria-label="Nome do local" />
              <label className="check"><input type="checkbox" name="isActive" defaultChecked={c.is_active} />ativa</label><button className="btn small ghost" type="submit">Salvar</button>
            </form>
          ))}
          <form action={saveChairAction} className="editrow"><input name="name" placeholder="Novo local" required /><button className="btn small" type="submit">Adicionar</button></form>
          <small>Um local só pode ser desativado sem agendamentos futuros.</small>
        </section>
        <section className="card stack">
          <h2>Horário de funcionamento</h2>
          <form action={saveBusinessHoursAction} className="form">
            <div className="stack">
              {DAYS.map((d, i) => {
                const w = st.business_hours[String(i)]?.[0];
                return <div className="dayrow" key={i}><span>{d}</span><input type="time" name={`s_${i}`} defaultValue={w?.[0] ?? ""} aria-label={`${d} abre`} /><span>às</span><input type="time" name={`e_${i}`} defaultValue={w?.[1] ?? ""} aria-label={`${d} fecha`} /></div>;
              })}
            </div>
            <small>Deixe em branco os dias fechados.</small>
            <div><button className="btn accent" type="submit">Salvar horários</button></div>
          </form>
        </section>
      </div>
    </>
  );
}
