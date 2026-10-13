import type { Schemas } from "@/api/client";
import { Meter } from "@/components/ui/meter";
import { fmtPct, fmtPrice, tierLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * How close the price is to triggering the next tier: the meter fills as the pullback
 * approaches that tier's drop (from GET /api/rules: next_tier, distance_to_next_tier_pct).
 */
export function DistanceToTier({ rule, className }: { rule: Schemas["RuleOut"]; className?: string }) {
  if (rule.next_tier == null || rule.distance_to_next_tier_pct == null) {
    const allFilled = (rule.tiers_filled?.length ?? 0) >= rule.tiers.length;
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        {allFilled ? "All tiers filled" : "No price yet"}
      </span>
    );
  }
  const tier = rule.tiers[rule.next_tier];
  const drop = tier ? Number(tier.drop_pct) : 0;
  const raw = Number(rule.distance_to_next_tier_pct);
  const dist = Math.max(0, raw);
  const progress = drop > 0 ? Math.max(0, Math.min(drop, drop - dist)) : 0;
  return (
    <div className={cn("grid min-w-[8rem] gap-1", className)}>
      <div className="flex items-baseline justify-between gap-2 whitespace-nowrap text-xs">
        <span className={raw <= 0 ? "num font-medium text-warning" : "num font-medium"}>
          {raw <= 0 ? "At trigger" : `${fmtPct(dist, 1)} away`}
        </span>
        <span className="num truncate text-2xs text-muted-foreground">
          {tierLabel(rule.next_tier)} @ {fmtPrice(rule.next_tier_price)}
        </span>
      </div>
      <Meter
        value={progress}
        max={drop || 1}
        tone="neutral"
        label={`${fmtPct(dist, 1)} to ${tierLabel(rule.next_tier)} trigger`}
      />
    </div>
  );
}
