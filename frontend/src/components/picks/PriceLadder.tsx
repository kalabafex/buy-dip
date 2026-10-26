import { featureNum, num, type Pick } from "@/lib/picks";
import { fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type Level = { key: string; value: number };

/**
 * Plan levels (stop · entry limit · target) on one horizontal price scale, with the day's
 * low–high range, open and close underneath once known, and the actual fills as rings.
 * Values are listed in the key below, so nothing depends on reading the scale.
 */
export function PriceLadder({
  pick,
  livePrice = null,
  className,
}: {
  pick: Pick;
  livePrice?: number | null;
  className?: string;
}) {
  const entry = num(pick.entry_limit) ?? 0;
  const stop = num(pick.stop_price);
  const target = num(pick.target_price);
  const open = num(pick.open_price);
  const low = num(pick.day_low);
  const high = num(pick.day_high);
  const close = num(pick.day_close);
  const buy = num(pick.entry_fill_price);
  const sell = num(pick.exit_fill_price);
  const atr = featureNum(pick, "atr");

  const values = [entry, stop, target, open, low, high, close, buy, sell, livePrice].filter(
    (v): v is number => v !== null && v > 0,
  );
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const minSpan = Math.max(atr ?? 0, entry * 0.01);
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * 0.06;
  lo -= pad;
  hi += pad;
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const span = (a: number, b: number) => ({
    left: x(Math.min(a, b)),
    width: `${(Math.abs(b - a) / (hi - lo)) * 100}%`,
  });
  const hasDay = low !== null && high !== null;

  const ticks: (Level & { cls: string })[] = [
    ...(stop !== null ? [{ key: "Stop", value: stop, cls: "bg-loss" }] : []),
    { key: "Entry", value: entry, cls: "bg-foreground" },
    ...(target !== null ? [{ key: "Target", value: target, cls: "bg-gain" }] : []),
  ];

  const label = [
    `Plan: ${stop !== null ? `stop ${fmtPrice(stop)}, ` : "no stop, "}buy up to ${fmtPrice(entry)}${target !== null ? `, target ${fmtPrice(target)}` : ", no target"}.`,
    hasDay ? `Day range ${fmtPrice(low)} to ${fmtPrice(high)}, close ${fmtPrice(close)}.` : "",
    livePrice !== null ? `Now ${fmtPrice(livePrice)}.` : "",
  ].join(" ");

  return (
    <figure className={cn("grid gap-2", className)}>
      <div role="img" aria-label={label} className="grid gap-2.5 py-1">
        {/* Plan row */}
        <div className="relative h-5">
          <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
          {stop !== null && (
            <span
              aria-hidden
              className="absolute top-1/2 h-2 -translate-y-1/2 rounded-l-[4px] bg-loss/15"
              style={span(stop, entry)}
            />
          )}
          {target !== null && (
            <span
              aria-hidden
              className="absolute top-1/2 h-2 -translate-y-1/2 rounded-r-[4px] bg-gain/15"
              style={span(entry, target)}
            />
          )}
          {ticks.map((t) => (
            <span
              key={t.key}
              aria-hidden
              className={cn("absolute top-0 h-5 w-0.5 -translate-x-1/2 rounded-full", t.cls)}
              style={{ left: x(t.value) }}
            />
          ))}
          {[buy, sell].map((v, i) =>
            v !== null ? (
              <span
                key={i}
                aria-hidden
                className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-primary"
                style={{ left: x(v) }}
              />
            ) : null,
          )}
          {livePrice !== null && livePrice > 0 && (
            <span
              aria-hidden
              data-testid="ladder-now"
              className="absolute top-1/2 flex h-3 w-3 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-700 ease-out"
              style={{ left: x(livePrice) }}
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info opacity-50" />
              <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-card bg-info" />
            </span>
          )}
        </div>
        {/* Day row */}
        <div className="relative h-3">
          <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/60" />
          {hasDay ? (
            <>
              <span
                aria-hidden
                className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted-foreground/35"
                style={span(low, high)}
              />
              {close !== null && (
                <span
                  aria-hidden
                  className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground"
                  style={{ left: x(close) }}
                />
              )}
            </>
          ) : (
            open !== null && (
              <span
                aria-hidden
                className="absolute top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-muted-foreground/60"
                style={{ left: x(open) }}
              />
            )
          )}
        </div>
      </div>
      <figcaption className="num flex flex-wrap gap-x-3.5 gap-y-1 text-2xs text-muted-foreground">
        {stop !== null && <Key swatch="bg-loss" label="Stop" value={fmtPrice(stop)} />}
        <Key swatch="bg-foreground" label="Buy ≤" value={fmtPrice(entry)} />
        {target !== null && <Key swatch="bg-gain" label="Target" value={fmtPrice(target)} />}
        {hasDay ? (
          <>
            <Key
              swatch="bg-muted-foreground/45"
              wide
              label="Day"
              value={`${fmtPrice(low)}–${fmtPrice(high)}`}
            />
            {close !== null && <Key dot="bg-foreground" label="Close" value={fmtPrice(close)} />}
          </>
        ) : (
          open !== null && <Key swatch="bg-muted-foreground/60" thin label="Open" value={fmtPrice(open)} />
        )}
        {livePrice !== null && <Key dot="bg-info" label="Now" value={fmtPrice(livePrice)} />}
        {(buy !== null || sell !== null) && (
          <Key dot="bg-primary" label="Fills" value={[buy, sell].filter((v) => v !== null).map(fmtPrice).join(" → ")} />
        )}
      </figcaption>
    </figure>
  );
}

function Key({
  label,
  value,
  swatch,
  dot,
  wide,
  thin,
}: {
  label: string;
  value: string;
  swatch?: string;
  dot?: string;
  wide?: boolean;
  thin?: boolean;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap">
      {dot ? (
        <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
      ) : (
        <span
          aria-hidden
          className={cn("shrink-0 rounded-full", swatch, wide ? "h-1.5 w-3" : thin ? "h-3 w-px" : "h-3 w-0.5")}
        />
      )}
      <span>{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}
