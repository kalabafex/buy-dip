import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { Eyebrow } from "@/components/picks/parts";
import { fmtPct, fmtPts } from "@/lib/format";
import { fmtFeatureValue, isDeltaReason, reasonMeta, type Contribution, type Reason } from "@/lib/engine";
import { num, type Pick } from "@/lib/picks";
import { cn } from "@/lib/utils";

/** Tiny diverging bar for a factor's impact, scaled to the largest factor of the list. */
function ImpactBar({ value, max }: { value: number; max: number }) {
  const w = max > 0 ? Math.min(50, (Math.abs(value) / max) * 50) : 0;
  return (
    <span aria-hidden className="relative hidden h-2 w-16 shrink-0 sm:inline-block">
      <span className="absolute inset-y-[-2px] left-1/2 w-px bg-foreground/30" />
      <span
        className={cn("absolute top-0 h-2", value >= 0 ? "rounded-r-[3px] bg-gain" : "rounded-l-[3px] bg-loss")}
        style={value >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
      />
    </span>
  );
}

/** Saved reasons in order, with an icon per kind; factors carry their impact in points. */
export function ReasonsList({ reasons, compact = false }: { reasons: Reason[]; compact?: boolean }) {
  if (!reasons.length) {
    return <p className="text-xs text-muted-foreground">No explanation was saved for this pick (it predates the engine).</p>;
  }
  const maxFactor = Math.max(0, ...reasons.filter((r) => r.kind === "factor").map((r) => Math.abs(r.impact_pct ?? 0)));
  return (
    <ol className={cn("grid", compact ? "gap-1.5" : "gap-2.5")}>
      {reasons.map((r, i) => {
        const m = reasonMeta(r.kind);
        const impact = r.impact_pct;
        const delta = isDeltaReason(r);
        return (
          <li key={i} className="flex items-start gap-2.5">
            <span
              className={cn(
                "mt-px flex shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground",
                compact ? "h-5 w-5" : "h-6 w-6",
                r.kind === "projection" && "border-primary/40 text-primary",
                r.kind === "engine" && "border-warning/40 text-warning",
              )}
              title={m.label}
            >
              <m.icon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <span className="sr-only">{m.label}: </span>
              <span className={cn("leading-5", compact ? "text-xs" : "text-[0.8125rem]")}>{r.text}</span>
            </div>
            {impact != null && (
              <span className="mt-0.5 flex shrink-0 items-center gap-2">
                {r.kind === "factor" && !compact && <ImpactBar value={impact} max={maxFactor} />}
                <span
                  className={cn(
                    "num w-[4.75rem] text-right text-2xs font-medium",
                    delta ? (impact > 0 ? "text-gain" : impact < 0 ? "text-loss" : "") : "text-muted-foreground",
                  )}
                >
                  {delta ? fmtPts(impact, 2) : fmtPct(impact, 2, true)}
                </span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

type Step = { label: string; detail?: string; from: number; to: number; total?: boolean };

const MIN_STEP = 0.005; // pts; smaller steps fold into "other factors"

function buildSteps(pick: Pick): Step[] | null {
  const base = num(pick.base_return_pct);
  const projected = num(pick.projected_move_pct);
  if (base === null || projected === null) return null;
  const adj = num(pick.model_adjustment_pct) ?? 0;
  const mult = num(pick.multiplier) ?? 1;
  const steps: Step[] = [{ label: "History-based start", from: 0, to: base, total: true }];
  let run = base;
  const contribs = [...pick.contributions].sort((a, b) => Math.abs(b.impact_pct) - Math.abs(a.impact_pct));
  const shown: Contribution[] = contribs.filter((c) => Math.abs(c.impact_pct) >= MIN_STEP).slice(0, 5);
  const rest = contribs.filter((c) => !shown.includes(c));
  for (const c of shown) {
    steps.push({ label: c.label, detail: fmtFeatureValue(c.feature, c.value), from: run, to: run + c.impact_pct });
    run += c.impact_pct;
  }
  const restSum = rest.reduce((a, c) => a + c.impact_pct, 0);
  if (Math.abs(restSum) >= MIN_STEP) {
    steps.push({ label: `Other factors (${rest.length})`, from: run, to: run + restSum });
    run += restSum;
  }
  // Model intercept, or the whole adjustment when no per-factor breakdown was saved.
  const residual = base + adj - run;
  if (Math.abs(residual) >= MIN_STEP) {
    steps.push({ label: contribs.length ? "Model baseline" : "Feature adjustment", from: run, to: run + residual });
    run += residual;
  }
  const scale = projected - run;
  if (Math.abs(scale) >= MIN_STEP || Math.abs(mult - 1) > 1e-6) {
    steps.push({ label: "Weekly review scaling", detail: `×${mult.toFixed(2)}`, from: run, to: projected });
  }
  steps.push({ label: "Projected move", from: 0, to: projected, total: true });
  return steps;
}

/** base → factors → weekly scaling → projected, as a horizontal waterfall around zero. */
export function ProjectionWaterfall({ pick }: { pick: Pick }) {
  const steps = buildSteps(pick);
  if (!steps) return null;
  const vals = steps.flatMap((s) => [s.from, s.to]);
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  const pad = (hi - lo || 1) * 0.06;
  lo -= pad;
  hi += pad;
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const z = x(0);
  return (
    <figure className="grid gap-2" aria-label="How the projection adds up">
      <ol className="grid gap-2">
        {steps.map((s, i) => {
          const d = s.to - s.from;
          const left = x(Math.min(s.from, s.to));
          const width = Math.max(0.6, Math.abs(x(s.to) - x(s.from)));
          const last = i === steps.length - 1;
          return (
            <li key={i} className={cn("grid gap-1", last && "mt-1 border-t pt-2")}>
              <div className="flex items-baseline justify-between gap-3">
                <span className={cn("min-w-0 text-xs leading-4", s.total ? "font-medium" : "text-muted-foreground")}>
                  {s.label}
                  {s.detail && <span className="num text-muted-foreground"> · {s.detail}</span>}
                </span>
                <span
                  className={cn(
                    "num shrink-0 text-2xs",
                    s.total ? "font-semibold text-foreground" : d > 0 ? "text-gain" : d < 0 ? "text-loss" : "text-muted-foreground",
                  )}
                >
                  {s.total ? fmtPct(s.to, 2, true) : fmtPts(d, 2)}
                </span>
              </div>
              <span className="relative h-2" aria-hidden>
                <span className="absolute inset-y-[-3px] w-px bg-foreground/25" style={{ left: `${z}%` }} />
                <span
                  className={cn(
                    "absolute inset-y-0 rounded-[3px]",
                    s.total ? "bg-primary" : d >= 0 ? "bg-gain/80" : "bg-loss/80",
                  )}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              </span>
            </li>
          );
        })}
      </ol>
      <figcaption className="text-2xs leading-4 text-muted-foreground">
        Blue bars are levels; green and red steps raise or lower the projection, in percentage points.
      </figcaption>
    </figure>
  );
}

/** Collapsible "Why this pick" section (open on desktop, collapsed on phones by default). */
export function WhyThisPick({ pick }: { pick: Pick }) {
  const [open, setOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
  const id = useId();
  const hasWaterfall = num(pick.base_return_pct) !== null;
  return (
    <div className="border-t">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
      >
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-tight">Why this pick</span>
          {pick.reasons.length > 0 && (
            <span className="text-2xs text-muted-foreground">{pick.reasons.length} saved reasons</span>
          )}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div
          id={id}
          className={cn(
            "grid gap-5 px-4 pb-4 sm:px-5 sm:pb-5",
            hasWaterfall && "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-8",
          )}
        >
          <ReasonsList reasons={pick.reasons} />
          {hasWaterfall && (
            <div className="grid content-start gap-2 border-t pt-4 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <Eyebrow>How the projection adds up</Eyebrow>
              <ProjectionWaterfall pick={pick} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
