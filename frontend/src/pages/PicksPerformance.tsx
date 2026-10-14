import { CalendarDays, CheckCircle2, Layers, LineChart, Scale, Trophy, Wallet, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePicksDays, usePicksPerformance } from "@/api/queries";
import { EmptyState, ErrorBox, PageHeader, Signed } from "@/components/common";
import { StatCard } from "@/components/dashboard/StatCard";
import { CumulativeChart } from "@/components/picks/CumulativeChart";
import { PicksTabs } from "@/components/picks/sections";
import { Card, CardContent, CardHeaderRow } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtPct, fmtPts, fmtUsdSigned } from "@/lib/format";
import { fmtSessionDate, num } from "@/lib/picks";

type FamilyRow = { key: string; label: string; n: number; wins: number; win_rate: number; avg_pct: number };

function familyRows(by: Record<string, Record<string, unknown>> | undefined): FamilyRow[] {
  return Object.entries(by ?? {})
    .map(([key, v]) => ({
      key,
      label: typeof v.label === "string" ? v.label : key,
      n: Number(v.n ?? 0),
      wins: Number(v.wins ?? 0),
      win_rate: Number(v.win_rate ?? 0),
      avg_pct: Number(v.avg_pct ?? 0),
    }))
    .sort((a, b) => b.n - a.n);
}

const pct0 = (r: number | null | undefined) => (r == null ? "—" : `${Math.round(r * 100)}%`);

export function PicksPerformancePage() {
  const perf = usePicksPerformance();
  const days = usePicksDays(120);
  const navigate = useNavigate();
  const [view, setView] = useState<"plan" | "realized">("plan");
  const p = perf.data;

  const planPts = useMemo(
    () => (p?.series ?? []).map((s) => ({ date: s.session_date, value: Number(s.plan_cum_pct) })),
    [p],
  );
  const realPts = useMemo(
    () => (p?.series ?? []).map((s) => ({ date: s.session_date, value: Number(s.realized_cum_usd) })),
    [p],
  );
  const fams = familyRows(p?.by_family);
  const planAvg = num(p?.plan_avg_pct);
  const expAvg = num(p?.expected_avg_pct);
  const gap = planAvg !== null && expAvg !== null ? planAvg - expAvg : null;
  const pnl = num(p?.realized_pnl_usd);

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        title="Picks performance"
        subtitle="How the published picks did: the plan's result for every pick (whether or not it traded) and the actual fills of the ones that were traded."
        actions={<PicksTabs />}
      />
      <ErrorBox error={perf.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          hero
          className="col-span-2"
          title="Avg plan return vs expected · calibration check"
          icon={Scale}
          loading={perf.isPending}
          valueClassName="proportional"
          value={
            planAvg !== null ? (
              <span className="flex flex-wrap items-baseline gap-x-2">
                <Signed value={planAvg}>{fmtPct(planAvg, 2, true)}</Signed>
                <span className="text-sm font-medium text-muted-foreground">
                  vs {fmtPct(expAvg, 2, true)} expected
                </span>
              </span>
            ) : (
              "—"
            )
          }
          sub={
            gap !== null ? (
              <>
                Plan minus expected, per pick{" "}
                <Signed value={gap} className="font-medium">
                  {fmtPts(gap, 2)}
                </Signed>
              </>
            ) : (
              "Appears once a day has been evaluated after the close"
            )
          }
        />
        <StatCard
          title="Days"
          icon={CalendarDays}
          loading={perf.isPending}
          valueClassName="proportional"
          value={p ? p.days : "—"}
          sub="with published picks"
        />
        <StatCard
          title="Picks"
          icon={Layers}
          loading={perf.isPending}
          valueClassName="proportional"
          value={p ? p.picks : "—"}
          sub={p ? `${p.plan_evaluated} evaluated` : undefined}
        />
        <StatCard
          title="Plan win rate"
          icon={CheckCircle2}
          loading={perf.isPending}
          valueClassName="proportional"
          value={pct0(p?.plan_win_rate)}
          sub="plan return > 0"
        />
        <StatCard
          title="Traded"
          icon={Zap}
          loading={perf.isPending}
          valueClassName="proportional"
          value={p ? p.traded : "—"}
          sub="picks with fills"
        />
        <StatCard
          title="Realized win rate"
          icon={Trophy}
          loading={perf.isPending}
          valueClassName="proportional"
          value={pct0(p?.realized_win_rate)}
          sub="closed green"
        />
        <StatCard
          title="Realized P/L"
          icon={Wallet}
          loading={perf.isPending}
          valueClassName="proportional"
          value={pnl !== null ? <Signed value={pnl}>{fmtUsdSigned(pnl)}</Signed> : "—"}
          sub="paper account"
        />
      </div>

      <Card>
        <CardHeaderRow
          title={
            <>
              <LineChart className="h-4 w-4 text-muted-foreground" aria-hidden />
              {view === "plan" ? "Plan return, cumulative" : "Realized P/L, cumulative"}
            </>
          }
          description={
            view === "plan"
              ? "Sum of each day's average plan return (equal weight per pick, not compounded)."
              : "Running total of realized profit and loss from traded picks, in dollars."
          }
          actions={
            <Tabs value={view} onValueChange={(v) => setView(v as "plan" | "realized")}>
              <TabsList aria-label="Chart">
                <TabsTrigger value="plan">Plan %</TabsTrigger>
                <TabsTrigger value="realized">Realized $</TabsTrigger>
              </TabsList>
            </Tabs>
          }
        />
        <CardContent>
          {perf.isPending ? (
            <Skeleton className="h-[260px] sm:h-[320px]" />
          ) : !planPts.length ? (
            <EmptyState
              icon={LineChart}
              title="No history yet"
              description="The chart fills in as days are evaluated after the close."
            />
          ) : view === "plan" ? (
            <CumulativeChart
              key="plan"
              points={planPts}
              format={(v) => fmtPct(v, 2, true)}
              label="Plan return, cumulative"
            />
          ) : (
            <CumulativeChart
              key="realized"
              points={realPts}
              format={(v) => fmtUsdSigned(v)}
              label="Realized P/L, cumulative"
            />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeaderRow
            title="By setup"
            description="Plan results of evaluated picks, grouped by the setup that fired."
          />
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Setup</TableHead>
                  <TableHead className="text-right">Picks</TableHead>
                  <TableHead className="text-right">Wins</TableHead>
                  <TableHead className="text-right">Win rate</TableHead>
                  <TableHead className="text-right">Avg plan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perf.isPending || !fams.length ? (
                  <TableEmpty colSpan={5} loading={perf.isPending}>
                    No evaluated picks yet.
                  </TableEmpty>
                ) : (
                  fams.map((f) => (
                    <TableRow key={f.key}>
                      <TableCell className="font-medium">{f.label}</TableCell>
                      <TableCell className="text-right">{f.n}</TableCell>
                      <TableCell className="text-right">{f.wins}</TableCell>
                      <TableCell className="text-right">{pct0(f.win_rate)}</TableCell>
                      <TableCell className="text-right">
                        <Signed value={f.avg_pct}>{fmtPct(f.avg_pct, 2, true)}</Signed>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeaderRow title="By day" description="Click a day to open its picks." />
          <CardContent>
            <ErrorBox error={days.error} className="mb-3" />
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Picks</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Plan</TableHead>
                  <TableHead className="text-right">Plan wins</TableHead>
                  <TableHead className="text-right">Traded</TableHead>
                  <TableHead className="text-right">Realized</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.isPending || !days.data?.length ? (
                  <TableEmpty colSpan={7} loading={days.isPending}>
                    No picks have been published yet.
                  </TableEmpty>
                ) : (
                  days.data.map((d) => {
                    const plan = num(d.plan_return_avg_pct);
                    const real = num(d.realized_pnl_usd);
                    return (
                      <TableRow
                        key={d.session_date}
                        className="cursor-pointer"
                        onClick={() => navigate(`/?date=${d.session_date}`)}
                      >
                        <TableCell className="font-medium">
                          <Link
                            to={`/?date=${d.session_date}`}
                            className="hover:underline focus-visible:underline focus-visible:outline-none"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {fmtSessionDate(d.session_date)}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right">{d.picks}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {fmtPct(d.expected_avg_pct, 2, true)}
                        </TableCell>
                        <TableCell className="text-right">
                          {plan !== null ? <Signed value={plan}>{fmtPct(plan, 2, true)}</Signed> : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {plan !== null ? `${d.plan_wins} / ${d.picks}` : "—"}
                        </TableCell>
                        <TableCell className="text-right">{d.traded || "—"}</TableCell>
                        <TableCell className="text-right">
                          {real !== null ? (
                            <Signed value={real}>
                              {fmtUsdSigned(real)}{" "}
                              <span className="text-2xs text-muted-foreground">
                                ({d.realized_wins}/{d.traded})
                              </span>
                            </Signed>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
