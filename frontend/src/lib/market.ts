/**
 * Approximate US equity market status from the browser clock in America/New_York.
 * Weekdays 09:30–16:00 are "open", 04:00–09:30 "pre-open"; everything else "closed".
 * Ignores exchange holidays and early closes — the worker uses the real calendar.
 */
export type MarketStatus = "open" | "pre-open" | "closed";

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function nyParts(now: number): { weekday: string; minutes: number; label: string } {
  const parts = fmt.formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const h = Number(get("hour"));
  const m = Number(get("minute"));
  return {
    weekday: get("weekday"),
    minutes: h * 60 + m,
    label: `${get("hour")}:${get("minute")} ET`,
  };
}

export function marketStatus(now: number): MarketStatus {
  const { weekday, minutes } = nyParts(now);
  if (weekday === "Sat" || weekday === "Sun") return "closed";
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "open";
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "pre-open";
  return "closed";
}
