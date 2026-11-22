import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { listNotifications, markNotificationsRead } from "@/server/services/ops";
import { fmtDateTime } from "@/lib/dates";
import { Empty, PageHead } from "@/components/ui";
import { revalidatePath } from "next/cache";

export const metadata = { title: "Alertas" };

async function markAll() {
  "use server";
  const s = await requirePerm("finance.view", "dashboard.full");
  await markNotificationsRead(await getDb(), s.ctx);
  revalidatePath("/notificacoes");
}

export default async function Notifications() {
  const s = await requirePerm("finance.view", "dashboard.full");
  const rows = await listNotifications(await getDb(), s.ctx, 100);
  return (
    <>
      <PageHead title="Alertas" sub="Avisos gerados pelas rotinas automáticas e pelo caixa.">
        {rows.some((r) => !r.is_read) ? <form action={markAll}><button className="btn ghost" type="submit">Marcar todos como lidos</button></form> : null}
      </PageHead>
      {rows.length === 0 ? <Empty title="Nenhum alerta" /> : (
        <div className="stack">
          {rows.map((n) => (
            <div key={n.id} className={`alert ${n.severity}`} style={{ opacity: n.is_read ? 0.65 : 1 }}>
              {n.message} <small className="muted">· {fmtDateTime(n.created_at)}</small>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
