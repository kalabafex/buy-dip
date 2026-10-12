import type { Schemas } from "@/api/client";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { humanize } from "@/lib/format";

export function ModeBadge({ mode }: { mode: Schemas["TradingMode"] | undefined }) {
  if (!mode) return null;
  return (
    <Badge
      variant={mode === "LIVE" ? "danger" : "success"}
      className={mode === "LIVE" ? "ring-1 ring-red-500" : undefined}
      title={mode === "LIVE" ? "Live trading with real money" : "Paper trading"}
    >
      {mode}
    </Badge>
  );
}

function decisionVariant(d: Schemas["Decision"]): BadgeVariant {
  if (d === "ORDER") return "success";
  if (d === "NO_TRIGGER") return "secondary";
  if (d === "SKIP_KILL_SWITCH" || d === "SKIP_PRICE_SANITY" || d === "SKIP_MODE_MISMATCH")
    return "danger";
  if (d === "SKIP_MARKET_CLOSED" || d === "SKIP_EXCLUSION_WINDOW" || d === "SKIP_DRY_RUN")
    return "outline";
  return "warning";
}

export function DecisionBadge({ decision }: { decision: Schemas["Decision"] }) {
  return (
    <Badge variant={decisionVariant(decision)} title={decision}>
      {decision === "ORDER" ? "ORDER" : humanize(decision.replace(/^SKIP_/, "skip_"))}
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
  return <Badge variant={ORDER_VARIANT[status]}>{humanize(status)}</Badge>;
}

const BT_VARIANT: Record<Schemas["BacktestStatus"], BadgeVariant> = {
  QUEUED: "secondary",
  RUNNING: "info",
  DONE: "success",
  FAILED: "danger",
};

export function BacktestStatusBadge({ status }: { status: Schemas["BacktestStatus"] }) {
  return <Badge variant={BT_VARIANT[status]}>{status}</Badge>;
}
