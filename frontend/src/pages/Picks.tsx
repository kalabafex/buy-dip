import { CalendarOff, ChevronLeft, ChevronRight, Hourglass, Loader2, SearchX, SlidersHorizontal } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Schemas } from "@/api/client";
import { usePicksDay, usePicksDays } from "@/api/queries";
import { EmptyState, ErrorBox, PageHeader } from "@/components/common";
import { AutoTradeCard } from "@/components/picks/AutoTradeCard";
import { CalibrationProgress, NoModelCard } from "@/components/picks/Calibration";
import { PickCard } from "@/components/picks/PickCard";
import { DayTotals, PicksCaveat, PicksTabs } from "@/components/picks/sections";
import { Timeline } from "@/components/picks/Timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeaderRow } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDay } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import {
  dayPhase,
  fmtCountdown,
  fmtEt,
  fmtSessionDate,
  nyDate,
  publishCutoff,
  sessionTimes,
  type PicksDay,
} from "@/lib/picks";

function DateNav({
  current,
  today,
  days,
  onGo,
}: {
  current: string;
  today: string;
  days: Schemas["PicksDaySummary"][] | undefined;
  onGo: (date: string) => void;
}) {
  const counts = new Map((days ?? []).map((d) => [d.session_date, d.picks]));
  const all = [...new Set([today, current, ...counts.keys()])].sort().reverse();
  const older = all.find((d) => d < current);
  const newer = [...all].reverse().find((d) => d > current);
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="icon"
        disabled={!older}
        onClick={() => older && onGo(older)}
        aria-label={older ? `Previous day with picks: ${fmtDay(older)}` : "No earlier days"}
        title="Previous day"
      >
        <ChevronLeft />
      </Button>
      <Select value={current} onValueChange={onGo}>
        <SelectTrigger className="h-8 w-[13.5rem] text-xs" aria-label="Choose a day">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {all.map((d) => (
            <SelectItem key={d} value={d} className="text-xs">
              <span className="num">
                {fmtSessionDate(d)}
                {d === today ? " · today" : counts.has(d) ? ` · ${counts.get(d)} picks` : ""}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="icon"
        disabled={!newer}
        onClick={() => newer && onGo(newer)}
        aria-label={newer ? `Next day: ${fmtDay(newer)}` : "No later days"}
        title="Next day"
      >
        <ChevronRight />
      </Button>
      {current !== today && (
        <Button variant="ghost" size="sm" onClick={() => onGo(today)}>
          Today
        </Button>
      )}
    </div>
  );
}

function Waiting({ day, now, isToday }: { day: PicksDay; now: number; isToday: boolean }) {
  const t = sessionTimes(day);
  const cutoff = publishCutoff(day);
  if (isToday && t && now < t.entry) {
    return (
      <Card>
        <EmptyState
          icon={Hourglass}
          title={
            <>
              Today's picks are published at {fmtEt(day.entry_time)} ET —{" "}
              <span className="num text-primary">in {fmtCountdown(t.entry - now)}</span>
            </>
          }
          description="Five minutes after the open the worker reads every stock's opening price, ranks the setups that fire and publishes the top 5 here (and as an alert). With auto-trade on, orders go in right away."
          className="py-12"
        />
      </Card>
    );
  }
  if (isToday && cutoff !== null && now < cutoff) {
    return (
      <Card>
        <EmptyState
          icon={Loader2}
          title="Publishing today's picks…"
          description="The worker checks every minute; picks appear here as soon as the opening prices are in."
          className="py-12 [&_svg]:animate-spin"
        />
      </Card>
    );
  }
  return (
    <Card>
      <EmptyState
        icon={SearchX}
        title={`No picks on ${fmtDay(day.session_date)}`}
        description="None of the five setups fired at the open (or the worker was not running at the entry time). That is normal on quiet days — no trade is better than a forced one."
        className="py-12"
      />
    </Card>
  );
}

function ModelSummary({ day }: { day: PicksDay }) {
  const m = day.model;
  if (!m) return null;
  const ok = m.families.filter((f) => f.accepted).length;
  return (
    <Card>
      <CardHeaderRow
        title={
          <>
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden /> Model
          </>
        }
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link to="/picks/model">Details</Link>
          </Button>
        }
      />
      <CardContent className="grid gap-3">
        <div className="text-sm">
          <span className="num font-semibold">{ok}</span>
          <span className="text-muted-foreground"> of {m.families.length} setups validated</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[...m.families].sort((a, b) => Number(b.accepted) - Number(a.accepted)).map((f) => (
            <Badge key={f.family} variant={f.accepted ? "success" : "outline"} title={f.description}>
              {f.accepted && <span aria-hidden>✓</span>}
              {f.label}
            </Badge>
          ))}
        </div>
        <p className="num text-2xs text-muted-foreground">
          Calibrated {fmtDay(m.finished_at)} · {m.symbols} stocks · data {fmtDay(m.data_start)} –{" "}
          {fmtDay(m.data_end)}
        </p>
        {day.calibration_in_progress && (
          <div className="border-t pt-3">
            <CalibrationProgress model={day.calibration_in_progress} compact />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PicksPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("date");
  const query = usePicksDay(requested);
  const days = usePicksDays(60);
  const now = useNow(15_000);
  const today = nyDate(now);
  const day = query.data;
  const current = day?.session_date ?? requested ?? today;
  const isToday = current === today;
  const phase = useMemo(() => (day ? dayPhase(day, now) : null), [day, now]);
  const go = (d: string) => setParams(d === today ? {} : { date: d });

  const header = (
    <PageHeader
      title="Daily picks"
      subtitle="Five intraday setups from the S&P 500 each trading day, with an exact plan: when to buy, the limit, the target, the stop and the latest exit."
      actions={<PicksTabs />}
    />
  );

  if (query.isPending) {
    return (
      <div className="grid grid-cols-1 gap-5" role="status" aria-label="Loading">
        {header}
        <Skeleton className="h-36 rounded-xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-72 rounded-xl" />
        ))}
      </div>
    );
  }

  if (query.isError || !day || !phase) {
    return (
      <div className="grid grid-cols-1 gap-5">
        {header}
        <ErrorBox error={query.error ?? new Error("Could not load the picks.")} />
      </div>
    );
  }

  const noModel = !day.model && !day.generated;

  let main: React.ReactNode;
  if (noModel) {
    main = <NoModelCard running={day.calibration_in_progress} />;
  } else if (!day.is_trading_day) {
    main = (
      <Card>
        <EmptyState
          icon={CalendarOff}
          title={`The market is closed on ${fmtSessionDate(day.session_date)}`}
          description="Weekends and exchange holidays have no session, so there are no picks. Use the arrows to look at earlier days."
          className="py-12"
        />
      </Card>
    );
  } else if (!day.generated) {
    main = <Waiting day={day} now={now} isToday={isToday} />;
  } else {
    main = (
      <>
        <DayTotals day={day} />
        <section aria-label="Picks" className={`grid gap-4 transition-opacity ${query.isPlaceholderData ? "opacity-60" : ""}`}>
          {day.picks.map((p) => (
            <PickCard key={p.id} pick={p} />
          ))}
        </section>
      </>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      {header}

      <Card>
        <CardContent className="grid gap-4 pt-4 sm:pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
                {fmtSessionDate(day.session_date)}
                {isToday && <Badge variant="info">Today</Badge>}
              </h2>
              <p className="text-xs text-muted-foreground">All times New York (ET)</p>
            </div>
            <DateNav current={current} today={today} days={days.data} onGo={go} />
          </div>
          {day.is_trading_day ? (
            <Timeline day={day} phase={phase} now={now} isToday={isToday} />
          ) : (
            <p className="text-sm text-muted-foreground">No session on this day.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 gap-5">{main}</div>
        <div className="grid gap-5 xl:sticky xl:top-20">
          <AutoTradeCard settings={day.settings} />
          <ModelSummary day={day} />
          <PicksCaveat />
        </div>
      </div>
    </div>
  );
}
