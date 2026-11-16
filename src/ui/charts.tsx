/**
 * Small hand-built SVG charts. Colours come from CSS tokens (--series-*,
 * --grid, --ink-*) so they follow light and dark mode; text always uses ink
 * tokens, never series colours. Every chart has a hover tooltip.
 */
import { useRef, useState, type ReactNode } from 'react';

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const show = (e: { clientX: number; clientY: number }, content: ReactNode) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content });
  };
  const el = tip && (
    <div className="chart-tip" style={{ left: Math.min(tip.x + 12, (ref.current?.clientWidth ?? 300) - 170), top: tip.y + 12 }} role="status">
      {tip.content}
    </div>
  );
  return { ref, show, hide: () => setTip(null), el };
}

/** Nice round axis ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) max = min + 1;
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/** Horizontal bars: one value per labelled row (spending by category). */
export function BarList({ rows, format }: { rows: { label: string; value: number; sub?: string }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="barlist">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${format(r.value)}`}>
          <div className="barlist-head">
            <span>{r.label}</span>
            <span className="amount">{format(r.value)}</span>
          </div>
          <div className="barlist-track">
            <div className="barlist-bar" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          {r.sub && <span className="meta">{r.sub}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Grouped columns for two series per period (money in vs money out). */
export function PairedColumns({
  data,
  labels,
  format,
  compact,
}: {
  data: { label: string; a: number; b: number }[];
  labels: [string, string];
  format: (v: number) => string;
  compact: (v: number) => string;
}) {
  const t = useTip();
  const W = 600;
  const H = 220;
  const pad = { l: 56, r: 8, t: 12, b: 28 };
  const ticks = niceTicks(0, Math.max(1, ...data.flatMap((d) => [d.a, d.b])));
  const top = ticks[ticks.length - 1];
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const band = (W - pad.l - pad.r) / Math.max(1, data.length);
  const bw = Math.min(28, (band - 10) / 2);
  return (
    <div className="chart" ref={t.ref} onMouseLeave={t.hide}>
      <div className="legend">
        <span><i className="sw s1" />{labels[0]}</span>
        <span><i className="sw s2" />{labels[1]}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${labels[0]} and ${labels[1]} by month`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.l - 6} y={y(v)} className="tick" textAnchor="end" dominantBaseline="middle">{compact(v)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + band * i + band / 2;
          return (
            <g key={d.label} onMouseMove={(e) => t.show(e, <><strong>{d.label}</strong><br />{labels[0]}: {format(d.a)}<br />{labels[1]}: {format(d.b)}<br />Net: {format(d.a - d.b)}</>)}>
              <rect x={cx - band / 2} y={pad.t} width={band} height={H - pad.t - pad.b} fill="transparent" />
              <Column x={cx - bw - 1} w={bw} y0={y(0)} y1={y(d.a)} cls="s1" />
              <Column x={cx + 1} w={bw} y0={y(0)} y1={y(d.b)} cls="s2" />
              <text x={cx} y={H - 8} className="tick" textAnchor="middle">{d.label}</text>
            </g>
          );
        })}
      </svg>
      {t.el}
    </div>
  );
}

/** A column with a 4px rounded top anchored to the baseline. */
function Column({ x, w, y0, y1, cls }: { x: number; w: number; y0: number; y1: number; cls: string }) {
  const h = Math.max(0, y0 - y1);
  if (h < 0.5) return null;
  const r = Math.min(4, h, w / 2);
  const d = `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`;
  return <path d={d} className={'mark ' + cls} />;
}

export interface LinePoint {
  x: number; // e.g. timestamp or index
  y: number;
  label: string;
  lo?: number;
  hi?: number;
}

/** A single-series line with optional uncertainty band and zero line. */
export function LineChart({
  points,
  format,
  compact,
  ariaLabel,
  markLowest,
}: {
  points: LinePoint[];
  format: (v: number) => string;
  compact: (v: number) => string;
  ariaLabel: string;
  markLowest?: boolean;
}) {
  const t = useTip();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p className="muted">Not enough data for a chart yet.</p>;
  const W = 600;
  const H = 220;
  const pad = { l: 64, r: 12, t: 12, b: 28 };
  const ys = points.flatMap((p) => [p.y, p.lo ?? p.y, p.hi ?? p.y]);
  const ticks = niceTicks(Math.min(0, ...ys), Math.max(...ys));
  const [y0, y1] = [ticks[0], ticks[ticks.length - 1]];
  const xs = points.map((p) => p.x);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - y0) / (y1 - y0 || 1));
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const hasBand = points.some((p) => p.lo !== undefined);
  const bandPath = hasBand
    ? points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x)},${sy(p.hi ?? p.y)}`).join(' ') +
      ' ' +
      [...points].reverse().map((p) => `L${sx(p.x)},${sy(p.lo ?? p.y)}`).join(' ') +
      ' Z'
    : '';
  const area = `${line} L${sx(x1)},${sy(Math.max(y0, 0))} L${sx(x0)},${sy(Math.max(y0, 0))} Z`;
  const labelEvery = Math.ceil(points.length / 6);
  const lowest = markLowest ? points.reduce((m, p, i) => (p.y < points[m].y ? i : m), 0) : -1;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(sx(p.x) - px) < Math.abs(sx(points[best].x) - px)) best = i;
    });
    setHover(best);
    const p = points[best];
    t.show(e, <><strong>{p.label}</strong><br />{format(p.y)}{p.lo !== undefined && <><br />Range: {compact(p.lo)} – {compact(p.hi ?? p.y)}</>}</>);
  };

  return (
    <div className="chart" ref={t.ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={() => { setHover(null); t.hide(); }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} className={v === 0 ? 'grid zero' : 'grid'} />
            <text x={pad.l - 6} y={sy(v)} className="tick" textAnchor="end" dominantBaseline="middle">{compact(v)}</text>
          </g>
        ))}
        {hasBand ? <path d={bandPath} className="band" /> : <path d={area} className="area" />}
        <path d={line} className="line" />
        {points.map((p, i) =>
          (i % labelEvery === 0 && points.length - 1 - i >= labelEvery * 0.6) || i === points.length - 1 ? (
            <text key={i} x={sx(p.x)} y={H - 8} className="tick" textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
              {p.label}
            </text>
          ) : null,
        )}
        <circle cx={sx(points[points.length - 1].x)} cy={sy(points[points.length - 1].y)} r={4} className="dot" />
        {lowest >= 0 && points[lowest].y < 0 && <circle cx={sx(points[lowest].x)} cy={sy(points[lowest].y)} r={5} className="dot warn" />}
        {hover !== null && (
          <>
            <line x1={sx(points[hover].x)} x2={sx(points[hover].x)} y1={pad.t} y2={H - pad.b} className="crosshair" />
            <circle cx={sx(points[hover].x)} cy={sy(points[hover].y)} r={4.5} className="dot" />
          </>
        )}
      </svg>
      {t.el}
    </div>
  );
}
