"use server";
import { getDb } from "@/server/db";
import { requireSession, run, str, optStr, bool } from "@/server/session";
import { saveCustomer } from "@/server/services/customers";

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
