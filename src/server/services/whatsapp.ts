/** WhatsApp Business Cloud API (Meta). Sem as variáveis abaixo, o envio fica desligado e o sistema só avisa a equipe. */
export const whatsappConfigured = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);

/** Normaliza telefone brasileiro para o formato internacional (55 + DDD + número). Retorna null se não parecer válido. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  return null;
}

export type WhatsAppSender = (to: string, params: { customer: string; time: string; staff: string }) => Promise<void>;

/** Envia o modelo de mensagem aprovado (WHATSAPP_TEMPLATE, idioma pt_BR) com 3 variáveis: nome, horário e profissional. */
export const sendReminderTemplate: WhatsAppSender = async (to, p) => {
  const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: process.env.WHATSAPP_TEMPLATE || "lembrete_agendamento",
        language: { code: "pt_BR" },
        components: [{ type: "body", parameters: [p.customer, p.time, p.staff].map((text) => ({ type: "text", text })) }],
      },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${(await res.text()).slice(0, 200)}`);
};
