import { useId } from "react";
import { fmtBRL } from "@/lib/money";

/** Gráficos próprios em SVG: sem biblioteca, leves e nos dois temas (cores vêm dos tokens). */
const fmtShort = (c: number) => {
  const r = c / 100;
  return Math.abs(r) >= 1000 ? `${(r / 1000).toFixed(1).replace(".", ",")}k` : r.toFixed(0);
};
const dd = (ymd: string) => ymd.slice(8, 10) + "/" + ymd.slice(5, 7);
/** Escala com topo "redondo" (1, 2, 2,5 ou 5 × 10ⁿ) para as linhas de grade caírem em valores legíveis. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
/** Barra em cápsula: topo totalmente arredondado, base com cantos suaves. */
const bar = (x: number, y: number, w: number, h: number) => {
  if (h <= 0) return "";
  const r = Math.min(w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

export function BarChart({ data, labelEvery, labels, money = true }: { data: { date: string; a: number; b?: number }[]; labelEvery?: number; labels?: string[]; money?: boolean }) {
  const id = useId().replace(/:/g, "");
  if (!data.length) return null;
  const W = 640, H = 210, pl = 40, pb = 22, pt = 16;
  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.a, d.b ?? 0))));
  const bw = (W - pl) / data.length;
  const every = labelEvery ?? Math.max(1, Math.ceil(data.length / 10));
  const two = data.some((d) => d.b != null);
  const f = (v: number) => (money ? fmtBRL(v) : v.toLocaleString("pt-BR"));
  const best = data.reduce((m, d, i) => (d.a > data[m].a ? i : m), 0);
  return (
    <svg className="chart bars" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de barras (passe o cursor para ver os valores)">
      <defs>
        <linearGradient id={`a${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--chart-1-hi)" /><stop offset="1" stopColor="var(--chart-1)" stopOpacity="0.55" /></linearGradient>
        <linearGradient id={`b${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--chart-2-hi)" /><stop offset="1" stopColor="var(--chart-2)" stopOpacity="0.5" /></linearGradient>
        <filter id={`g${id}`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line className={t === 0 ? "axis" : "grid"} x1={pl} x2={W} y1={pt + (H - pb - pt) * (1 - t)} y2={pt + (H - pb - pt) * (1 - t)} />
          {t % 0.5 === 0 ? <text x={pl - 6} y={pt + (H - pb - pt) * (1 - t) + 3} textAnchor="end">{money ? fmtShort(max * t) : Math.round(max * t)}</text> : null}
        </g>
      ))}
      {data.map((d, i) => {
        const hA = ((H - pb - pt) * d.a) / max, hB = ((H - pb - pt) * (d.b ?? 0)) / max;
        const x = pl + i * bw, w = Math.max(2, bw * (two ? 0.4 : 0.66)), xa = x + (two ? bw * 0.08 : (bw - w) / 2);
        return (
          <g key={d.date + i} className="col">
            <rect className="hit" x={x} y={pt} width={bw} height={H - pb - pt} />
            <title>{`${labels?.[i] ?? dd(d.date)} · ${f(d.a)}${two ? ` · despesas ${f(d.b ?? 0)}` : ""}`}</title>
            {i === best && d.a > 0 ? <path d={bar(xa, H - pb - hA, w, hA)} fill={`url(#a${id})`} filter={`url(#g${id})`} opacity="0.55" /> : null}
            <path className="bA" d={bar(xa, H - pb - hA, w, hA)} fill={`url(#a${id})`} style={{ ["--i" as string]: i }} />
            {i === best && d.a > 0 && w >= 6 ? <circle className="cap" cx={xa + w / 2} cy={H - pb - hA + Math.min(w / 2, hA / 2)} r={Math.min(3, w / 4)} /> : null}
            {two ? <path className="bB" d={bar(x + bw * 0.52, H - pb - hB, w, hB)} fill={`url(#b${id})`} style={{ ["--i" as string]: i }} /> : null}
            {i === best && d.a > 0 ? <g className="tip" transform={`translate(${Math.min(Math.max(xa + w / 2, pl + 34), W - 34)},${Math.max(H - pb - hA - 16, 12)})`}><rect x="-32" y="-11" width="64" height="19" rx="9.5" /><text x="0" y="3" textAnchor="middle">{money ? fmtShort(d.a) : d.a}</text></g> : null}
            {d.a > 0 && i !== best ? <text className="val" x={xa + w / 2} y={H - pb - hA - 5} textAnchor="middle">{money ? fmtShort(d.a) : d.a}</text> : null}
            {i % every === 0 ? <text x={x + bw / 2} y={H - 6} textAnchor="middle">{labels?.[i] ?? dd(d.date)}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

/** Curva suave (Catmull-Rom) entre os pontos. */
function smooth(pts: [number, number][]) {
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export function LineChart({ data, estimateFrom }: { data: { date: string; v: number }[]; estimateFrom?: string }) {
  const id = useId().replace(/:/g, "");
  if (data.length < 2) return null;
  const W = 640, H = 190, pl = 46, pb = 22, pt = 18;
  const vals = data.map((d) => d.v);
  const min = Math.min(0, ...vals), max = Math.max(1, ...vals) > 0 ? niceMax(Math.max(1, ...vals)) : 1;
  const x = (i: number) => pl + ((W - pl - 12) * i) / (data.length - 1);
  const y = (v: number) => pt + ((H - pb - pt) * (max - v)) / (max - min || 1);
  const idxEst = estimateFrom ? data.findIndex((d) => d.date >= estimateFrom) : -1;
  const pts = data.map((d, i) => [x(i), y(d.v)] as [number, number]);
  const real = idxEst > 0 ? pts.slice(0, idxEst + 1) : idxEst === 0 ? [] : pts;
  const est = idxEst >= 0 ? pts.slice(Math.max(0, idxEst)) : [];
  const every = Math.max(1, Math.ceil(data.length / 8));
  const last = real.length ? real[real.length - 1] : pts[pts.length - 1];
  const lastV = data[(real.length || pts.length) - 1].v;
  const base = y(Math.max(min, 0));
  return (
    <svg className="chart lines" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Evolução no período; último valor ${fmtBRL(lastV)}`}>
      <defs>
        <linearGradient id={`ar${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--chart-1-hi)" stopOpacity="0.36" /><stop offset="1" stopColor="var(--chart-1)" stopOpacity="0" /></linearGradient>
        <linearGradient id={`ln${id}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="var(--chart-1)" /><stop offset="1" stopColor="var(--chart-3)" /></linearGradient>
        <filter id={`gl${id}`} x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
      </defs>
      {[0, 0.5, 1].map((t) => { const v = min + (max - min) * t; return (
        <g key={t}><line className={t === 0 ? "axis" : "grid"} x1={pl} x2={W} y1={y(v)} y2={y(v)} /><text x={pl - 6} y={y(v) + 3} textAnchor="end">{fmtShort(v)}</text></g>
      ); })}
      {min < 0 ? <line x1={pl} x2={W} y1={y(0)} y2={y(0)} className="zero" /> : null}
      {real.length > 1 ? <path d={`${smooth(real)} L${real[real.length - 1][0].toFixed(1)},${base.toFixed(1)} L${real[0][0].toFixed(1)},${base.toFixed(1)} Z`} fill={`url(#ar${id})`} /> : null}
      {real.length > 1 ? <path d={smooth(real)} fill="none" stroke={`url(#ln${id})`} strokeWidth="6" opacity="0.35" filter={`url(#gl${id})`} /> : null}
      {real.length > 1 ? <path className="line" d={smooth(real)} stroke={`url(#ln${id})`} pathLength={1} /> : null}
      {est.length > 1 ? <path className="line2" d={smooth(est)} /> : null}
      {data.map((d, i) => (
        <g key={d.date} className="pt"><rect className="hit" x={x(i) - (W - pl) / data.length / 2} y={pt} width={(W - pl) / data.length} height={H - pb - pt} /><title>{`${dd(d.date)} · ${fmtBRL(d.v)}`}</title><circle cx={x(i)} cy={y(d.v)} r="3.5" /></g>
      ))}
      {real.map((p, i) => (i % Math.max(1, Math.ceil(real.length / 6)) === 0 && i < real.length - 1 ? <circle key={"m" + i} className="mk" cx={p[0]} cy={p[1]} r="4.5" style={{ ["--i" as string]: i }} /> : null))}
      <circle className="now" cx={last[0]} cy={last[1]} r="5" />
      <g transform={`translate(${Math.min(last[0], W - 60)},${Math.max(last[1] - 14, 10)})`}><rect className="tag" x="-36" y="-11" width="72" height="18" rx="9" /><text className="tagt" x="0" y="2" textAnchor="middle">{fmtShort(lastV)}</text></g>
      {data.map((d, i) => (i % every === 0 ? <text key={d.date + "l"} x={x(i)} y={H - 6} textAnchor="middle">{dd(d.date)}</text> : null))}
    </svg>
  );
}

export function HBars({ rows }: { rows: { label: string; value: number; text: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbars">
      {rows.map((r, i) => (
        <div className="hbar" key={r.label} style={{ ["--d" as string]: `${i * 60}ms` }}>
          <span className="hl" title={r.label}>{r.label}</span>
          <span className="mono">{r.text}</span>
          <div className="track"><div className="fill" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

/** Rosca de participação (ex.: formas de pagamento). */
export function Donut({ rows, center }: { rows: { label: string; value: number; text: string }[]; center?: string }) {
  const total = rows.reduce((a, r) => a + Math.max(0, r.value), 0);
  if (!total) return null;
  const R = 58, C = 2 * Math.PI * R;
  const offs = rows.map((_, i) => rows.slice(0, i).reduce((a, r) => a + (Math.max(0, r.value) / total) * C, 0));
  const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--olive-500)", "var(--burgundy-500)"];
  return (
    <div className="donut">
      <svg viewBox="0 0 160 160" role="img" aria-label={rows.map((r) => `${r.label}: ${r.text}`).join("; ")}>
        <circle cx="80" cy="80" r={R} className="ring" />
        {rows.map((r, i) => {
          const len = (Math.max(0, r.value) / total) * C, off = offs[i];
          return <circle key={r.label} cx="80" cy="80" r={R} fill="none" stroke={colors[i % colors.length]} strokeWidth="16" strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 80 80)"><title>{`${r.label}: ${r.text}`}</title></circle>;
        })}
        {center ? <text x="80" y="86" textAnchor="middle" className="dc">{center}</text> : null}
      </svg>
      <ul>{rows.map((r, i) => <li key={r.label}><i style={{ background: colors[i % colors.length] }} /><span>{r.label}</span><b className="mono">{r.text}</b><small>{Math.round((Math.max(0, r.value) / total) * 100)}%</small></li>)}</ul>
    </div>
  );
}

/** Mini gráfico de linha para cartões. */
export function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 120, H = 32, min = Math.min(...values), max = Math.max(...values);
  const pts = values.map((v, i) => [(W * i) / (values.length - 1), H - 3 - ((H - 6) * (v - min)) / (max - min || 1)] as [number, number]);
  return <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true"><path d={smooth(pts)} /></svg>;
}

const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export function Heatmap({ cells }: { cells: { dow: number; hour: number; n: number }[] }) {
  const max = Math.max(1, ...cells.map((c) => c.n));
  const hours = Array.from({ length: 14 }, (_, i) => 8 + i);
  return (
    <div role="img" aria-label="Mapa de calor de ocupação por dia e horário">
      <div className="heat" style={{ marginBottom: 3 }}>
        <span />
        {hours.map((h) => <span key={h} style={{ textAlign: "center" }}>{h}h</span>)}
      </div>
      {[1, 2, 3, 4, 5, 6, 0].map((d) => (
        <div className="heat" key={d} style={{ marginBottom: 3 }}>
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
