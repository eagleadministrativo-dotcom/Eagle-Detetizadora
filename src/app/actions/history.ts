"use server";
import { getDb } from "@/server/db";
import { requireSession, run, str } from "@/server/session";
import { DomainError } from "@/server/errors";
import { importSalesSheet } from "@/server/services/history-import";
import { fmtYmd } from "@/lib/dates";
import { fmtBRL as money } from "@/lib/money";

/** Planilha de vendas (PDF) → histórico de serviços. "Conferir" só mostra o que entraria. */
export async function importHistoryAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/historico", async () => {
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new DomainError("invalid", "Escolha o arquivo PDF da planilha.");
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") throw new DomainError("invalid_file", "Envie a planilha em PDF.");
    const dry = str(fd, "mode") === "check";
    const r = await importSalesSheet(await getDb(), ctx, new Uint8Array(await f.arrayBuffer()), { dryRun: dry });
    const period = r.firstDate && r.lastDate ? ` de ${fmtYmd(r.firstDate)} a ${fmtYmd(r.lastDate)}` : "";
    const base = `${r.records} serviço(s)${period}, ${money(r.totalCents)}`;
    const msg = dry
      ? `Conferência: ${base}. Entrariam ${r.inserted} (${r.skipped} já estão no histórico), com ${r.newCustomers} cliente(s) novo(s) e ${r.matchedCustomers} já cadastrado(s). Nada foi gravado.`
      : `Importado: ${base}. Gravados ${r.inserted}${r.skipped ? ` (${r.skipped} já estavam)` : ""}; ${r.newCustomers} cliente(s) novo(s) e ${r.matchedCustomers} já cadastrado(s).`;
    return { to: "/historico", ok: msg };
  });
}
