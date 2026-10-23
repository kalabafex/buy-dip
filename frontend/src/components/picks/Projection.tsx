import { Eyebrow, WinRateBar } from "@/components/picks/parts";
import { InfoPopover } from "@/components/ui/popover";
import { fmtRangePct } from "@/lib/engine";
import { fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Likely range (middle 50% of past outcomes) on a small scale that always includes zero:
 * the part of the band below zero reads loss, above zero gain; the dot is the projection.
 * The numbers are printed beside it, so nothing depends on reading the scale.
 */
export function RangeBar({
  low,
  high,
  value,
  className,
}: {
  low: number;
  high: number;
  value: number;
  className?: string;
}) {
  let lo = Math.min(low, value, 0);
  let hi = Math.max(high, value, 0);
  const minSpan = 1;
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const z = x(0);
  const neg = low < 0 ? { left: x(low), width: x(Math.min(high, 0)) - x(low) } : null;
  const pos = high > 0 ? { left: x(Math.max(low, 0)), width: x(high) - x(Math.max(low, 0)) } : null;
  return (
    <div
      className={cn("relative h-4 w-full", className)}
      role="img"
      aria-label={`Likely range ${fmtRangePct(low)} to ${fmtRangePct(high)}, projected ${fmtPct(value, 2, true)}`}
    >
      {/* track */}
      <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
      {neg && (
        <span
          aria-hidden
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded-l-[3px] bg-loss/25"
          style={{ left: `${neg.left}%`, width: `${neg.width}%`, borderTopRightRadius: pos ? 0 : 3, borderBottomRightRadius: pos ? 0 : 3 }}
        />
      )}
      {pos && (
        <span
          aria-hidden
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded-r-[3px] bg-gain/25"
          style={{ left: `${pos.left}%`, width: `${pos.width}%`, borderTopLeftRadius: neg ? 0 : 3, borderBottomLeftRadius: neg ? 0 : 3 }}
        />
      )}
      {/* zero */}
      <span aria-hidden className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${z}%` }} />
      {/* projection */}
      <span
        aria-hidden
        className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card"
        style={{ left: `${x(value)}%` }}
      />
    </div>
  );
}

/** Hero number: projected move after costs, with the likely range. */
export function ProjectedMove({
  value,
  low,
  high,
  sub,
  size = "lg",
}: {
  value: number;
  low: number | null;
  high: number | null;
  sub?: React.ReactNode;
  size?: "lg" | "md";
}) {
  const hasRange = low !== null && high !== null && high - low > 1e-6;
  return (
    <div className="grid content-start gap-1.5">
      <div className="flex items-center gap-1">
        <Eyebrow>Projected move</Eyebrow>
        <InfoPopover label="About the projected move" title="Projected move">
          What following this plan is expected to return from entry to exit, after costs. It starts from
          the setup's and the stock's history, is adjusted for today's factors, and is scaled by the
          weekly review. The likely range is the middle half of past outcomes for this setup.
        </InfoPopover>
      </div>
      <div
        className={cn(
          "proportional font-semibold leading-none tracking-tight",
          size === "lg" ? "text-[2rem]" : "text-2xl",
          value > 0 ? "text-gain" : value < 0 ? "text-loss" : "",
        )}
      >
        {fmtPct(value, 2, true)}
      </div>
      {hasRange ? (
        <div className="mt-1 grid gap-1">
          <RangeBar low={low} high={high} value={value} />
          <div className="num flex flex-wrap items-baseline justify-between gap-x-2 text-2xs text-muted-foreground">
            <span>Likely range</span>
            <span className="whitespace-nowrap font-medium text-foreground">
              {fmtRangePct(low)} to {fmtRangePct(high)}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-2xs text-muted-foreground">No likely range recorded for this pick.</p>
      )}
      {sub && <div className="num text-2xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Hero number: calibrated chance that the plan ends positive. */
export function CertaintyFigure({
  value,
  raw,
  historical = false,
  size = "lg",
}: {
  /** 0–100. */
  value: number;
  raw?: number | null;
  /** Older picks have no certainty; their historical win rate is shown instead. */
  historical?: boolean;
  size?: "lg" | "md";
}) {
  const shownRaw = raw != null && Math.abs(raw - value) >= 0.5 ? raw : null;
  return (
    <div className="grid content-start gap-1.5">
      <div className="flex items-center gap-1">
        <Eyebrow>{historical ? "Historical win rate" : "Certainty"}</Eyebrow>
        <InfoPopover label="About certainty" title={historical ? "Historical win rate" : "Certainty"} align="end">
          {historical
            ? "This pick predates the certainty model; this is the share of past occurrences that ended positive."
            : "The probability that following this plan ends with a gain, from the setup's model and this stock's own win rate, then checked against live results by the weekly review. 50% is a coin flip."}
        </InfoPopover>
      </div>
      <div className={cn("proportional font-semibold leading-none tracking-tight", size === "lg" ? "text-[2rem]" : "text-2xl")}>
        {Math.round(value)}%
      </div>
      <div className="mt-1 grid gap-1">
        <div className="flex h-4 items-center">
          <WinRateBar rate={value / 100} label={`${historical ? "Historical win rate" : "Certainty"} ${Math.round(value)}%`} />
        </div>
        <div className="flex items-baseline justify-between gap-2 text-2xs text-muted-foreground">
          <span>{historical ? "of past occurrences ended positive" : "chance this plan ends positive"}</span>
        </div>
      </div>
      {shownRaw !== null && (
        <div className="num text-2xs text-muted-foreground">
          {Math.round(shownRaw)}% before the weekly calibration
        </div>
      )}
    </div>
  );
}
