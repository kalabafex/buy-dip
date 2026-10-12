import type { Schemas } from "@/api/client";
import { StatCard } from "@/components/dashboard/StatCard";
import { ageMs, fmtDateTime, fmtRelative } from "@/lib/format";
import { useNow } from "@/lib/hooks";

/** Worker heartbeat age above this is flagged (spec: ~2× the evaluation interval). */
const STALE_MS = 15 * 60_000;

export function HeartbeatCard({
  health,
  error,
  className,
}: {
  health: Schemas["HealthOut"] | undefined;
  error: unknown;
  className?: string;
}) {
  const now = useNow(15_000);
  const age = ageMs(health?.last_heartbeat_at, now);
  const stale = age === null || age > STALE_MS;
  const degraded = !!error || health?.status === "degraded";
  const warn = degraded || (health !== undefined && stale);

  return (
    <StatCard
      className={className}
      title="Worker heartbeat"
      value={
        error ? "API unreachable" : health ? fmtRelative(health.last_heartbeat_at, now) : "—"
      }
      valueClassName={warn ? "text-amber-600 dark:text-amber-400" : undefined}
      sub={
        health
          ? `${degraded ? "Degraded (DB down) · " : ""}last tick ${fmtRelative(health.last_tick_at, now)}`
          : undefined
      }
    >
      {health?.last_heartbeat_at && (
        <span className="sr-only">{fmtDateTime(health.last_heartbeat_at)}</span>
      )}
    </StatCard>
  );
}
