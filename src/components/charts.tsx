import { fmtBRL } from "@/lib/money";

const fmtShort = (c: number) => {
  const r = c / 100;
  return Math.abs(r) >= 1000 ? `${(r / 1000).toFixed(1).replace(".", ",")}k` : r.toFixed(0);
};
const dd = (ymd: string) => ymd.slice(8, 10) + "/" + ymd.slice(5, 7);

export function BarChart({ data, labelEvery }: { data: { date: string; a: number; b?: number }[]; labelEvery?: number }) {
  if (!data.length) return null;
  const W = 640, H = 200, pl = 38, pb = 20, pt = 8;
  const max = Math.max(1, ...data.map((d) => Math.max(d.a, d.b ?? 0)));
  const bw = (W - pl) / data.length;
  const every = labelEvery ?? Math.max(1, Math.ceil(data.length / 10));
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de barras por dia">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line className="grid" x1={pl} x2={W} y1={pt + (H - pb - pt) * (1 - t)} y2={pt + (H - pb - pt) * (1 - t)} />
          <text x={pl - 4} y={pt + (H - pb - pt) * (1 - t) + 3} textAnchor="end">{fmtShort(max * t)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const hA = ((H - pb - pt) * d.a) / max;
        const hB = ((H - pb - pt) * (d.b ?? 0)) / max;
        const x = pl + i * bw;
        const two = d.b != null;
        return (
          <g key={d.date}>
            <title>{`${dd(d.date)} · ${fmtBRL(d.a)}${two ? ` · despesas ${fmtBRL(d.b ?? 0)}` : ""}`}</title>
            <rect className="bar" x={x + bw * 0.12} width={Math.max(1, (bw * (two ? 0.38 : 0.76)))} y={H - pb - hA} height={hA} />
            {two ? <rect className="bar2" x={x + bw * 0.5} width={Math.max(1, bw * 0.38)} y={H - pb - hB} height={hB} /> : null}
            {i % every === 0 ? <text x={x + bw / 2} y={H - 5} textAnchor="middle">{dd(d.date)}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

export function LineChart({ data, estimateFrom }: { data: { date: string; v: number }[]; estimateFrom?: string }) {
  if (data.length < 2) return null;
  const W = 640, H = 180, pl = 44, pb = 20, pt = 8;
  const vals = data.map((d) => d.v);
  const min = Math.min(0, ...vals), max = Math.max(1, ...vals);
  const x = (i: number) => pl + ((W - pl - 6) * i) / (data.length - 1);
  const y = (v: number) => pt + ((H - pb - pt) * (max - v)) / (max - min || 1);
  const idxEst = estimateFrom ? data.findIndex((d) => d.date >= estimateFrom) : -1;
  const path = (from: number, to: number) => data.slice(from, to).map((d, i) => `${i ? "L" : "M"}${x(from + i).toFixed(1)},${y(d.v).toFixed(1)}`).join(" ");
  const every = Math.max(1, Math.ceil(data.length / 8));
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de linha">
      {[min, (min + max) / 2, max].map((t) => (
        <g key={t}>
          <line className="grid" x1={pl} x2={W} y1={y(t)} y2={y(t)} />
          <text x={pl - 4} y={y(t) + 3} textAnchor="end">{fmtShort(t)}</text>
        </g>
      ))}
      {min < 0 ? <line x1={pl} x2={W} y1={y(0)} y2={y(0)} stroke="var(--bad)" strokeDasharray="2 3" /> : null}
      {idxEst > 0 ? (
        <>
          <path className="line" d={path(0, idxEst + 1)} />
          <path className="line2" d={path(idxEst, data.length)} />
        </>
      ) : idxEst === 0 ? <path className="line2" d={path(0, data.length)} /> : <path className="line" d={path(0, data.length)} />}
      {data.map((d, i) => (i % every === 0 ? <text key={d.date} x={x(i)} y={H - 5} textAnchor="middle">{dd(d.date)}</text> : null))}
    </svg>
  );
}

export function HBars({ rows }: { rows: { label: string; value: number; text: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="stack">
      {rows.map((r) => (
        <div className="hbar" key={r.label}>
          <span title={r.label} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          <div className="track"><div className="fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span className="mono">{r.text}</span>
        </div>
      ))}
    </div>
  );
}

const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export function Heatmap({ cells }: { cells: { dow: number; hour: number; n: number }[] }) {
  const max = Math.max(1, ...cells.map((c) => c.n));
  const hours = Array.from({ length: 14 }, (_, i) => 8 + i);
  return (
    <div role="img" aria-label="Mapa de calor de ocupação por dia e horário">
      <div className="heat" style={{ marginBottom: 2 }}>
        <span />
        {hours.map((h) => <span key={h} style={{ textAlign: "center" }}>{h}h</span>)}
      </div>
      {[1, 2, 3, 4, 5, 6, 0].map((d) => (
        <div className="heat" key={d} style={{ marginBottom: 2 }}>
          <span>{DOW[d]}</span>
          {hours.map((h) => {
            const n = cells.find((c) => c.dow === d && c.hour === h)?.n ?? 0;
            return <i key={h} title={`${DOW[d]} ${h}h: ${n} atendimento(s)`} style={{ ["--v" as string]: Math.round((n / max) * 100) }} />;
          })}
        </div>
      ))}
    </div>
  );
}
