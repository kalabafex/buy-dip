import { useEffect, useRef, useState } from "react";
import type { Schemas } from "@/api/client";
import { pct01 } from "@/lib/engine";
import { cn } from "@/lib/utils";

type Bin = Schemas["ReviewBin"];

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const H = 232;
const M = { top: 10, right: 12, bottom: 34, left: 40 };

/**
 * Reliability diagram: each certainty bucket's average predicted certainty (x) against the
 * share that actually ended positive (y). The diagonal is perfect calibration; below it the
 * engine was overconfident. Dot area follows the bucket's sample size, labelled with n.
 */
export function CalibrationChart({ bins, className }: { bins: Bin[]; className?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pts = bins
    .map((b, i) => ({ ...b, i }))
    .filter((b): b is Bin & { i: number; avg_certainty: number; win_rate: number } => b.n > 0 && b.avg_certainty != null && b.win_rate != null);
  const vals = pts.flatMap((p) => [p.avg_certainty, p.win_rate]);
  let lo = Math.max(0, Math.floor((Math.min(0.3, ...vals) - 0.02) * 10) / 10);
  let hi = Math.min(1, Math.ceil((Math.max(0.8, ...vals) + 0.02) * 10) / 10);
  if (hi - lo < 0.4) {
    lo = Math.max(0, hi - 0.4);
    hi = lo + 0.4;
  }
  const iw = Math.max(0, width - M.left - M.right);
  const ih = H - M.top - M.bottom;
  const x = (v: number) => M.left + ((v - lo) / (hi - lo)) * iw;
  const y = (v: number) => M.top + ih - ((v - lo) / (hi - lo)) * ih;
  const ticks: number[] = [];
  for (let t = Math.round(lo * 10); t <= Math.round(hi * 10); t += 1) ticks.push(t / 10);
  const maxN = Math.max(1, ...pts.map((p) => p.n));
  const r = (n: number) => 4 + 5 * Math.sqrt(n / maxN);
  const h = hover !== null ? pts.find((p) => p.i === hover) : undefined;

  // n labels: first free spot (right, left, below, above) that clears every dot and label
  // placed so far; skipped when none fits (the table beside the chart carries every n).
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const placed: Box[] = [];
  const hit = (b: Box) =>
    placed.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) ||
    pts.some((p) => {
      const cx = x(p.avg_certainty);
      const cy = y(p.win_rate);
      const rr = r(p.n) + 2;
      return b.x0 < cx + rr && b.x1 > cx - rr && b.y0 < cy + rr && b.y1 > cy - rr;
    }) ||
    b.x0 < M.left ||
    b.x1 > M.left + iw + M.right ||
    b.y0 < 0 ||
    b.y1 > M.top + ih;
  const labelPos = new Map<number, { x: number; y: number; anchor: "start" | "end" | "middle" }>();
  for (const p of [...pts].sort((a, b) => b.n - a.n)) {
    const cx = x(p.avg_certainty);
    const cy = y(p.win_rate);
    const rr = r(p.n);
    const tw = 6 * `n=${p.n}`.length;
    const opts = [
      { x: cx + rr + 4, y: cy, anchor: "start" as const, box: { x0: cx + rr + 3, y0: cy - 6, x1: cx + rr + 5 + tw, y1: cy + 6 } },
      { x: cx - rr - 4, y: cy, anchor: "end" as const, box: { x0: cx - rr - 5 - tw, y0: cy - 6, x1: cx - rr - 3, y1: cy + 6 } },
      { x: cx, y: cy + rr + 10, anchor: "middle" as const, box: { x0: cx - tw / 2, y0: cy + rr + 3, x1: cx + tw / 2, y1: cy + rr + 15 } },
      { x: cx, y: cy - rr - 10, anchor: "middle" as const, box: { x0: cx - tw / 2, y0: cy - rr - 17, x1: cx + tw / 2, y1: cy - rr - 3 } },
    ];
    const ok = opts.find((o) => !hit(o.box));
    if (ok) {
      placed.push(ok.box);
      labelPos.set(p.i, ok);
    }
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" /> Actual win rate (size = candidates)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-px w-4 bg-foreground/45" /> Perfect calibration
        </span>
      </div>
      <div ref={ref} className="relative w-full" style={{ height: H }}>
        {width > 0 && (
          <svg
            width={width}
            height={H}
            role="img"
            aria-label="Calibration: predicted certainty versus actual win rate per bucket"
            className="overflow-visible"
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={M.left + iw} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
                <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px]">
                  {Math.round(t * 100)}%
                </text>
                <text x={x(t)} y={M.top + ih + 14} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                  {Math.round(t * 100)}%
                </text>
              </g>
            ))}
            <line x1={M.left} x2={M.left + iw} y1={M.top + ih} y2={M.top + ih} className="stroke-foreground/25" strokeWidth={1} />
            <text x={M.left + iw / 2} y={H - 4} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              Certainty said →
            </text>
            <text
              transform={`translate(10 ${M.top + ih / 2}) rotate(-90)`}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              Actually ended positive →
            </text>
            {/* perfect calibration */}
            <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} className="stroke-foreground/45" strokeWidth={1.25} />
            {/* miscalibration gaps */}
            {pts.map((p) => (
              <line
                key={`g${p.i}`}
                x1={x(p.avg_certainty)}
                x2={x(p.avg_certainty)}
                y1={y(p.avg_certainty)}
                y2={y(p.win_rate)}
                className={p.win_rate < p.avg_certainty ? "stroke-loss/60" : "stroke-gain/60"}
                strokeWidth={2}
                strokeLinecap="round"
              />
            ))}
            {pts.map((p) => (
              <g
                key={p.i}
                tabIndex={0}
                role="img"
                aria-label={`Bucket ${p.range}: said ${pct01(p.avg_certainty)}, won ${pct01(p.win_rate)}, ${p.n} candidates`}
                onPointerEnter={() => setHover(p.i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(p.i)}
                onBlur={() => setHover(null)}
                className="cursor-default outline-none"
              >
                <circle cx={x(p.avg_certainty)} cy={y(p.win_rate)} r={Math.max(14, r(p.n) + 6)} fill="transparent" />
                <circle
                  cx={x(p.avg_certainty)}
                  cy={y(p.win_rate)}
                  r={r(p.n) + (hover === p.i ? 1.5 : 0)}
                  className="fill-primary stroke-card"
                  strokeWidth={2}
                />
                {labelPos.has(p.i) && (
                  <text
                    x={labelPos.get(p.i)!.x}
                    y={labelPos.get(p.i)!.y}
                    dy="0.32em"
                    textAnchor={labelPos.get(p.i)!.anchor}
                    className="fill-muted-foreground text-[10px]"
                  >
                    n={p.n}
                  </text>
                )}
              </g>
            ))}
          </svg>
        )}
        {h && (
          <div
            className="pointer-events-none absolute z-10 w-max -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2.5 py-1.5 text-2xs shadow-pop"
            style={{ left: x(h.avg_certainty), top: y(h.win_rate) - r(h.n) - 8 }}
          >
            <div className="num text-xs font-semibold">
              won {pct01(h.win_rate)} <span className="font-normal text-muted-foreground">vs said {pct01(h.avg_certainty)}</span>
            </div>
            <div className="text-muted-foreground">
              certainty {h.range} · {h.n} candidates
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Table twin of the calibration chart. */
export function CalibrationTable({ bins }: { bins: Bin[] }) {
  return (
    <table className="num w-full text-xs">
      <caption className="sr-only">Certainty buckets: predicted versus actual</caption>
      <thead>
        <tr className="border-b text-2xs uppercase tracking-wider text-muted-foreground">
          <th scope="col" className="py-1.5 text-left font-medium">
            Certainty
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            n
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            Said
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            Won
          </th>
        </tr>
      </thead>
      <tbody>
        {bins.map((b) => {
          const gap = b.avg_certainty != null && b.win_rate != null ? b.win_rate - b.avg_certainty : null;
          return (
            <tr key={b.range} className="border-b border-border/60 last:border-0">
              <th scope="row" className="py-1.5 text-left font-normal text-muted-foreground">
                {b.range.replace("-", "–")}
              </th>
              <td className="py-1.5 text-right">{b.n}</td>
              <td className="py-1.5 text-right text-muted-foreground">{pct01(b.avg_certainty)}</td>
              <td
                className={cn(
                  "py-1.5 text-right font-semibold",
                  gap !== null && gap < -0.05 && "text-loss",
                  gap !== null && gap > 0.05 && "text-gain",
                )}
              >
                {pct01(b.win_rate)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
