import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { can } from "@/server/core";
import { BUCKETS, listReturns, returnCounts, type Bucket } from "@/server/services/returns";
import { listCatalog } from "@/server/services/catalog";
import { normalizePhone } from "@/server/services/whatsapp";
import { addDays, fmtDateTime, fmtYmd, todayYmd } from "@/lib/dates";
import { Badge, Empty, Field, Flash, PageHead, Pager, Seg, newKey } from "@/components/ui";
import { WhatsAppMessage } from "@/components/client";
import { contactAction, snoozeAction } from "@/app/actions/returns";

export const metadata = { title: "Retornos" };
type SP = { b?: string; q?: string; s?: string; p?: string; ok?: string; erro?: string };
const OUT: Record<string, string> = { contatado: "contatado", sem_resposta: "sem resposta", recusou: "recusou", agendou: "agendou" };

export default async function Returns({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx, user } = await requirePerm("returns.own", "returns.view_all");
  const db = await getDb();
  const all = can(ctx, "returns.view_all");
  const staff = all && /^[0-9a-f-]{36}$/.test(sp.s ?? "") ? sp.s! : null;
  const bucket: Bucket = sp.b && sp.b in BUCKETS ? (sp.b as Bucket) : "vencido";
  const page = Math.max(1, Number(sp.p) || 1);
  const counts = await returnCounts(db, ctx, staff);
  const { rows, total } = await listReturns(db, ctx, { bucket, search: sp.q, staffId: staff, limit: 25, offset: (page - 1) * 25 });
  const cat = all ? await listCatalog(db, ctx.unitId) : null;
  const href = (o: Partial<SP>) => `/retornos?${new URLSearchParams({ b: bucket, ...(sp.q ? { q: sp.q } : {}), ...(staff ? { s: staff } : {}), ...(o as Record<string, string>) }).toString()}`;
  const canContact = can(ctx, "returns.contact");
  const today = todayYmd();
  return (
    <>
      <PageHead title="Retornos" sub="Clientes para convidar de novo. O prazo conta do último atendimento concluído." />
      <Flash ok={sp.ok} erro={sp.erro} />
      <Seg items={(Object.keys(BUCKETS) as Bucket[]).map((b) => ({ href: href({ b }), label: BUCKETS[b], active: b === bucket, n: counts[b] ?? 0 }))} />
      <form className="filters" method="get">
        <input type="hidden" name="b" value={bucket} />
        <label>Pesquisar<input name="q" defaultValue={sp.q ?? ""} placeholder="Nome ou telefone" /></label>
        {cat ? <label>Profissional<select name="s" defaultValue={staff ?? ""}><option value="">Todos</option>{cat.staff.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label> : null}
        <button className="btn ghost" type="submit">Filtrar</button>
      </form>
      {rows.length === 0 ? <Empty title="Ninguém aqui">{bucket === "vencido" ? "Nenhum cliente está na hora de voltar." : null}</Empty> : (
        <div className="list">
          {rows.map((r) => {
            const phone = r.contact_channel === "whatsapp" ? normalizePhone(r.phone) : null;
            const active = r.can_contact && canContact && (bucket === "vencido" || bucket === "proximo" || bucket === "contatado");
            const text = `Olá, ${r.name.split(" ")[0]}, tudo bem? Aqui é ${user.fullName.split(" ")[0]}, do MARFIM Studio. Passando para saber se gostaria de reservar seu próximo horário. Posso te enviar as disponibilidades?`;
            return (
              <div className="card" key={r.customer_id} style={{ padding: "16px 18px" }} data-spot="">
                <div className="item2" style={{ padding: 0, border: 0, boxShadow: "none", background: "none" }}>
                  <span className="avatar" aria-hidden="true">{r.name.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <b>{can(ctx, "customers.view") ? <Link href={`/clientes/${r.customer_id}`} style={{ textDecoration: "none" }}>{r.name}</Link> : r.name}</b>
                    <div className="meta">
                      <span>Última visita {fmtYmd(r.last_visit)} ({r.days} dias)</span>
                      <span>{r.rule_label}</span>
                      {r.due_date ? <span className={r.due_date <= today && bucket === "vencido" ? "late" : ""}>Retorno {fmtYmd(r.due_date)}</span> : null}
                      <span>{r.staff_name}</span>
                      {r.next_appointment ? <span>Agendado {fmtDateTime(r.next_appointment)}</span> : null}
                      {r.last_contact_at ? <span>Último contato {fmtDateTime(r.last_contact_at)} · {OUT[r.last_contact_outcome ?? ""]}</span> : null}
                      {r.snoozed_until ? <span>Adiado até {fmtYmd(r.snoozed_until)}</span> : null}
                    </div>
                  </div>
                  <div className="row act">
                    {!r.can_contact ? <Badge tone="bad">Não autorizou contato</Badge> : r.phone ? <small>{r.phone}</small> : <Badge tone="warn">Sem telefone</Badge>}
                  </div>
                </div>
                {active ? (
                  <div className="row" style={{ marginTop: 12 }}>
                    {phone && bucket !== "contatado" ? <details className="confirm neutral"><summary>Enviar mensagem</summary><div style={{ padding: "6px 14px 4px" }}><WhatsAppMessage phone={phone} text={text} /><small>Abrir a conversa não registra o contato. Depois de enviar, use &quot;Registrar contato&quot;.</small></div></details> : null}
                    <details className="confirm neutral"><summary>Registrar contato</summary>
                      <form action={contactAction} className="form">
                        <input type="hidden" name="customerId" value={r.customer_id} /><input type="hidden" name="key" value={newKey()} /><input type="hidden" name="back" value={href({})} />
                        <Field label="Resultado"><select name="outcome" defaultValue="contatado"><option value="contatado">Mensagem enviada</option><option value="sem_resposta">Sem resposta</option><option value="agendou">Vai agendar</option><option value="recusou">Não quer voltar agora</option></select></Field>
                        <Field label="Anotação (opcional)"><input name="note" maxLength={300} /></Field>
                        <label className="check"><input type="checkbox" name="optOut" />Pediu para não receber mensagens</label>
                        <div><button className="btn small accent" type="submit">Registrar</button></div>
                      </form>
                    </details>
                    <details className="confirm neutral"><summary>Adiar</summary>
                      <form action={snoozeAction} className="form"><input type="hidden" name="customerId" value={r.customer_id} /><input type="hidden" name="back" value={href({})} /><Field label="Lembrar em"><input type="date" name="until" defaultValue={addDays(today, 7)} min={addDays(today, 1)} required /></Field><div><button className="btn small" type="submit">Adiar</button></div></form>
                    </details>
                    {can(ctx, "agenda.create") ? <Link className="btn small ghost" href={`/agenda/novo?cust=${r.customer_id}${r.staff_id ? `&s=${r.staff_id}` : ""}`}>Agendar</Link> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      {total > 25 ? <Pager base={href({})} page={page} total={total} size={25} /> : null}
    </>
  );
}
