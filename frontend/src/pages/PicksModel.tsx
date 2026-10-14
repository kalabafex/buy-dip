import { CalendarRange, Check, Database, Scale, ShieldCheck, ShieldQuestion, Split, X } from "lucide-react";
import type { Schemas } from "@/api/client";
import { usePicksDay, usePicksModel } from "@/api/queries";
import { Callout, ErrorBox, PageHeader, Signed } from "@/components/common";
import { CalibrateButton, CalibrationProgress, NoModelCard } from "@/components/picks/Calibration";
import { PicksTabs } from "@/components/picks/sections";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDateTime, fmtDay, fmtNum, fmtPct } from "@/lib/format";
import { exitChoice } from "@/lib/picks";
import { cn } from "@/lib/utils";

type Model = Schemas["PickModelOut"];
type Family = Schemas["PickFamilyOut"];
type Stats = Schemas["PickFamilyStats"];

const MIN_T = 2;
const MIN_N = 100;

function Criterion({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-2xs font-medium",
        ok ? "border-gain/25 bg-gain-soft text-gain" : "border-loss/25 bg-loss-soft text-loss",
      )}
    >
      {ok ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
      {children}
      <span className="sr-only">{ok ? "(passes)" : "(fails)"}</span>
    </span>
  );
}

function StatsTable({ train, val }: { train: Stats; val: Stats }) {
  const rows: { label: string; f: (s: Stats) => React.ReactNode }[] = [
    { label: "Trades", f: (s) => fmtNum(s.n, 0) },
    {
      label: "Mean / trade",
      f: (s) => <Signed value={s.mean}>{fmtPct(s.mean * 100, 3, true)}</Signed>,
    },
    { label: "Win rate", f: (s) => `${Math.round(s.win_rate * 100)}%` },
    {
      label: "Avg win / loss",
      f: (s) => `${fmtPct(s.avg_win * 100, 2, true)} / ${fmtPct(s.avg_loss * 100, 2, true)}`,
    },
    { label: "t-stat", f: (s) => fmtNum(s.t_stat, 2) },
  ];
  // With no trades only the count is meaningful.
  const cell = (r: (typeof rows)[number], st: Stats) => (st.n === 0 && r.label !== "Trades" ? "—" : r.f(st));
  return (
    <table className="num w-full text-xs">
      <caption className="sr-only">Training versus validation statistics</caption>
      <thead>
        <tr className="border-b text-2xs uppercase tracking-wider text-muted-foreground">
          <th scope="col" className="py-1.5 text-left font-medium">
            <span className="sr-only">Statistic</span>
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            Train
          </th>
          <th scope="col" className="py-1.5 pl-3 text-right font-medium text-foreground">
            Validation
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-b border-border/60 last:border-0">
            <th scope="row" className="py-1.5 text-left font-normal text-muted-foreground">
              {r.label}
            </th>
            <td className="py-1.5 text-right text-muted-foreground">{cell(r, train)}</td>
            <td className="py-1.5 pl-3 text-right font-semibold">{cell(r, val)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SetupCard({ f }: { f: Family }) {
  const v = f.validation;
  return (
    <Card className={cn("flex flex-col", !f.accepted && "border-dashed bg-muted/20 shadow-none")}>
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">{f.label}</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{f.description}</p>
        </div>
        {f.accepted ? (
          <Badge variant="success">
            <ShieldCheck className="h-3 w-3" aria-hidden /> Validated
          </Badge>
        ) : (
          <Badge variant="outline">
            <ShieldQuestion className="h-3 w-3" aria-hidden /> Watch only
          </Badge>
        )}
      </div>
      <div className="grid flex-1 content-start gap-3 px-4 py-3.5 sm:px-5">
        <div className="text-xs">
          <span className="text-muted-foreground">Chosen exit: </span>
          <span className="font-medium">{exitChoice(f.target_atr, f.stop_atr)}</span>
        </div>
        <StatsTable train={f.train} val={v} />
        <div className="flex flex-wrap gap-1.5" aria-label="Validation criteria">
          <Criterion ok={v.mean > 0}>mean &gt; 0</Criterion>
          <Criterion ok={v.t_stat >= MIN_T}>t ≥ {MIN_T}</Criterion>
          <Criterion ok={v.n >= MIN_N}>≥ {MIN_N} trades</Criterion>
        </div>
      </div>
    </Card>
  );
}

function Facts({ m }: { m: Model }) {
  const ok = m.families.filter((f) => f.accepted).length;
  const facts = [
    { icon: CalendarRange, label: "Data", value: `${fmtDay(m.data_start)} – ${fmtDay(m.data_end)}` },
    { icon: Split, label: "Split (train | validation)", value: fmtDay(m.split_date) },
    { icon: Database, label: "Stocks", value: fmtNum(m.symbols, 0) },
    { icon: Scale, label: "Validated setups", value: `${ok} of ${m.families.length}` },
  ];
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {facts.map((f) => (
        <div key={f.label} className="flex items-center gap-2.5 rounded-lg border bg-muted/30 px-3 py-2">
          <f.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <dt className="text-2xs text-muted-foreground">{f.label}</dt>
            <dd className="num text-xs font-semibold">{f.value}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}

export function PicksModelPage() {
  const latest = usePicksModel();
  const day = usePicksDay(null);
  const l = latest.data;
  const busy = l && (l.status === "QUEUED" || l.status === "RUNNING") ? l : null;
  // Show the latest finished calibration even while a new one runs or after one failed.
  const done: Model | null = l?.status === "DONE" ? l : (day.data?.model ?? null);
  const failed = l?.status === "FAILED" ? l : null;

  const header = (
    <PageHeader
      title="Picks model"
      subtitle="Each setup is backtested on ~5 years of daily bars for the S&P 500. The exit is chosen on the first two thirds of the history and then checked on the last third, which the choice never saw."
      actions={<PicksTabs />}
    />
  );

  if (latest.isPending) {
    return (
      <div className="grid grid-cols-1 gap-5" role="status" aria-label="Loading">
        {header}
        <Skeleton className="h-36 rounded-xl" />
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      {header}
      <ErrorBox error={latest.error} />
      {!done ? (
        <NoModelCard running={busy} failed={failed} />
      ) : (
        <>
          <Card>
            <CardContent className="grid gap-4 pt-4 sm:pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold tracking-tight">Latest calibration</h2>
                  <p className="num mt-0.5 text-xs text-muted-foreground">
                    Finished {fmtDateTime(done.finished_at)} · repeats weekly, off-hours
                  </p>
                </div>
                {!busy && <CalibrateButton variant="outline" size="sm">Recalibrate</CalibrateButton>}
              </div>
              {busy && (
                <div className="rounded-lg border bg-muted/20 p-3">
                  <CalibrationProgress model={busy} />
                </div>
              )}
              {failed && (
                <Callout tone="danger" title="The most recent calibration failed">
                  {failed.error ?? "Unknown error"} — the picks keep using the calibration below.
                </Callout>
              )}
              <Facts m={done} />
              <p className="text-xs leading-5 text-muted-foreground">
                <span className="font-medium text-foreground">Validation rule:</span> a setup is traded only if,
                on the validation period, its average return per trade is positive with a t-statistic of at
                least {MIN_T} over at least {MIN_N} trades. Others still appear as “watch only”.
              </p>
            </CardContent>
          </Card>
          <section aria-label="Setups" className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {[...done.families]
              .sort((a, b) => Number(b.accepted) - Number(a.accepted))
              .map((f) => (
                <SetupCard key={f.family} f={f} />
              ))}
          </section>
        </>
      )}
    </div>
  );
}
