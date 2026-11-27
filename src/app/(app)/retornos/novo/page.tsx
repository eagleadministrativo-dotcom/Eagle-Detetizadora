import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { listCustomers } from "@/server/services/customers";
import { listCatalog } from "@/server/services/catalog";
import { RETURN_KIND_LABEL } from "@/server/services/eagle";
import { addDays, todayYmd } from "@/lib/dates";
import { Empty, Field, Flash, PageHead } from "@/components/ui";
import { saveReturnAction } from "@/app/actions/eagle";

export const metadata = { title: "Novo retorno" };

export default async function NewReturn({ searchParams }: { searchParams: Promise<{ cust?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requirePerm("returns.manage");
  const db = await getDb();
  const [customers, cat] = await Promise.all([listCustomers(db, ctx, { limit: 1000 }), listCatalog(db, ctx.unitId)]);
  return (
    <>
      <PageHead title="Novo retorno" sub="Combine com o cliente uma nova visita: garantia, manutenção periódica ou outro motivo.">
        <Link className="btn ghost" href="/retornos">Voltar</Link>
      </PageHead>
      <Flash erro={sp.erro} />
      {customers.rows.length === 0 ? <Empty title="Nenhum cliente cadastrado">Cadastre o cliente antes de criar o retorno. <Link href="/clientes/novo">Novo cliente</Link></Empty> : (
        <form action={saveReturnAction} className="card form">
          <div className="fields">
            <Field label="Cliente">
              <select name="customerId" defaultValue={sp.cust ?? ""} required>
                <option value="">— escolher —</option>
                {customers.rows.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
              </select>
            </Field>
            <Field label="Tipo">
              <select name="kind" defaultValue="manutencao">{Object.entries(RETURN_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </Field>
            <Field label="Data prevista"><input type="date" name="dueDate" defaultValue={addDays(todayYmd(), 30)} min={todayYmd()} required /></Field>
            <Field label="Técnico (opcional)">
              <select name="staffId" defaultValue=""><option value="">— definir depois —</option>{cat.staff.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </Field>
          </div>
          <Field label="Observações (opcional)"><textarea name="notes" placeholder="Ex.: reaplicar na área externa; cliente prefere manhã" /></Field>
          <div><button className="btn accent" type="submit">Criar retorno</button></div>
        </form>
      )}
    </>
  );
}
