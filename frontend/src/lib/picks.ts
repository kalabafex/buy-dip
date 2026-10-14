/**
 * Daily-picks helpers: New York dates/times, the day's phase, status and exit-reason labels.
 * Session times come from the API (exchange calendar, early closes included); the browser
 * clock only places the "now" marker.
 */
import type { Schemas } from "@/api/client";
import type { BadgeVariant } from "@/components/ui/badge";
import { marketStatus, nyParts } from "@/lib/market";

export type Pick = Schemas["PickOut"];
export type PicksDay = Schemas["PicksDayOut"];

const NY = "America/New_York";

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: NY,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: NY,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Today's date in New York as YYYY-MM-DD. */
export function nyDate(now: number): string {
  return dateFmt.format(new Date(now));
}

/** "09:35" in New York time (no suffix). */
export function fmtEt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : timeFmt.format(d);
}

const weekdayFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const weekdayShortFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** "2026-10-14" -> "Wed, Oct 14, 2026" (plain date, no timezone shift). */
export function fmtSessionDate(d: string, opts: { year?: boolean } = {}): string {
  const t = new Date(`${d.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(t.getTime())) return d;
  return (opts.year === false ? weekdayShortFmt : weekdayFmt).format(t);
}

/** "1h 05m" / "12m" / "45s". */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/**
 * Rough window in which picks data changes (weekdays 08:30–16:45 ET), for polling only.
 * Ignores holidays; the SSE stream covers the precise moments.
 */
export function inPicksWindow(now: number): boolean {
  const { weekday, minutes } = nyParts(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return marketStatus(now) === "open" || (minutes >= 8 * 60 + 30 && minutes < 16 * 60 + 45);
}

export type Phase = "closed-day" | "pre-open" | "pending" | "trading" | "exiting" | "closed" | "evaluated";

export const PHASE_LABEL: Record<Phase, string> = {
  "closed-day": "Market closed",
  "pre-open": "Pre-open",
  pending: "Picks pending",
  trading: "Trading",
  exiting: "Exiting",
  closed: "Closed",
  evaluated: "Evaluated",
};

const MIN = 60_000;
/** The worker stops publishing new picks this long before the forced exit. */
const PUBLISH_CUTOFF_MS = 30 * MIN;

export function sessionTimes(day: PicksDay) {
  if (!day.entry_time || !day.exit_time) return null;
  const entry = new Date(day.entry_time).getTime();
  const exit = new Date(day.exit_time).getTime();
  // Entry is open + 5 min and the forced exit is close − 5 min (see backend select.py).
  return { open: entry - 5 * MIN, entry, exit, close: exit + 5 * MIN };
}

export function isEvaluated(day: PicksDay): boolean {
  return day.picks.length > 0 && day.picks.every((p) => p.plan_return_pct != null);
}

/** Where the day stands. Past days are closed/evaluated; future days pre-open. */
export function dayPhase(day: PicksDay, now: number): Phase {
  const t = sessionTimes(day);
  if (!day.is_trading_day || !t) return "closed-day";
  if (isEvaluated(day)) return "evaluated";
  if (now < t.open) return "pre-open";
  if (now < t.entry) return "pending";
  if (!day.generated && now < t.exit - PUBLISH_CUTOFF_MS) return "pending";
  if (now < t.exit) return "trading";
  if (now < t.close) return "exiting";
  return "closed";
}

export function publishCutoff(day: PicksDay): number | null {
  const t = sessionTimes(day);
  return t ? t.exit - PUBLISH_CUTOFF_MS : null;
}

type StatusMeta = { label: string; variant: BadgeVariant; help: string; live?: boolean };

export const STATUS: Record<string, StatusMeta> = {
  PLANNED: { label: "Planned", variant: "secondary", help: "Tradeable; waiting for the entry (or auto-trade is off)" },
  WATCH: { label: "Watch only", variant: "outline", help: "Shown for information; never traded" },
  SUBMITTING: { label: "Submitting", variant: "info", help: "Sending the bracket order", live: true },
  SUBMITTED: { label: "Order placed", variant: "info", help: "Limit buy is working at the broker", live: true },
  ENTERED: { label: "In position", variant: "success", help: "Bought; target/stop legs are working", live: true },
  EXITING: { label: "Exiting", variant: "warning", help: "Selling at market before the close", live: true },
  EXITED: { label: "Exited", variant: "secondary", help: "Bought and sold" },
  NOT_FILLED: { label: "Not filled", variant: "outline", help: "The limit buy never filled; nothing was bought" },
  NOT_TRADED: { label: "Not traded", variant: "outline", help: "No order was placed" },
  FAILED: { label: "Failed", variant: "danger", help: "The order could not be placed" },
};

export function statusMeta(s: string): StatusMeta {
  return STATUS[s] ?? { label: s, variant: "outline", help: s };
}

export const EXIT_REASON: Record<string, string> = {
  TARGET: "target hit",
  STOP: "stop hit",
  TIME: "sold at the exit time",
};

/** Plan outcomes read slightly differently (it is a simulation, not a fill). */
export const PLAN_EXIT_REASON: Record<string, string> = {
  TARGET: "target reached",
  STOP: "stop reached",
  TIME: "held to the close",
};

export function exitReasonText(r: string | null | undefined, plan = false): string {
  if (!r) return "";
  return (plan ? PLAN_EXIT_REASON : EXIT_REASON)[r] ?? r.toLowerCase();
}

export const ENTRY_BUFFER_PCT = 0.3;

/** Number or null from an API decimal string. */
export function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function featureNum(p: Pick, key: string): number | null {
  const v = (p.features as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Calibration exit choice: "Target 0.5×ATR · stop 1×ATR" / "Hold to the close". */
export function exitChoice(target: number | null | undefined, stop: number | null | undefined): string {
  const parts = [
    target ? `target ${target}×ATR` : "no target",
    stop ? `stop ${stop}×ATR` : "no stop",
  ];
  if (!target && !stop) return "No target or stop — hold to the exit";
  const s = parts.join(" · ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
