import { Badge } from "@/components/ui";
import { OS_PAYMENT_LABEL, OS_STATUS_LABEL, QUOTE_STATUS_LABEL, RETURN_KIND_LABEL, RETURN_STATUS_LABEL, type OSPayment, type OSStatus, type QuoteStatus, type ReturnKind, type ReturnStatus } from "@/server/services/eagle";

const RET_TONE: Record<ReturnStatus, "warn" | "info" | "ok" | ""> = { pendente: "warn", agendado: "info", concluido: "ok", cancelado: "" };
const QUOTE_TONE: Record<QuoteStatus, "warn" | "info" | "ok" | "bad" | ""> = { rascunho: "", enviado: "info", aprovado: "ok", recusado: "bad" };
const OS_TONE: Record<OSStatus, "warn" | "ok" | ""> = { aberta: "warn", executada: "ok", cancelada: "" };
const PAY_TONE: Record<OSPayment, "warn" | "ok" | "info"> = { pendente: "warn", pago: "ok", parcial: "info" };

export const ReturnStatusBadge = ({ s }: { s: ReturnStatus }) => <Badge tone={RET_TONE[s]}>{RETURN_STATUS_LABEL[s]}</Badge>;
export const ReturnKindBadge = ({ k }: { k: ReturnKind }) => <Badge tone={k === "garantia" ? "solid" : ""}>{RETURN_KIND_LABEL[k]}</Badge>;
export const QuoteStatusBadge = ({ s }: { s: QuoteStatus }) => <Badge tone={QUOTE_TONE[s]}>{QUOTE_STATUS_LABEL[s]}</Badge>;
export const OSStatusBadge = ({ s }: { s: OSStatus }) => <Badge tone={OS_TONE[s]}>{OS_STATUS_LABEL[s]}</Badge>;
export const OSPaymentBadge = ({ s }: { s: OSPayment }) => <Badge tone={PAY_TONE[s]}>Pagamento: {OS_PAYMENT_LABEL[s].toLowerCase()}</Badge>;
