import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { fmtEt, PHASE_LABEL, sessionTimes, type Phase, type PicksDay } from "@/lib/picks";

const PHASE_VARIANT: Record<Phase, BadgeVariant> = {
  "closed-day": "outline",
  "pre-open": "warning",
  pending: "info",
  trading: "success",
  exiting: "warning",
  closed: "outline",
  evaluated: "secondary",
};

export function PhaseBadge({ phase }: { phase: Phase }) {
  const live = phase === "trading" || phase === "pending" || phase === "exiting";
  return (
    <Badge variant={PHASE_VARIANT[phase]}>
      {live ? (
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      ) : (
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {PHASE_LABEL[phase]}
    </Badge>
  );
}

const MIN = 60_000;

/**
 * The session as a strip: open → picks (entry) → forced exit → close, with the elapsed part
 * filled and a "now" marker while viewing today. Half days simply have an earlier exit/close.
 */
export function Timeline({
  day,
  phase,
  now,
  isToday,
}: {
  day: PicksDay;
  phase: Phase;
  now: number;
  isToday: boolean;
}) {
  const t = sessionTimes(day);
  if (!t) return null;
  const start = t.open - 30 * MIN;
  const end = t.close + 30 * MIN;
  const x = (v: number) => Math.min(100, Math.max(0, ((v - start) / (end - start)) * 100));
  const nowIn = isToday && now >= start && now <= end;
  const elapsedTo = isToday ? Math.min(Math.max(now, t.open), t.close) : t.close;
  const showElapsed = !isToday || now > t.open;
  const entry = fmtEt(day.entry_time);
  const exit = fmtEt(day.exit_time);
  const open = fmtEt(new Date(t.open).toISOString());
  const close = fmtEt(new Date(t.close).toISOString());
  const nowLabel = fmtEt(new Date(now).toISOString());
  const early = close !== "16:00";

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="num text-sm">
          <span className="text-muted-foreground">Picks at </span>
          <span className="font-semibold">{entry}</span>
          <span className="text-muted-foreground"> · Exit by </span>
          <span className="font-semibold">{exit} ET</span>
          {early && <span className="ml-2 text-2xs font-medium text-warning">Early close</span>}
        </div>
        <div className="flex items-center gap-2">
          {isToday && <span className="num text-2xs text-muted-foreground">Now {nowLabel} ET</span>}
          <PhaseBadge phase={phase} />
        </div>
      </div>
      <div
        className="relative h-7"
        role="img"
        aria-label={`Session ${open} to ${close} ET; picks at ${entry}, exit by ${exit}${nowIn ? `; now ${nowLabel}` : ""}`}
      >
        {/* full range track */}
        <span aria-hidden className="absolute inset-x-0 top-3 h-1 rounded-full bg-muted" />
        {/* session */}
        <span
          aria-hidden
          className="absolute top-3 h-1 rounded-full bg-primary/25 dark:bg-primary/35"
          style={{ left: `${x(t.open)}%`, width: `${x(t.close) - x(t.open)}%` }}
        />
        {/* elapsed */}
        {showElapsed && (
          <span
            aria-hidden
            className="absolute top-3 h-1 rounded-full bg-primary"
            style={{ left: `${x(t.open)}%`, width: `${x(elapsedTo) - x(t.open)}%` }}
          />
        )}
        {[t.entry, t.exit].map((v) => (
          <span
            key={v}
            aria-hidden
            className="absolute top-1.5 h-4 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70"
            style={{ left: `${x(v)}%` }}
          />
        ))}
        {nowIn && (
          <span
            aria-hidden
            className="absolute top-0 flex h-7 -translate-x-1/2 flex-col items-center"
            style={{ left: `${x(now)}%` }}
          >
            <span className="h-2.5 w-2.5 rounded-full border-2 border-card bg-foreground shadow" />
            <span className="h-4 w-px bg-foreground" />
          </span>
        )}
      </div>
      <div className="num -mt-1 flex justify-between gap-3 text-2xs text-muted-foreground">
        <span>
          Open {open} · <span className="font-medium text-foreground">Picks {entry}</span>
        </span>
        <span className="text-right">
          <span className="font-medium text-foreground">Exit {exit}</span> · Close {close}
        </span>
      </div>
    </div>
  );
}
