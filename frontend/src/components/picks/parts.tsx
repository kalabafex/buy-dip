import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { statusMeta } from "@/lib/picks";
import { cn } from "@/lib/utils";

const SHORT_REASON: Record<string, string> = { TARGET: "target", STOP: "stop", TIME: "time" };

/** Live status of one pick: label + icon/dot, never color alone. */
export function PickStatusBadge({
  status,
  exitReason,
  className,
}: {
  status: string;
  exitReason?: string | null;
  className?: string;
}) {
  const m = statusMeta(status);
  const short = exitReason ? SHORT_REASON[exitReason] : undefined;
  return (
    <Badge variant={m.variant} title={m.help} className={className}>
      {status === "SUBMITTING" || status === "EXITING" ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      ) : m.live ? (
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      ) : (
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {m.label}
      {status === "EXITED" && short ? ` · ${short}` : ""}
    </Badge>
  );
}

/** Small uppercase section label used inside pick cards. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("text-2xs font-medium uppercase tracking-wider text-muted-foreground", className)}>
      {children}
    </div>
  );
}

/** Win rate on a 0–100% track with a 50% (coin flip) reference tick. */
export function WinRateBar({ rate, label }: { rate: number; label: string }) {
  const pct = Math.round(rate * 100);
  return (
    <div
      className="relative h-1.5 w-full rounded-full bg-primary/15"
      role="meter"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(1, pct)}%` }} />
      <span aria-hidden className="absolute inset-y-[-2px] left-1/2 w-px bg-foreground/30" />
    </div>
  );
}
