import Link from "next/link";
import { getDb } from "@/server/db";
import { requireSession } from "@/server/session";
import { listNotifications } from "@/server/services/notify";
import { fmtTime, fmtYmd, todayYmd, toYmd } from "@/lib/dates";
import { Empty, PageHead, Pager, Seg } from "@/components/ui";
import { markReadAction } from "@/app/actions/account";

export const metadata = { title: "Avisos" };

export default async function Notifications({ searchParams }: { searchParams: Promise<{ f?: string; p?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requireSession();
  const page = Math.max(1, Number(sp.p) || 1);
  const { rows, total } = await listNotifications(await getDb(), ctx, { unreadOnly: sp.f === "novos", limit: 40, offset: (page - 1) * 40 });
  const days = [...new Set(rows.map((r) => toYmd(r.created_at)))];
  return (
    <>
      <PageHead title="Avisos" sub="Tudo o que o sistema enviou para você, com ou sem notificação no celular.">
        <Link className="btn ghost" href="/conta#preferencias">Preferências</Link>
        {rows.some((r) => !r.is_read) ? <form action={markReadAction}><button className="btn" type="submit">Marcar tudo como lido</button></form> : null}
      </PageHead>
      <Seg items={[{ href: "/notificacoes", label: "Todos", active: sp.f !== "novos" }, { href: "/notificacoes?f=novos", label: "Não lidos", active: sp.f === "novos" }]} />
      {rows.length === 0 ? <Empty title={sp.f === "novos" ? "Tudo lido" : "Nenhum aviso ainda"} /> : days.map((d) => (
        <section className="list" key={d}>
          <div className="daysep">{d === todayYmd() ? "Hoje" : fmtYmd(d)}</div>
          {rows.filter((r) => toYmd(r.created_at) === d).map((n) => (
            <div key={n.id} className={`notif ${n.is_read ? "" : `unread ${n.severity}`}`}>
              <i aria-label={n.is_read ? "Lido" : "Não lido"} />
              <div>{n.url ? <Link href={n.url}>{n.message}</Link> : n.message}<br /><small>{fmtTime(n.created_at)}{n.severity === "critico" ? " · Prioritário" : ""}</small></div>
              {!n.is_read ? <form action={markReadAction}><input type="hidden" name="id" value={n.id} /><button className="btn small ghost" type="submit">Lido</button></form> : <span />}
            </div>
          ))}
        </section>
      ))}
      {total > 40 ? <Pager base={`/notificacoes${sp.f ? "?f=novos" : ""}`} page={page} total={total} size={40} /> : null}
    </>
  );
}
