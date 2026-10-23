/** Display helpers. API decimals arrive as strings; Number() is used for display only. */

type Num = string | number | null | undefined;

function toNum(v: Num): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function fmtUsd(v: Num, opts: { compact?: boolean } = {}): string {
  const n = toNum(v);
  if (n === null) return "—";
  return opts.compact && Number.isInteger(n) ? usd0.format(n) : usd.format(n);
}

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** "$12.3K" for large values, full precision below $10,000. */
export function fmtUsdShort(v: Num): string {
  const n = toNum(v);
  if (n === null) return "—";
  return Math.abs(n) >= 10_000 ? usdCompact.format(n) : usd0.format(n);
}

/** "+$1,234" / "−$56". */
export function fmtUsdSigned(v: Num, opts: { short?: boolean } = {}): string {
  const n = toNum(v);
  if (n === null) return "—";
  const a = Math.abs(n);
  const body = opts.short ? fmtUsdShort(a) : a < 1000 ? usd.format(a) : usd0.format(a);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${body}`;
}

/** Percentage points: "+3.2 pts". */
export function fmtPts(v: Num, digits = 1): string {
  const n = toNum(v);
  if (n === null) return "—";
  const body = Math.abs(n).toFixed(digits);
  // No sign on a value that rounds to zero ("−0.00 pts" reads as a loss).
  const zero = Number(body) === 0;
  return `${zero ? "" : n > 0 ? "+" : "−"}${body} pts`;
}

/** Price with up to 4 decimals (sub-dollar prices). */
export function fmtPrice(v: Num): string {
  const n = toNum(v);
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(n) < 1 ? 4 : 2,
  });
}

/** `v` is already in percent units (e.g. "5.25" -> "5.25%"). */
export function fmtPct(v: Num, digits = 2, signed = false): string {
  const n = toNum(v);
  if (n === null) return "—";
  const s = Math.abs(n).toFixed(digits);
  const zero = Number(s) === 0;
  return `${zero ? "" : n < 0 ? "−" : signed && n > 0 ? "+" : ""}${s}%`;
}

export function fmtNum(v: Num, maxDigits = 4): string {
  const n = toNum(v);
  if (n === null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: maxDigits });
}

/** Trim trailing zeros of a decimal string ("5.000000" -> "5"). */
export function fmtDec(v: Num): string {
  const n = toNum(v);
  if (n === null) return "—";
  return String(n);
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  // Plain dates (YYYY-MM-DD) are shown as-is to avoid timezone shifts.
  return v.slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2016-03-01" -> "Mar 2016" (no timezone conversion). */
export function fmtMonth(v: string | null | undefined): string {
  if (!v) return "—";
  const [y, m] = v.split("-");
  const name = MONTHS[Number(m) - 1];
  return name && y ? `${name} ${y}` : v;
}

/** "2016-03-01" -> "Mar 1, 2016". */
export function fmtDay(v: string | null | undefined): string {
  if (!v) return "—";
  const [y, m, d] = v.slice(0, 10).split("-");
  const name = MONTHS[Number(m) - 1];
  return name && y && d ? `${name} ${Number(d)}, ${y}` : v;
}

export function ageMs(v: string | null | undefined, now: number = Date.now()): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : now - t;
}

export function fmtRelative(v: string | null | undefined, now: number = Date.now()): string {
  const ms = ageMs(v, now);
  if (ms === null) return "never";
  const s = Math.round(ms / 1000);
  if (Math.abs(s) < 45) return "just now";
  const m = Math.round(s / 60);
  if (Math.abs(m) < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Human label for an enum like SKIP_DAILY_CAP -> "Skip daily cap". */
export function humanize(v: string): string {
  const s = v.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function tierLabel(index0: number): string {
  return `T${index0 + 1}`;
}

/** Engine reasons carry raw decimals ("400.000000 + 300 > 500.000000"); trim trailing zeros. */
export function readableReason(reason: string): string {
  return reason.replace(/(\d+)\.(\d*?)0+(?!\d)/g, (_m, a: string, b: string) => (b ? `${a}.${b}` : a));
}
