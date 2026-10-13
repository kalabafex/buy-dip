import { Activity } from "lucide-react";
import type { Schemas } from "@/api/client";
import { StatCard } from "@/components/dashboard/StatCard";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { workerHealth } from "@/lib/health";
import { useNow } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const LABEL = { ok: "Running", stale: "Stale", down: "Unreachable", unknown: "—" } as const;
const TONE = {
  ok: "bg-gain",
  stale: "bg-warning",
  down: "bg-loss",
  unknown: "bg-muted-foreground/50",
} as const;

export function HeartbeatCard({
  health,
  error,
  intervalMinutes,
  className,
}: {
  health: Schemas["HealthOut"] | undefined;
  error: unknown;
  intervalMinutes: number | undefined;
  className?: string;
}) {
  const now = useNow(15_000);
  const w = workerHealth(health, error, intervalMinutes, now);
  return (
    <StatCard
      className={className}
      title="Worker"
      icon={Activity}
      loading={!health && !error}
      value={
        <span className="flex items-center gap-2">
          <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", TONE[w.state])} />
          {LABEL[w.state]}
        </span>
      }
      valueClassName={w.state === "down" ? "text-loss" : w.state === "stale" ? "text-warning" : undefined}
      sub={
        <span title={health?.last_heartbeat_at ? fmtDateTime(health.last_heartbeat_at) : undefined}>
          {health
            ? `Ticked ${fmtRelative(health.last_tick_at, now)} · market heartbeat ${fmtRelative(health.last_heartbeat_at, now)}`
            : w.text}
        </span>
      }
    />
  );
}
