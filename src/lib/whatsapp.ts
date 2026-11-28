/** Link do WhatsApp (wa.me) com a mensagem pronta. Telefone brasileiro sem o 55 ganha o código do país. */
export function waLink(phone: string | null | undefined, text: string): string | null {
  let d = (phone ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 12) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

const brl = (c: number | null | undefined) => (c == null ? "" : (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const ymd = (s: string | null | undefined) => (s ? s.split("-").reverse().join("/") : "");
const first = (name: string) => name.trim().split(/\s+/)[0];

export function quoteMessage(q: { number: number; customer_name: string; contact_name?: string | null; services_text: string | null; doc_value_cents: number; validity_text: string | null; valid_until: string | null; scheduling_text: string | null }, company: string) {
  const services = (q.services_text ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  return [
    `Olá, ${first(q.contact_name || q.customer_name)}! Aqui é da ${company}.`,
    `Segue o orçamento nº ${q.number}:`,
    ...services.map((s) => `• ${s}`),
    `Valor: ${brl(q.doc_value_cents)}`,
    q.scheduling_text ? q.scheduling_text : null,
    q.validity_text ? (/valid/i.test(q.validity_text) ? q.validity_text : `Validade: ${q.validity_text}`) : q.valid_until ? `Válido até ${ymd(q.valid_until)}.` : null,
    "Posso confirmar? Qualquer dúvida, é só responder esta mensagem.",
  ].filter(Boolean).join("\n");
}

export function orderMessage(o: { number: number; customer_name: string; contact_name?: string | null; services: string; total_cents: number; service_date: string | null; service_time: string | null; status: string; warranty_days: number | null }, company: string) {
  const done = o.status === "executada";
  return [
    `Olá, ${first(o.contact_name || o.customer_name)}! Aqui é da ${company}.`,
    done ? `O serviço da OS nº ${o.number} foi concluído${o.service_date ? ` em ${ymd(o.service_date)}` : ""}.` : `Confirmando a OS nº ${o.number}${o.service_date ? ` para ${ymd(o.service_date)}${o.service_time ? ` às ${o.service_time}` : ""}` : ""}.`,
    o.services ? `Serviços: ${o.services}` : null,
    o.total_cents ? `Valor: ${brl(o.total_cents)}` : null,
    done && o.warranty_days ? `Garantia de ${o.warranty_days} dias. Se notar qualquer problema nesse período, é só chamar.` : null,
    done ? "Obrigado pela confiança!" : "Qualquer dúvida, é só responder esta mensagem.",
  ].filter(Boolean).join("\n");
}
