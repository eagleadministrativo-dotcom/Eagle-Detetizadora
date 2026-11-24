"use server";
import { getDb } from "@/server/db";
import { requireSession, run, str, optStr, bool } from "@/server/session";
import { saveCustomer, importCustomers } from "@/server/services/customers";
import { DomainError } from "@/server/errors";

export async function saveCustomerAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = optStr(fd, "id");
  await run(id ? `/clientes/${id}` : "/clientes/novo", async () => {
    const savedId = await saveCustomer(await getDb(), ctx, {
      id: id ?? undefined, name: str(fd, "name"), phone: optStr(fd, "phone"), email: optStr(fd, "email"), cpf: optStr(fd, "cpf"), birthdate: optStr(fd, "birthdate"), notes: optStr(fd, "notes"),
      isActive: id ? bool(fd, "isActive") : undefined,
    });
    return { to: `/clientes/${savedId}`, ok: id ? "Cliente atualizado." : "Cliente cadastrado." };
  });
}

export async function importCustomersAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/clientes/importar", async () => {
    let rows: unknown;
    try { rows = JSON.parse(String(fd.get("payload") ?? "[]")); } catch { throw new DomainError("invalid", "Lista de contatos inválida."); }
    const r = await importCustomers(await getDb(), ctx, rows as never);
    const extra = [r.duplicates ? r.duplicates + " já existiam" : "", r.invalid ? r.invalid + " sem nome ou telefone válido" : ""].filter(Boolean).join("; ");
    return { to: "/clientes", ok: r.created + (r.created === 1 ? " cliente importado" : " clientes importados") + (extra ? " (" + extra + ")" : "") + "." };
  });
}
