import { getDb } from "@/server/db";
import { requireSession } from "@/server/session";
import { can } from "@/server/core";
import Link from "next/link";

export const metadata = { title: "Ordens de Serviço" };

export default async function OSPage() {
  const { ctx } = await requireSession();
  if (!can(ctx, "agenda.manage")) throw new Error("Sem permissão");

  return (
    <div className="page">
      <h1>Ordens de Serviço</h1>
      <div style={{ textAlign: "center", padding: "40px", color: "#666" }}>As ordens de serviço são criadas a partir da agenda.</div>
    </div>
  );
}
