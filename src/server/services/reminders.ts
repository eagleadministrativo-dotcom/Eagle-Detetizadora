import type { Db } from "../db";
import { normalizePhone, sendReminderTemplate, whatsappConfigured, type WhatsAppSender } from "./whatsapp";

/**
 * Lembrete ao cliente quando faltam 30 minutos (ou menos) para o agendamento.
 * Cada agendamento é reivindicado uma única vez (UPDATE ... RETURNING) para não repetir a mensagem.
 * Com WhatsApp configurado, envia ao cliente. Sem isso (ou sem telefone), avisa a equipe por alerta/push.
 */
export async function runReminders(db: Db, send?: WhatsAppSender, now = new Date()) {
  const claimed = await db.query<{ id: string; unit_id: string; starts_at: Date; cname: string; phone: string | null; sname: string; user_id: string | null }>(
    `with c as (
       update appointments a set reminder_sent_at = now()
       where a.status = 'agendado' and a.reminder_sent_at is null
         and a.starts_at > $1::timestamptz and a.starts_at <= $1::timestamptz + interval '30 minutes'
       returning a.id, a.unit_id, a.starts_at, a.customer_id, a.staff_id)
     select c.id, c.unit_id, c.starts_at, cu.name as cname, cu.phone, s.name as sname, s.user_id
     from c join customers cu on cu.id = c.customer_id join staff s on s.id = c.staff_id`,
    [now],
  );
  const sender = send ?? (whatsappConfigured() ? sendReminderTemplate : null);
  let sent = 0, manual = 0;
  for (const r of claimed) {
    const time = r.starts_at.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    const to = normalizePhone(r.phone);
    let channel = "manual";
    if (sender && to) {
      try { await sender(to, { customer: r.cname.split(" ")[0], time, staff: r.sname.split(" ")[0] }); channel = "whatsapp"; }
      catch (e) { console.error("[lembrete]", (e as Error).message); channel = "falha"; }
    } else if (!to) channel = "sem_telefone";
    await db.query("update appointments set reminder_channel=$2 where id=$1", [r.id, channel]);
    if (channel === "whatsapp") { sent++; continue; }
    manual++;
    const why = channel === "sem_telefone" ? "cliente sem telefone válido" : channel === "falha" ? "falha no envio automático" : "envio automático por WhatsApp não configurado";
    await db.query(
      "insert into notifications(unit_id,kind,severity,message,ref_entity,ref_id,dedupe_key) values ($1,'lembrete_cliente','atencao',$2,'appointment',$3,$4) on conflict (dedupe_key) do nothing",
      [r.unit_id, `Em 30 min: ${r.cname} às ${time} com ${r.sname}. Lembrete não enviado ao cliente (${why}).`, r.id, `remind:${r.id}`],
    );
  }
  return { due: claimed.length, sent, manual };
}
