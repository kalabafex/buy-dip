import { RotateCcw } from "lucide-react";
import type { Schemas } from "@/api/client";
import { JobStatusBadge } from "@/components/badges";
import { backtestResultsSchema, type BacktestResults } from "@/components/backtest/results";
import { MetricsComparison } from "@/components/backtest/MetricsComparison";
import { ComparisonChart } from "@/components/charts/ComparisonChart";
import { ErrorBox } from "@/components/common";
import { fromSnapshot, type RuleFormValues } from "@/components/rules/ruleSchema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeaderRow } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDay, fmtNum, fmtPrice, fmtUsd, fmtUsdShort, humanize } from "@/lib/format";

export function BacktestResultView({
  bt,
  onRerun,
}: {
  bt: Schemas["BacktestOut"];
  onRerun?: (values: RuleFormValues) => void;
}) {
  const symbol = typeof bt.rule_snapshot.symbol === "string" ? bt.rule_snapshot.symbol : "?";
  const snapshot = fromSnapshot(bt.rule_snapshot);
  const header = (
    <CardHeaderRow
      title={
        <>
          Backtest · {symbol} <JobStatusBadge status={bt.status} />
        </>
      }
      description={`${fmtDay(bt.start_date)} → ${fmtDay(bt.end_date)} · starting cash ${fmtUsd(bt.starting_cash, { compact: true })}`}
      actions={
        onRerun &&
        snapshot && (
          <Button size="sm" variant="outline" onClick={() => onRerun(snapshot)}>
            <RotateCcw /> Re-run with edits
          </Button>
        )
      }
    />
  );

  if (bt.status === "QUEUED" || bt.status === "RUNNING") {
    return (
      <Card>
        {header}
        <CardContent className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            {bt.status === "QUEUED" ? "Waiting for the worker to pick this up…" : "Simulating every session…"}
          </p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Skeleton className="h-56" />
            <Skeleton className="h-56" />
          </div>
        </CardContent>
      </Card>
    );
  }
  if (bt.status === "FAILED") {
    return (
      <Card>
        {header}
        <CardContent>
          <ErrorBox error={new Error(bt.error ?? "Backtest failed")} />
        </CardContent>
      </Card>
    );
  }
  const parsed = backtestResultsSchema.safeParse(bt.results);
  if (!parsed.success) {
    return (
      <Card>
        {header}
        <CardContent>
          <ErrorBox
            error={new Error(`Unexpected results format: ${parsed.error.issues[0]?.message ?? "unknown"}`)}
          />
        </CardContent>
      </Card>
    );
  }
  const r = parsed.data;
  return (
    <div className="grid grid-cols-1 gap-5">
      <Card>
        {header}
        <CardContent className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <MetricsComparison rule={r.rule} baseline={r.baseline} hold={r.hold} />
          <div className="grid content-start gap-2">
            <div className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              Equity over time
            </div>
            <ComparisonChart
              points={r.equity_curve}
              ruleLabel="Rule equity"
              baselineLabel="Monthly DCA equity"
              holdLabel="Buy & hold equity"
              format={(v) => fmtUsdShort(v)}
            />
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <TradesCard trades={r.trades} />
        <DecisionsCard decisions={r.decisions} />
      </div>
    </div>
  );
}

function TradesCard({ trades }: { trades: BacktestResults["trades"] }) {
  return (
    <Card>
      <CardHeaderRow title={`Trades (${trades.length})`} />
      <CardContent className="scrollbar-thin max-h-[28rem] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Placed</TableHead>
              <TableHead>Session</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Limit</TableHead>
              <TableHead className="text-right">Fill</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.length === 0 ? (
              <TableEmpty colSpan={8}>No trades in this period: the rule never triggered.</TableEmpty>
            ) : (
              trades.map((t, i) => (
                <TableRow key={`${t.placed_date}-${t.tier}-${i}`}>
                  <TableCell className="text-xs">{t.placed_date}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.session_date}</TableCell>
                  <TableCell>T{t.tier}</TableCell>
                  <TableCell className="text-right">{fmtNum(t.qty)}</TableCell>
                  <TableCell className="text-right">{fmtPrice(t.limit_price)}</TableCell>
                  <TableCell className="text-right">{fmtPrice(t.fill_price)}</TableCell>
                  <TableCell className="text-right font-medium">{fmtUsd(t.cost)}</TableCell>
                  <TableCell>
                    <Badge variant={t.status === "FILLED" ? "success" : "outline"} dot>
                      {humanize(t.status)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Decision counts as horizontal bars (one series → one hue). */
function DecisionsCard({ decisions }: { decisions: Record<string, number> }) {
  const entries = Object.entries(decisions).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const max = entries[0]?.[1] ?? 1;
  return (
    <Card>
      <CardHeaderRow title="Decisions" description={`${total.toLocaleString()} session evaluations`} />
      <CardContent className="grid grid-cols-1 gap-2.5">
        {entries.map(([k, n]) => (
          <div key={k} className="grid gap-1" title={`${humanize(k)}: ${n}`}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{humanize(k)}</span>
              <span className="num font-medium">{n.toLocaleString()}</span>
            </div>
            <div className="h-1.5 w-full">
              <div
                className="h-full rounded-r-[4px] bg-primary/80"
                style={{ width: `${Math.max(2, (n / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
