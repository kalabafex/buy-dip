import type { Schemas } from "@/api/client";
import { ageMs, fmtRelative } from "@/lib/format";

export type WorkerHealth = "ok" | "stale" | "down" | "unknown";

/** Worker liveness from /api/health: the loop ticks every evaluation interval, day and night. */
export function workerHealth(
  health: Schemas["HealthOut"] | undefined,
  error: unknown,
  intervalMinutes: number | undefined,
  now: number,
): { state: WorkerHealth; text: string } {
  if (error) return { state: "down", text: "API unreachable" };
  if (!health) return { state: "unknown", text: "Checking worker…" };
  if (health.status === "degraded") return { state: "down", text: "Degraded: database unavailable" };
  const age = ageMs(health.last_tick_at, now);
  const staleMs = Math.max(15, (intervalMinutes ?? 5) * 2.5) * 60_000;
  if (age === null) return { state: "stale", text: "Worker has not ticked yet" };
  if (age > staleMs)
    return { state: "stale", text: `Worker last ticked ${fmtRelative(health.last_tick_at, now)}` };
  return { state: "ok", text: `Worker alive · ticked ${fmtRelative(health.last_tick_at, now)}` };
}
