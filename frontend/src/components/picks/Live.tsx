import { Radio } from "lucide-react";
import { Signed } from "@/components/common";
import { Eyebrow } from "@/components/picks/parts";
import { fmtPct, fmtPrice, fmtUsdSigned } from "@/lib/format";
import { STALE_AFTER_MS, type Live } from "@/lib/live";
import { num, type Pick } from "@/lib/picks";
import { cn } from "@/lib/utils";

function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

/** Pulsing dot + "updated Ns ago"; grey when the feed is stale or the market is closed. */
export function LiveIndicator({
  asOf,
  marketOpen,
  now,
  className,
}: {
  asOf: string | null | undefined;
  marketOpen: boolean;
  now: number;
  className?: string;
}) {
  const ts = asOf ? Date.parse(asOf) : null;
  const age = ts !== null ? now - ts : null;
  const live = marketOpen && age !== null && age < STALE_AFTER_MS;
  const label = !marketOpen
    ? ts !== null
      ? `Market closed · last price ${fmtAgo(age ?? 0)}`
      : "Market closed"
    : ts === null
      ? "Waiting for the first prices…"
      : live
        ? `Live · updated ${fmtAgo(age ?? 0)}`
        : `Delayed · last price ${fmtAgo(age ?? 0)}`;
  return (
    <span
      className={cn(
        "num inline-flex items-center gap-1.5 text-2xs font-medium",
        live ? "text-gain" : "text-muted-foreground",
        className,
      )}
      role="status"
      aria-live="off"
    >
      <span aria-hidden className="relative flex h-2 w-2">
        {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gain opacity-60" />}
        <span
          className={cn("relative inline-flex h-2 w-2 rounded-full", live ? "bg-gain" : "bg-muted-foreground/50")}
        />
      </span>
      {label}
    </span>
  );
}

/** Tiny intraday line; `levels` are drawn as dashed reference lines (e.g. entry, target, stop). */
export function Sparkline({
  values,
  levels = [],
  className,
  label,
}: {
  values: number[];
  levels?: { value: number; cls: string }[];
  className?: string;
  label: string;
}) {
  const W = 120;
  const H = 32;
  if (values.length < 2) {
    return <div className={cn("h-8 w-[7.5rem]", className)} aria-hidden />;
  }
  const all = [...values, ...levels.map((l) => l.value)];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const y = (v: number) => H - 2 - ((v - lo) / (hi - lo)) * (H - 4);
  const x = (i: number) => (i / (values.length - 1)) * W;
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const up = last >= first;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn("h-8 w-[7.5rem] overflow-visible", className)}
      role="img"
      aria-label={label}
    >
      {levels.map((l, i) => (
        <line
          key={i}
          x1={0}
          x2={W}
          y1={y(l.value)}
          y2={y(l.value)}
          strokeDasharray="2 3"
          strokeWidth={1}
          className={l.cls}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path
        d={d}
        fill="none"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        className={up ? "stroke-gain" : "stroke-loss"}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={x(values.length - 1)} cy={y(last)} r={2.25} className={up ? "fill-gain" : "fill-loss"} />
    </svg>
  );
}

/** Live price, move since the open, unrealized P/L and distance to the target/stop for one pick. */
export function LiveStrip({ pick, live, now }: { pick: Pick; live: Live; now: number }) {
  const stale = now - live.ts > STALE_AFTER_MS;
  const fill = num(pick.entry_fill_price);
  const qty = num(pick.entry_filled_qty) ?? 0;
  const holding = pick.status === "ENTERED" && fill !== null && qty > 0;
  const target = num(pick.target_price);
  const stop = num(pick.stop_price);
  const entry = num(pick.entry_limit);
  const ended = !!pick.exit_reason || ["NOT_FILLED", "NOT_TRADED", "FAILED"].includes(pick.status);
  const toTarget = target !== null && !ended ? (target / live.price - 1) * 100 : null;
  const toStop = stop !== null && !ended ? (stop / live.price - 1) * 100 : null;
  const levels = [
    ...(target !== null ? [{ value: target, cls: "stroke-gain/60" }] : []),
    ...(stop !== null ? [{ value: stop, cls: "stroke-loss/60" }] : []),
    ...((fill ?? entry) !== null
      ? [
          {
            value: (fill ?? entry) as number,
            cls: "stroke-muted-foreground/50",
          },
        ]
      : []),
  ];
  const sincePct = holding ? (live.price / (fill as number) - 1) * 100 : null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-3 border-b bg-muted/20 px-4 py-3 sm:px-5",
        stale && "opacity-70",
      )}
      aria-label={`Live price for ${pick.symbol}`}
    >
      <div className="min-w-0">
        <Eyebrow>
          <span className="inline-flex items-center gap-1">
            <Radio className="h-3 w-3" aria-hidden /> {stale ? "Last price" : "Now"}
          </span>
        </Eyebrow>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="num text-lg font-semibold tracking-tight">{fmtPrice(live.price)}</span>
          <Signed value={live.changePct} className="text-xs font-medium">
            {fmtPct(live.changePct, 2, true)}
          </Signed>
          <span className="text-2xs text-muted-foreground">vs open</span>
        </div>
      </div>
      {holding && sincePct !== null && (
        <div className="min-w-0">
          <Eyebrow>Open position</Eyebrow>
          <div className="mt-0.5 flex items-baseline gap-2">
            <Signed value={sincePct} className="text-lg font-semibold tracking-tight">
              {fmtPct(sincePct, 2, true)}
            </Signed>
            <Signed value={sincePct} className="text-xs font-medium">
              {fmtUsdSigned((live.price - (fill as number)) * qty)}
            </Signed>
            <span className="text-2xs text-muted-foreground">unrealized</span>
          </div>
        </div>
      )}
      {(toTarget !== null || toStop !== null) && (
        <div className="num grid gap-0.5 text-2xs text-muted-foreground">
          {toTarget !== null && (
            <span>
              Target <span className="font-medium text-gain">{fmtPct(toTarget, 2, true)}</span> away
            </span>
          )}
          {toStop !== null && (
            <span>
              Stop <span className="font-medium text-loss">{fmtPct(toStop, 2, true)}</span> away
            </span>
          )}
        </div>
      )}
      <Sparkline
        values={live.series}
        levels={levels}
        className="ml-auto"
        label={`${pick.symbol} intraday: ${live.series.length} samples, now ${fmtPrice(live.price)}`}
      />
    </div>
  );
}
