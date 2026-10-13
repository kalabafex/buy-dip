import { Signed } from "@/components/common";
import { fmtNum, fmtPct, fmtPrice, fmtPts, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Fields shared by backtest metrics and recommendation full-period metrics. */
export type Metrics = {
  total_invested: string;
  final_value: string;
  final_equity: string;
  return_pct: string;
  max_drawdown_pct: string;
  num_buys: number;
  avg_cost: string | null;
};

type Row = {
  label: string;
  rule: string;
  dca: string;
  /** Higher-is-better comparison for highlighting; null = no winner shown. */
  better?: "rule" | "dca" | null;
};

function winner(a: number | null, b: number | null, higherIsBetter: boolean): "rule" | "dca" | null {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  return a > b === higherIsBetter ? "rule" : "dca";
}

const n = (v: string | null) => (v === null ? null : Number(v));

/** Rule vs DCA: headline returns side by side, then a compact comparison table. */
export function MetricsComparison({
  rule,
  baseline,
  compact = false,
}: {
  rule: Metrics;
  baseline: Metrics;
  compact?: boolean;
}) {
  const edge = Number(rule.return_pct) - Number(baseline.return_pct);
  const rows: Row[] = [
    {
      label: "Invested",
      rule: fmtUsd(rule.total_invested, { compact: true }),
      dca: fmtUsd(baseline.total_invested, { compact: true }),
    },
    {
      label: "Final value",
      rule: fmtUsd(rule.final_value, { compact: true }),
      dca: fmtUsd(baseline.final_value, { compact: true }),
    },
    {
      label: "Avg cost / share",
      rule: fmtPrice(rule.avg_cost),
      dca: fmtPrice(baseline.avg_cost),
      better: winner(n(rule.avg_cost), n(baseline.avg_cost), false),
    },
    {
      label: "Max drawdown",
      rule: fmtPct(rule.max_drawdown_pct, 1),
      dca: fmtPct(baseline.max_drawdown_pct, 1),
      better: winner(
        Math.abs(Number(rule.max_drawdown_pct)),
        Math.abs(Number(baseline.max_drawdown_pct)),
        false,
      ),
    },
    { label: "Buys", rule: fmtNum(rule.num_buys), dca: fmtNum(baseline.num_buys) },
  ];
  return (
    <div className="grid content-start gap-4">
      <div className="grid grid-cols-2 gap-2">
        <ReturnTile label="Rule return" value={Number(rule.return_pct)} accent />
        <ReturnTile label="Monthly DCA return" value={Number(baseline.return_pct)} />
      </div>
      <p className="text-xs text-muted-foreground">
        Return on invested dollars. The rule is{" "}
        <Signed value={edge} className="font-semibold">
          {fmtPts(edge)}
        </Signed>{" "}
        {edge >= 0 ? "ahead of" : "behind"} DCA with the same total.
      </p>
      {!compact && (
        <table className="num w-full text-sm">
          <thead>
            <tr className="border-b text-2xs uppercase tracking-wider text-muted-foreground">
              <th className="pb-2 text-left font-medium">Metric</th>
              <th className="pb-2 text-right font-medium">Rule</th>
              <th className="pb-2 text-right font-medium">DCA</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-border/60 last:border-0">
                <td className="py-2 text-xs text-muted-foreground">{r.label}</td>
                <td className={cn("py-2 text-right", r.better === "rule" ? "font-semibold" : "")}>
                  {r.rule}
                </td>
                <td
                  className={cn(
                    "py-2 text-right text-muted-foreground",
                    r.better === "dca" && "font-semibold text-foreground",
                  )}
                >
                  {r.dca}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ReturnTile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className={cn("rounded-lg border p-3", accent ? "border-primary/30 bg-primary/[0.05]" : "bg-muted/30")}
    >
      <div className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
        <span
          aria-hidden
          className={cn("h-0.5 w-3 rounded-full", accent ? "bg-primary" : "bg-muted-foreground/60")}
        />
        {label}
      </div>
      <Signed value={value} className="mt-1 block text-xl font-semibold tracking-tight">
        {fmtPct(value, 1, true)}
      </Signed>
    </div>
  );
}
