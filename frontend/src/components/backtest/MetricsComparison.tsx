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

type Col = "rule" | "dca" | "hold";

type Row = {
  label: string;
  values: Partial<Record<Col, string>>;
  /** Column with the best value (bold); null = no winner shown. */
  better?: Col | null;
};

/** Best column among the numeric values; null when tied or incomplete. */
function best(vals: Partial<Record<Col, number | null>>, higherIsBetter: boolean): Col | null {
  const entries = Object.entries(vals).filter(
    (e): e is [Col, number] => e[1] !== null && e[1] !== undefined && Number.isFinite(e[1]),
  );
  if (entries.length < 2) return null;
  const [first, second] = [...entries].sort((a, b) => (higherIsBetter ? b[1] - a[1] : a[1] - b[1]));
  if (!first || !second || first[1] === second[1]) return null;
  return first[0];
}

const n = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));

const COL_LABEL: Record<Col, string> = { rule: "Rule", dca: "DCA", hold: "Buy & hold" };

/**
 * Rule vs monthly DCA vs buy-and-hold: headline returns side by side, then a compact table.
 * ``hold`` is optional because results computed before it existed do not have it.
 */
export function MetricsComparison({
  rule,
  baseline,
  hold,
  compact = false,
}: {
  rule: Metrics;
  baseline: Metrics;
  hold?: Metrics | null;
  compact?: boolean;
}) {
  const cols: Col[] = hold ? ["rule", "dca", "hold"] : ["rule", "dca"];
  const m: Record<Col, Metrics | null | undefined> = { rule, dca: baseline, hold };
  const pick = (f: (x: Metrics) => string | null) =>
    Object.fromEntries(cols.map((c) => [c, m[c] ? f(m[c] as Metrics) : null])) as Partial<
      Record<Col, string | null>
    >;
  const fmtAll = (f: (x: Metrics) => string) =>
    Object.fromEntries(cols.map((c) => [c, m[c] ? f(m[c] as Metrics) : "—"])) as Partial<Record<Col, string>>;
  const nums = (vals: Partial<Record<Col, string | null>>, abs = false) =>
    Object.fromEntries(
      Object.entries(vals).map(([k, v]) => {
        const x = n(v);
        return [k, x === null ? null : abs ? Math.abs(x) : x];
      }),
    ) as Partial<Record<Col, number | null>>;

  const rows: Row[] = [
    { label: "Invested", values: fmtAll((x) => fmtUsd(x.total_invested, { compact: true })) },
    { label: "Final value", values: fmtAll((x) => fmtUsd(x.final_value, { compact: true })) },
    {
      label: "Return",
      values: fmtAll((x) => fmtPct(x.return_pct, 1, true)),
      better: best(nums(pick((x) => x.return_pct)), true),
    },
    {
      label: "Avg cost / share",
      values: fmtAll((x) => fmtPrice(x.avg_cost)),
      better: best(nums(pick((x) => x.avg_cost)), false),
    },
    {
      label: "Max drawdown",
      values: fmtAll((x) => fmtPct(x.max_drawdown_pct, 1)),
      better: best(
        nums(
          pick((x) => x.max_drawdown_pct),
          true,
        ),
        false,
      ),
    },
    { label: "Buys", values: fmtAll((x) => fmtNum(x.num_buys)) },
  ];
  const vsDca = Number(rule.return_pct) - Number(baseline.return_pct);
  const vsHold = hold ? Number(rule.return_pct) - Number(hold.return_pct) : null;
  return (
    <div className="grid content-start gap-4">
      <div className={cn("grid gap-2", hold ? "grid-cols-1 min-[420px]:grid-cols-3" : "grid-cols-2")}>
        <ReturnTile label="Rule return" value={Number(rule.return_pct)} tone="rule" />
        <ReturnTile label="Monthly DCA return" value={Number(baseline.return_pct)} tone="dca" />
        {hold && <ReturnTile label="Buy & hold return" value={Number(hold.return_pct)} tone="hold" />}
      </div>
      <p className="text-xs text-muted-foreground">
        Returns on the same invested dollars. The rule is{" "}
        <Signed value={vsDca} className="font-semibold">
          {fmtPts(vsDca)}
        </Signed>{" "}
        {vsDca >= 0 ? "ahead of" : "behind"} monthly DCA
        {vsHold !== null && (
          <>
            {" "}
            and{" "}
            <Signed value={vsHold} className="font-semibold">
              {fmtPts(vsHold)}
            </Signed>{" "}
            {vsHold >= 0 ? "ahead of" : "behind"} buying everything on day one and holding
          </>
        )}
        .
      </p>
      {!compact && (
        <table className="num w-full text-sm">
          <thead>
            <tr className="border-b text-2xs uppercase tracking-wider text-muted-foreground">
              <th className="pb-2 text-left font-medium">Metric</th>
              {cols.map((c) => (
                <th key={c} className="pb-2 text-right font-medium">
                  {COL_LABEL[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-border/60 last:border-0">
                <td className="py-2 text-xs text-muted-foreground">{r.label}</td>
                {cols.map((c) => (
                  <td
                    key={c}
                    className={cn(
                      "py-2 text-right",
                      c !== "rule" && "text-muted-foreground",
                      r.better === c && "font-semibold text-foreground",
                    )}
                  >
                    {r.values[c]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const SWATCH: Record<Col, string> = {
  rule: "bg-primary",
  dca: "bg-muted-foreground/60",
  hold: "bg-[var(--chart-hold)]",
};

function ReturnTile({ label, value, tone }: { label: string; value: number; tone: Col }) {
  const accent = tone === "rule";
  return (
    <div
      className={cn("rounded-lg border p-3", accent ? "border-primary/30 bg-primary/[0.05]" : "bg-muted/30")}
    >
      <div className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
        <span aria-hidden className={cn("h-0.5 w-3 rounded-full", SWATCH[tone])} />
        {label}
      </div>
      <Signed value={value} className="mt-1 block text-xl font-semibold tracking-tight">
        {fmtPct(value, 1, true)}
      </Signed>
    </div>
  );
}
