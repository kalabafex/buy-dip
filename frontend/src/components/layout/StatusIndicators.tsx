import { useHealth, useSettings } from "@/api/queries";
import type { StreamState } from "@/api/useEventStream";
import { workerHealth, type WorkerHealth } from "@/lib/health";
import { useNow } from "@/lib/hooks";
import { marketStatus, nyParts, type MarketStatus } from "@/lib/market";
import { cn } from "@/lib/utils";

const MARKET: Record<MarketStatus, { label: string; dot: string; text: string }> = {
  open: { label: "Market open", dot: "bg-gain", text: "text-foreground" },
  "pre-open": { label: "Pre-open", dot: "bg-warning", text: "text-foreground" },
  closed: { label: "Market closed", dot: "bg-muted-foreground/60", text: "text-muted-foreground" },
};

/** Approximate NYSE status from the browser clock (ignores holidays and early closes). */
export function MarketStatusPill({ className }: { className?: string }) {
  const now = useNow(30_000);
  const status = marketStatus(now);
  const m = MARKET[status];
  const { label: time } = nyParts(now);
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border bg-card px-2.5 text-xs font-medium",
        m.text,
        className,
      )}
      title={`${m.label} (approximate: ${time}, weekdays 9:30–16:00 ET; ignores holidays and early closes)`}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      <span className="sm:hidden">
        {status === "open" ? "Open" : status === "pre-open" ? "Pre" : "Closed"}
      </span>
      <span className="hidden sm:inline">{m.label}</span>
      <span className="hidden text-muted-foreground lg:inline">· {time} · approx.</span>
    </span>
  );
}

const DOT: Record<WorkerHealth, string> = {
  ok: "bg-gain",
  stale: "bg-warning",
  down: "bg-loss",
  unknown: "bg-muted-foreground/50",
};

export function HeartbeatDot({ stream }: { stream: StreamState }) {
  const health = useHealth();
  const settings = useSettings();
  const now = useNow(15_000);
  const w = workerHealth(health.data, health.error, settings.data?.evaluation_interval_minutes, now);
  const streamText =
    stream === "open"
      ? "live updates connected"
      : stream === "connecting"
        ? "connecting live updates…"
        : "live updates disconnected, retrying";
  const label = `${w.text}; ${streamText}`;
  return (
    <span
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border bg-card px-2.5 text-xs font-medium text-muted-foreground"
      title={label}
      role="status"
      aria-label={label}
    >
      <span className="relative flex h-2 w-2" aria-hidden>
        {w.state === "ok" && stream === "open" && (
          <span
            className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-50", DOT.ok)}
          />
        )}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", DOT[w.state])} />
      </span>
      <span className="hidden md:inline">Worker</span>
      {stream !== "open" && <span className="hidden text-warning md:inline">· offline</span>}
    </span>
  );
}
