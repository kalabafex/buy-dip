import { Check } from "lucide-react";
import { fmtUsdShort, tierLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

type TierLike = { drop_pct: string | number; amount_usd: string | number };

/**
 * Tier ladder: one column per tier, bar height ∝ buy amount, labeled with the drop that
 * triggers it. Single hue (it is one series); filled tiers get a check.
 */
export function TierLadder({
  tiers,
  filled = [],
  size = "md",
  className,
}: {
  tiers: TierLike[];
  filled?: number[];
  size?: "sm" | "md";
  className?: string;
}) {
  const max = Math.max(...tiers.map((t) => Number(t.amount_usd)), 1);
  const barH = size === "sm" ? 20 : 44;
  const label = tiers
    .map(
      (t, i) =>
        `${tierLabel(i)}: −${Number(t.drop_pct)}% buys ${fmtUsdShort(t.amount_usd)}${filled.includes(i) ? " (filled)" : ""}`,
    )
    .join("; ");
  return (
    <div
      role="img"
      aria-label={`Tier ladder. ${label}`}
      title={size === "sm" ? label : undefined}
      className={cn("flex items-end", size === "sm" ? "gap-0.5" : "gap-1.5", className)}
    >
      {tiers.map((t, i) => {
        const h = Math.max(3, Math.round((Number(t.amount_usd) / max) * barH));
        const isFilled = filled.includes(i);
        return (
          <div key={i} className={cn("flex flex-col items-center", size === "sm" ? "w-3" : "min-w-0 flex-1")}>
            {size === "md" && (
              <span className="num mb-1 text-2xs font-medium text-foreground">
                {fmtUsdShort(t.amount_usd)}
              </span>
            )}
            <div className="flex w-full items-end justify-center" style={{ height: barH }}>
              <div
                className={cn(
                  "w-full rounded-t-[4px]",
                  size === "md" && "max-w-[24px]",
                  isFilled ? "bg-gain" : "bg-primary",
                  !isFilled && i > 0 && "opacity-90",
                )}
                style={{ height: h }}
              />
            </div>
            {size === "md" && (
              <span className="num mt-1 flex items-center gap-0.5 text-2xs text-muted-foreground">
                {isFilled && <Check className="h-2.5 w-2.5 text-gain" aria-hidden />}−{Number(t.drop_pct)}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
