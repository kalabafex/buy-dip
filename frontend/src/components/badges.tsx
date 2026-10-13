import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import type { Schemas } from "@/api/client";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

/** PAPER (green) / LIVE (solid red, pulsing dot): never ambiguous. */
export function ModeBadge({
  mode,
  size = "sm",
  className,
}: {
  mode: Schemas["TradingMode"] | undefined;
  size?: "sm" | "lg";
  className?: string;
}) {
  if (!mode) return null;
  const live = mode === "LIVE";
  return (
    <span
      title={live ? "LIVE trading: real orders with real money" : "Paper trading: simulated orders"}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-bold uppercase tracking-wider",
        size === "lg" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-2xs",
        live
          ? "bg-red-600 text-white shadow-[0_0_0_3px_rgb(220_38_38/0.25)]"
          : "border border-gain/30 bg-gain-soft text-gain",
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        {live && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80" />
        )}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      {mode}
    </span>
  );
}

function decisionVariant(d: Schemas["Decision"]): BadgeVariant {
  if (d === "ORDER") return "success";
  if (d === "NO_TRIGGER") return "secondary";
  if (d === "SKIP_KILL_SWITCH" || d === "SKIP_PRICE_SANITY" || d === "SKIP_MODE_MISMATCH") return "danger";
  if (d === "SKIP_MARKET_CLOSED" || d === "SKIP_EXCLUSION_WINDOW" || d === "SKIP_DRY_RUN") return "outline";
  return "warning";
}

function decisionLabel(d: Schemas["Decision"]): string {
  if (d === "ORDER") return "Order";
  if (d === "NO_TRIGGER") return "No trigger";
  return humanize(d.replace(/^SKIP_/, "skip_"));
}

export function DecisionBadge({ decision }: { decision: Schemas["Decision"] }) {
  return (
    <Badge variant={decisionVariant(decision)} title={decision}>
      {decisionLabel(decision)}
    </Badge>
  );
}

const ORDER_VARIANT: Record<Schemas["OrderStatus"], BadgeVariant> = {
  PENDING: "secondary",
  SUBMITTED: "info",
  PARTIALLY_FILLED: "info",
  FILLED: "success",
  CANCELED: "outline",
  EXPIRED: "outline",
  REJECTED: "danger",
  FAILED: "danger",
};

export function OrderStatusBadge({ status }: { status: Schemas["OrderStatus"] }) {
  return (
    <Badge variant={ORDER_VARIANT[status]} dot>
      {humanize(status)}
    </Badge>
  );
}

const JOB_VARIANT: Record<Schemas["BacktestStatus"], BadgeVariant> = {
  QUEUED: "secondary",
  RUNNING: "info",
  DONE: "success",
  FAILED: "danger",
};
const JOB_ICON = { QUEUED: CircleDashed, RUNNING: Loader2, DONE: CheckCircle2, FAILED: XCircle } as const;
const JOB_LABEL = { QUEUED: "Queued", RUNNING: "Running", DONE: "Done", FAILED: "Failed" } as const;

/** Status of a queued job (backtests and recommendation runs). */
export function JobStatusBadge({ status }: { status: Schemas["BacktestStatus"] }) {
  const Icon = JOB_ICON[status];
  return (
    <Badge variant={JOB_VARIANT[status]}>
      <Icon className={cn("h-3 w-3", status === "RUNNING" && "animate-spin")} aria-hidden />
      {JOB_LABEL[status]}
    </Badge>
  );
}

export function EnabledChip({ enabled }: { enabled: boolean }) {
  return (
    <Badge variant={enabled ? "success" : "outline"} dot>
      {enabled ? "Enabled" : "Disabled"}
    </Badge>
  );
}
