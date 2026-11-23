"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import { bool, requireSession, run, setThemeCookie, str } from "@/server/session";
import { savePrefs, type Prefs, type Theme } from "@/server/services/access";
import { markRead, NOTIFY_GROUPS } from "@/server/services/notify";

export async function saveThemeAction(theme: string) {
  const s = await requireSession();
  if (!["auto", "claro", "escuro"].includes(theme)) return;
  await savePrefs(await getDb(), s.user.id, { theme: theme as Theme });
  await setThemeCookie(theme as Theme);
}
export async function savePrefsAction(fd: FormData) {
  const s = await requireSession();
  await run("/conta", async () => {
    const notify = Object.fromEntries(NOTIFY_GROUPS.map((g) => [g.key, bool(fd, `n_${g.key}`)]));
    await savePrefs(await getDb(), s.user.id, { agenda_view: str(fd, "agendaView") as Prefs["agenda_view"], notify });
    return "Preferências salvas.";
  });
}
export async function markReadAction(fd: FormData) {
  const { ctx } = await requireSession();
  await markRead(await getDb(), ctx, str(fd, "id") || undefined);
  revalidatePath("/notificacoes");
}
