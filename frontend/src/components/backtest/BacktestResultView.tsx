import type { Schemas } from "@/api/client";
import { BacktestStatusBadge } from "@/components/badges";
import { backtestResultsSchema, type BacktestMetrics, type BacktestResults } from "@/components/backtest/results";
import { EquityChart } from "@/components/charts/EquityChart";
import { ErrorBox, Signed, Spinner } from "@/components/common";
import { fromSnapshot, type RuleFormValues } from "@/components/rules/ruleSchema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtNum, fmtPct, fmtPrice, fmtUsd, humanize } from "@/lib/format";

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
    <CardHeader>
      <CardTitle className="flex flex-wrap items-center gap-2">
        Backtest {symbol} <BacktestStatusBadge status={bt.status} />
        {onRerun && snapshot && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => onRerun(snapshot)}>
            Re-run with edits
          </Button>
        )}
      </CardTitle>
      <CardDescription>
        {bt.start_date} → {bt.end_date} · starting cash {fmtUsd(bt.starting_cash)}
      </CardDescription>
    </CardHeader>
  );

  if (bt.status === "QUEUED" || bt.status === "RUNNING") {
    return (
      <Card>
        {header}
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {bt.status === "QUEUED" ? "Waiting for the worker…" : "Running…"}
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
          <ErrorBox error={new Error(`Unexpected results format: ${parsed.error.issues[0]?.message ?? "unknown"}`)} />
        </CardContent>
      </Card>
    );
  }
  const r = parsed.data;
  return (
    <div className="grid grid-cols-1 gap-4">
      <Card>
        {header}
        <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <MetricsTable r={r} />
          <EquityChart curve={r.equity_curve} />
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <TradesCard trades={r.trades} />
        <DecisionsCard decisions={r.decisions} />
      </div>
    </div>
  );
}

const METRICS: { key: keyof BacktestMetrics; label: string; fmt: (v: string | number | null) => string }[] = [
  { key: "total_invested", label: "Total invested", fmt: (v) => fmtUsd(v) },
  { key: "final_value", label: "Final position value", fmt: (v) => fmtUsd(v) },
  { key: "final_equity", label: "Final equity", fmt: (v) => fmtUsd(v) },
  { key: "return_pct", label: "Return on invested", fmt: (v) => fmtPct(v, 2, true) },
  { key: "max_drawdown_pct", label: "Max drawdown", fmt: (v) => fmtPct(v) },
  { key: "num_buys", label: "Buys", fmt: (v) => String(v ?? "—") },
  { key: "avg_cost", label: "Avg cost / share", fmt: (v) => fmtPrice(v) },
];

function MetricsTable({ r }: { r: BacktestResults }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Metric</TableHead>
          <TableHead className="text-right">Rule</TableHead>
          <TableHead className="text-right">DCA baseline</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {METRICS.map((m) => {
          const a = r.rule[m.key];
          const b = r.baseline[m.key];
          const signed = m.key === "return_pct";
          return (
            <TableRow key={m.key}>
              <TableCell className="text-xs text-muted-foreground">{m.label}</TableCell>
              <TableCell className="text-right font-medium">
                {signed ? <Signed value={Number(a)}>{m.fmt(a)}</Signed> : m.fmt(a)}
              </TableCell>
              <TableCell className="text-right">
                {signed ? <Signed value={Number(b)}>{m.fmt(b)}</Signed> : m.fmt(b)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function TradesCard({ trades }: { trades: BacktestResults["trades"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Trades ({trades.length})</CardTitle>
      </CardHeader>
      <CardContent className="max-h-[28rem] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
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
              <TableEmpty colSpan={8}>No trades in this period</TableEmpty>
            ) : (
              trades.map((t, i) => (
                <TableRow key={`${t.placed_date}-${t.tier}-${i}`}>
                  <TableCell className="text-xs">{t.placed_date}</TableCell>
                  <TableCell className="text-xs">{t.session_date}</TableCell>
                  <TableCell>T{t.tier}</TableCell>
                  <TableCell className="text-right">{fmtNum(t.qty)}</TableCell>
                  <TableCell className="text-right">{fmtPrice(t.limit_price)}</TableCell>
                  <TableCell className="text-right">{fmtPrice(t.fill_price)}</TableCell>
                  <TableCell className="text-right">{fmtUsd(t.cost)}</TableCell>
                  <TableCell>
                    <Badge variant={t.status === "FILLED" ? "success" : "outline"}>{humanize(t.status)}</Badge>
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

function DecisionsCard({ decisions }: { decisions: Record<string, number> }) {
  const entries = Object.entries(decisions).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Decisions</CardTitle>
        <CardDescription>{total} session evaluations</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-1">
        {entries.map(([k, n]) => (
          <div key={k} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate" title={k}>
              {humanize(k)}
            </span>
            <span className="font-medium tabular-nums">{n}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
