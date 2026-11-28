"use server";
import { getDb } from "@/server/db";
import { optStr, requireSession, run, str } from "@/server/session";
import { applyProfile, deleteProfile, saveProfile, setUserAccess, setUserPermissions } from "@/server/services/access";
import { accessFor, type Role } from "@/server/permissions";

export async function setAccessAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/admin/usuarios/${id}`, async () => {
    const db = await getDb();
    const role = str(fd, "role") as Role;
    const perms = fd.getAll("perm").map(String);
    const r = await setUserAccess(db, ctx, id, role, perms);
    const name = optStr(fd, "profileName");
    if (name && role !== "administrador") await saveProfile(db, ctx, { name, baseRole: role, permissions: accessFor(role, perms) });
    return `Cargo e acesso salvos${r.added.length || r.removed.length ? `: ${r.added.length} liberada(s), ${r.removed.length} retirada(s)` : ""}. Vale na próxima tela que a pessoa abrir.${name ? ` Perfil "${name}" salvo.` : ""}`;
  });
}

export async function setPermissionsAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/admin/usuarios/${id}`, async () => {
    const db = await getDb();
    const perms = fd.getAll("perm").map(String);
    const name = optStr(fd, "profileName");
    if (name) { await saveProfile(db, ctx, { name, baseRole: str(fd, "role") as Role, permissions: perms }); }
    const r = await setUserPermissions(db, ctx, id, perms);
    return `Acesso atualizado: ${r.added.length} concedida(s), ${r.removed.length} revogada(s).${name ? ` Perfil "${name}" salvo.` : ""}`;
  });
}
export async function applyProfileAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "id");
  await run(`/admin/usuarios/${id}`, async () => { await applyProfile(await getDb(), ctx, id, str(fd, "profileId")); return "Perfil aplicado."; });
}
export async function deleteProfileAction(fd: FormData) {
  const { ctx } = await requireSession();
  await run("/admin/usuarios", async () => { await deleteProfile(await getDb(), ctx, str(fd, "id")); return "Perfil removido. Quem o usava mantém as permissões atuais."; });
}
