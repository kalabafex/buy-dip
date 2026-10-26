import { AlertTriangle, Check, Clock, Cpu, Eye, LogIn, ShieldAlert, Target, X } from "lucide-react";
import type { ReactNode } from "react";
import { Signed } from "@/components/common";
import { LiveStrip } from "@/components/picks/Live";
import { PriceLadder } from "@/components/picks/PriceLadder";
import { Eyebrow, PickStatusBadge } from "@/components/picks/parts";
import { CertaintyFigure, ProjectedMove } from "@/components/picks/Projection";
import { WhyThisPick } from "@/components/picks/WhyThisPick";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { InfoPopover } from "@/components/ui/popover";
import { fmtNum, fmtPct, fmtPrice, fmtUsd, fmtUsdSigned } from "@/lib/format";
import { ENTRY_BUFFER_PCT, exitReasonText, featureNum, fmtEt, num, type Pick } from "@/lib/picks";
import type { Live } from "@/lib/live";
import { cn } from "@/lib/utils";

type StepState = "todo" | "done" | "hit-bad" | "skipped";

function Step({
  n,
  icon: Icon,
  state = "todo",
  title,
  sub,
}: {
  n: number;
  icon: typeof Clock;
  state?: StepState;
  title: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <li className="group/step relative flex gap-3 pb-3.5 last:pb-0">
      {/* connector */}
      <span aria-hidden className="absolute bottom-0 left-[0.6875rem] top-6 w-px bg-border group-last/step:hidden" />
      <span
        className={cn(
          "relative z-[1] flex h-[1.375rem] w-[1.375rem] shrink-0 items-center justify-center rounded-full border text-2xs font-semibold",
          state === "done" && "border-gain/30 bg-gain-soft text-gain",
          state === "hit-bad" && "border-loss/30 bg-loss-soft text-loss",
          state === "skipped" && "border-dashed bg-card text-muted-foreground",
          state === "todo" && "bg-card text-muted-foreground",
        )}
        aria-hidden
      >
        {state === "done" ? (
          <Check className="h-3 w-3" />
        ) : state === "hit-bad" ? (
          <X className="h-3 w-3" />
        ) : (
          <Icon className="h-3 w-3" />
        )}
      </span>
      <div className={cn("min-w-0 pt-px", state === "skipped" && "opacity-60")}>
        <div className="text-sm leading-5">
          <span className="sr-only">Step {n}: </span>
          {title}
        </div>
        {sub && <div className="num mt-0.5 text-2xs leading-4 text-muted-foreground">{sub}</div>}
      </div>
    </li>
  );
}

function Plan({ pick }: { pick: Pick }) {
  const entry = fmtEt(pick.entry_time);
  const exit = fmtEt(pick.exit_time);
  const filled = num(pick.entry_fill_price) !== null;
  const reason = pick.exit_reason;
  const notTraded = ["NOT_FILLED", "NOT_TRADED", "WATCH", "FAILED"].includes(pick.status);
  const qty = pick.qty;
  // Once the position is closed (or never opened), legs that did not trigger are moot.
  const over = !!reason || notTraded;
  const idle: StepState = over ? "skipped" : "todo";
  return (
    <ol className="grid">
      <Step
        n={1}
        icon={LogIn}
        state={filled ? "done" : notTraded ? "skipped" : "todo"}
        title={
          <>
            Buy at <span className="font-semibold">{entry} ET</span> — limit{" "}
            <span className="num font-semibold">{fmtPrice(pick.entry_limit)}</span>
          </>
        }
        sub={
          <>
            ≤ open {fmtPrice(pick.open_price)} + {ENTRY_BUFFER_PCT}%
            {qty ? ` · ${qty} share${qty === 1 ? "" : "s"} ≈ ${fmtUsd(pick.notional_usd)}` : ""}
          </>
        }
      />
      {pick.target_price ? (
        <Step
          n={2}
          icon={Target}
          state={reason === "TARGET" ? "done" : idle}
          title={
            <>
              Take profit at <span className="num font-semibold">{fmtPrice(pick.target_price)}</span>{" "}
              <span className="num text-gain">({fmtPct(pick.target_pct, 2, true)})</span>
            </>
          }
          sub="Limit sell, working all day"
        />
      ) : (
        <Step n={2} icon={Target} state="skipped" title="No target — hold to the exit" />
      )}
      {pick.stop_price ? (
        <Step
          n={3}
          icon={ShieldAlert}
          state={reason === "STOP" ? "hit-bad" : idle}
          title={
            <>
              Stop at <span className="num font-semibold">{fmtPrice(pick.stop_price)}</span>{" "}
              <span className="num text-loss">({fmtPct(pick.stop_pct, 2, true)})</span>
            </>
          }
          sub="Stop order caps the loss"
        />
      ) : (
        <Step n={3} icon={ShieldAlert} state="skipped" title="No stop" sub="Risk is limited by the same-day exit" />
      )}
      <Step
        n={4}
        icon={Clock}
        state={reason === "TIME" ? "done" : idle}
        title={
          <>
            Exit everything by <span className="font-semibold">{exit} ET</span>
          </>
        }
        sub="Nothing is held overnight"
      />
    </ol>
  );
}

/** Daily bars can't tell which level was touched first; the plan then assumes the stop. */
function bothInRange(p: Pick): boolean {
  const t = num(p.target_price);
  const st = num(p.stop_price);
  const hi = num(p.day_high);
  const lo = num(p.day_low);
  return p.plan_exit_reason === "STOP" && t !== null && st !== null && hi !== null && lo !== null && hi >= t && lo <= st;
}

function Outcome({ pick }: { pick: Pick }) {
  const buy = num(pick.entry_fill_price);
  const sell = num(pick.exit_fill_price);
  const realized = num(pick.realized_return_pct);
  const plan = num(pick.plan_return_pct);
  const rows: ReactNode[] = [];

  if (buy !== null) {
    rows.push(
      <div key="buy" className="num text-xs text-muted-foreground">
        Bought <span className="font-medium text-foreground">{fmtNum(pick.entry_filled_qty, 0)}</span> @{" "}
        <span className="font-medium text-foreground">{fmtPrice(buy)}</span>
        {sell !== null && (
          <>
            {" "}
            · sold @ <span className="font-medium text-foreground">{fmtPrice(sell)}</span>{" "}
            ({exitReasonText(pick.exit_reason)})
          </>
        )}
      </div>,
    );
  } else if (pick.status === "SUBMITTED" || pick.status === "SUBMITTING") {
    rows.push(
      <div key="wait" className="text-xs text-muted-foreground">
        Limit buy working at {fmtPrice(pick.entry_limit)}; it may not fill if the price runs away.
      </div>,
    );
  } else if (pick.status === "NOT_FILLED") {
    rows.push(
      <div key="nf" className="text-xs text-muted-foreground">
        The limit buy at {fmtPrice(pick.entry_limit)} never filled — nothing was bought.
      </div>,
    );
  } else if (pick.status === "NOT_TRADED") {
    rows.push(
      <div key="nt" className="text-xs text-muted-foreground">
        Not traded{pick.skip_reason ? `: ${pick.skip_reason}` : ""}.
      </div>,
    );
  }

  return (
    <div className="grid gap-3">
      {realized !== null && (
        <div>
          <Eyebrow>Realized</Eyebrow>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
            <Signed value={realized} className="text-xl font-semibold tracking-tight">
              {fmtPct(realized, 2, true)}
            </Signed>
            <Signed value={num(pick.realized_pnl_usd)} className="text-sm font-medium">
              {fmtUsdSigned(pick.realized_pnl_usd)}
            </Signed>
          </div>
        </div>
      )}
      {rows}
      {plan !== null ? (
        <div className="rounded-lg border bg-muted/30 px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-2xs font-medium text-muted-foreground">Following the plan</span>
            <Signed value={plan} className="text-sm font-semibold">
              {fmtPct(plan, 2, true)}
            </Signed>
          </div>
          <div className="num text-2xs text-muted-foreground">
            {exitReasonText(pick.plan_exit_reason, true)}
            {pick.plan_exit_price ? ` at ${fmtPrice(pick.plan_exit_price)}` : ""} · simulated from the day's
            prices
          </div>
          {bothInRange(pick) && (
            <div className="mt-1 text-2xs text-muted-foreground">
              Target and stop were both inside the day's range; the simulation assumes the stop came first.
            </div>
          )}
        </div>
      ) : (
        pick.status !== "FAILED" && (
          <div className="text-2xs text-muted-foreground">
            The plan's result is recorded after the close (about 16:15 ET).
          </div>
        )
      )}
    </div>
  );
}

export function PickCard({ pick, live, now }: { pick: Pick; live?: Live; now: number }) {
  const watch = pick.status === "WATCH";
  const top = pick.rank === 1 && !watch;
  const projected = num(pick.projected_move_pct) ?? num(pick.expected_return_pct) ?? 0;
  const certainty = num(pick.certainty_pct);
  const winRate = num(pick.win_rate);
  const gap = featureNum(pick, "gap_pct");
  const atrPct = featureNum(pick, "atr_pct");
  const rsi2 = featureNum(pick, "rsi2");
  const facts = [
    gap !== null ? `Gap ${fmtPct(gap, 1, true)}` : null,
    atrPct !== null ? `ATR ${fmtPct(atrPct, 1)}` : null,
    rsi2 !== null ? `RSI-2 ${fmtNum(rsi2, 0)}` : null,
  ].filter(Boolean);

  return (
    <Card
      className={cn(
        "overflow-visible",
        top && "border-primary/40 ring-1 ring-primary/20",
        watch && "border-dashed bg-muted/20 shadow-none",
        pick.status === "FAILED" && "border-loss/30",
      )}
      aria-label={`Pick ${pick.rank}: ${pick.symbol}`}
    >
      {/* Header */}
      <div className="flex items-start gap-3 border-b px-4 py-3.5 sm:px-5">
        <span
          className={cn(
            "num flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
            top ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
          )}
          aria-label={`Rank ${pick.rank}`}
        >
          {pick.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className={cn("text-base font-semibold tracking-tight", watch && "text-muted-foreground")}>
              {pick.symbol}
            </h3>
            <span className="min-w-0 truncate text-sm text-muted-foreground">{pick.name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-medium text-foreground/85">
              {pick.family_label}
              <InfoPopover label={`About the ${pick.family_label} setup`} title={pick.family_label}>
                {pick.family_description}
                <span className="mt-1.5 block">
                  {pick.accepted
                    ? "This setup passed validation on held-out history."
                    : "This setup did not pass validation, so it is never traded."}
                </span>
              </InfoPopover>
            </span>
            {pick.sector && (
              <span className="inline-flex gap-2">
                <span aria-hidden className="hidden sm:inline">
                  ·
                </span>
                <span>{pick.sector}</span>
              </span>
            )}
            {facts.length > 0 && (
              <>
                <span aria-hidden className="hidden sm:inline">
                  ·
                </span>
                <span className="num hidden sm:inline">{facts.join(" · ")}</span>
              </>
            )}
          </div>
        </div>
        <div className="mt-1 flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
          <PickStatusBadge status={pick.status} exitReason={pick.exit_reason} />
          {pick.engine_version != null && (
            <Badge
              variant="outline"
              title={`Scored by picks engine version ${pick.engine_version} (weekly-review parameters in force that day)`}
            >
              <Cpu className="h-3 w-3" aria-hidden />
              Engine v{pick.engine_version}
            </Badge>
          )}
        </div>
      </div>

      {watch && pick.skip_reason && (
        <div className="flex items-start gap-2 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground sm:px-5">
          <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-medium text-foreground">Watch only</span> — {pick.skip_reason}. Shown for
            information; never traded.
          </span>
        </div>
      )}
      {pick.status === "FAILED" && (
        <div className="flex items-start gap-2 border-b bg-loss-soft px-4 py-2 text-xs text-loss sm:px-5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            <span className="font-medium">Order failed</span>
            {pick.error ? ` — ${pick.error}` : ""}
          </span>
        </div>
      )}

      {live && <LiveStrip pick={pick} live={live} now={now} />}

      {/* Hero numbers */}
      <div className={cn("grid grid-cols-2 gap-x-5 gap-y-4 border-b px-4 py-4 sm:gap-x-8 sm:px-5", watch && "opacity-80")}>
        <ProjectedMove
          value={projected}
          low={num(pick.projected_low_pct)}
          high={num(pick.projected_high_pct)}
          sub={
            pick.expected_pnl_usd && pick.notional_usd
              ? `≈ ${fmtUsdSigned(pick.expected_pnl_usd)} on ${fmtUsd(pick.notional_usd)}`
              : "entry to exit, after costs"
          }
        />
        {certainty !== null ? (
          <CertaintyFigure value={certainty} raw={num(pick.raw_certainty_pct)} />
        ) : (
          <CertaintyFigure value={(winRate ?? 0) * 100} historical />
        )}
        {facts.length > 0 && <p className="num col-span-2 text-2xs text-muted-foreground sm:hidden">{facts.join(" · ")}</p>}
      </div>

      <div className={cn("grid grid-cols-1 gap-5 p-4 sm:p-5 md:grid-cols-2 2xl:grid-cols-3", watch && "opacity-80")}>
        {/* Plan */}
        <div className="grid content-start gap-2">
          <Eyebrow>The plan</Eyebrow>
          <Plan pick={pick} />
        </div>

        {/* Levels + outcome */}
        <div className="grid content-start gap-5 border-t pt-4 md:border-t-0 md:pt-0 2xl:contents">
          <div className="grid content-start gap-1.5">
            <Eyebrow>Levels</Eyebrow>
            <PriceLadder pick={pick} livePrice={live?.price ?? null} />
          </div>
          <Outcome pick={pick} />
        </div>
      </div>

      <WhyThisPick pick={pick} />
    </Card>
  );
}
