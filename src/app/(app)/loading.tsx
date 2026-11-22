import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="stack" role="status" aria-live="polite" aria-label="Carregando">
      <Skeleton h={44} w="40%" />
      <div className="heroes"><Skeleton h={130} /><Skeleton h={130} /><Skeleton h={130} /></div>
      <Skeleton h={260} />
      <span className="sr">Carregando…</span>
    </div>
  );
}
