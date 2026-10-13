import { cn } from "@/lib/utils";

/**
 * Value against a limit. The fill carries severity (primary → warning at 80% → loss at 100%);
 * the track is a light step of the same hue so state reads across the whole bar.
 */
export function Meter({
  value,
  max,
  label,
  className,
  tone = "auto",
}: {
  value: number;
  max: number;
  label: string;
  className?: string;
  /** "auto" grades by fill; "neutral" always uses the primary hue. */
  tone?: "auto" | "neutral";
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : value > 0 ? 100 : 0;
  const level = tone === "neutral" ? "ok" : pct >= 100 ? "full" : pct >= 80 ? "high" : "ok";
  const fill = { ok: "bg-primary", high: "bg-warning", full: "bg-loss" }[level];
  const track = { ok: "bg-primary/15", high: "bg-warning/20", full: "bg-loss/20" }[level];
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full", track, className)}
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value * 100) / 100}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", fill)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
