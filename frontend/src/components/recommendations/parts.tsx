import { CircleDot, ShieldCheck, ShieldQuestion, TriangleAlert } from "lucide-react";
import type { Schemas } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { fmtDay, fmtNum, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

export type RecItem = Schemas["RecommendationItem"];

const CONFIDENCE = {
  strong: {
    variant: "success",
    icon: ShieldCheck,
    label: "Strong",
    help: "Beat DCA in ≥80% of windows in both halves with a median edge ≥ 2 pts",
  },
  moderate: {
    variant: "info",
    icon: ShieldQuestion,
    label: "Moderate",
    help: "Beat DCA in ≥60% of windows in both halves with a positive median edge",
  },
  weak: {
    variant: "warning",
    icon: TriangleAlert,
    label: "Weak",
    help: "Inconsistent: lost to DCA too often, or rarely bought",
  },
} as const;

export function ConfidenceBadge({ confidence }: { confidence: RecItem["confidence"] }) {
  const c = CONFIDENCE[confidence];
  return (
    <Badge variant={c.variant} title={c.help}>
      <c.icon className="h-3 w-3" aria-hidden />
      {c.label} confidence
    </Badge>
  );
}

/** Would this rule's condition be met at the latest close? */
export function TriggeringNow({ current }: { current: RecItem["current"] }) {
  if (current.condition_met == null) return null;
  const detail = [
    current.pullback_pct != null ? `${fmtPct(current.pullback_pct, 1)} below high` : null,
    current.rsi14 != null ? `RSI ${fmtNum(current.rsi14, 0)}` : null,
    current.as_of ? `as of ${fmtDay(current.as_of)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return current.condition_met ? (
    <Badge variant="warning" title={`Condition met at the latest close (${detail})`}>
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      Triggering now
    </Badge>
  ) : (
    <Badge variant="outline" title={`Condition not met at the latest close (${detail})`}>
      <CircleDot className="h-3 w-3" aria-hidden />
      Not triggering
    </Badge>
  );
}

/** Beat-DCA rate in selection vs validation windows as two small bars on a 0–100% scale. */
export function WinRateBars({
  selection,
  validation,
  splitDate,
}: {
  selection: RecItem["selection"];
  validation: RecItem["validation"];
  splitDate: string | null;
}) {
  const rows = [
    {
      key: "Selection",
      sub: splitDate ? `before ${fmtDay(splitDate)}` : "earlier windows",
      h: selection,
      accent: false,
    },
    {
      key: "Validation",
      sub: splitDate ? `after ${fmtDay(splitDate)}` : "later windows",
      h: validation,
      accent: true,
    },
  ];
  return (
    <div className="grid gap-2.5">
      {rows.map(({ key, sub, h, accent }) => (
        <div key={key} className="grid gap-1">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">{key}</span> · {sub}
            </span>
            <span className="num font-semibold">{Math.round(h.win_rate * 100)}%</span>
          </div>
          <div
            className="relative h-2 w-full rounded-full bg-muted"
            role="meter"
            aria-label={`${key}: beat DCA in ${Math.round(h.win_rate * 100)}% of ${h.windows_with_buys} windows with buys`}
            aria-valuenow={Math.round(h.win_rate * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={cn("h-full rounded-full", accent ? "bg-primary" : "bg-primary/45")}
              style={{ width: `${Math.max(1, h.win_rate * 100)}%` }}
            />
            {/* 50% reference tick: a coin flip */}
            <span aria-hidden className="absolute inset-y-[-2px] left-1/2 w-px bg-foreground/25" />
          </div>
          <div className="num text-2xs text-muted-foreground">
            {h.windows_with_buys} of {h.windows} windows had buys
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatBlock({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)} title={hint}>
      <div className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="num mt-0.5 text-base font-semibold tracking-tight">{value}</div>
    </div>
  );
}
