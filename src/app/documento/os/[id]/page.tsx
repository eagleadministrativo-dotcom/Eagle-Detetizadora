import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requireSession } from "@/server/session";
import { getServiceOrder } from "@/server/services/eagle";
import { OrderDocument } from "@/components/documents";
import { PrintButton } from "@/components/client";

export const metadata = { title: "Ordem de serviço" };

export default async function OrderDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireSession();
  const o = await getServiceOrder(await getDb(), ctx, id).catch(() => null);
  if (!o) notFound();
  return (
    <main className="docpage">
      <div className="toolbar">
        <Link className="btn ghost" href={`/os/${o.id}`}>← Voltar à OS</Link>
        <span className="grow" />
        <a className="btn ghost" href={`/api/documento/os/${o.id}`}>Baixar Word</a>
        <PrintButton label="Imprimir / salvar PDF" />
      </div>
      <OrderDocument o={o} />
    </main>
  );
}
