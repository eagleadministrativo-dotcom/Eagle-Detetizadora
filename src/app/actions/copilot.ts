"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import { requireSession } from "@/server/session";
import { dismissInsight } from "@/server/services/insights";

export async function dismissInsightAction(id: string, reason?: string) {
  const s = await requireSession();
  await dismissInsight(await getDb(), s.ctx, String(id), reason ?? null);
  revalidatePath("/");
}
