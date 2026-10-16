import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { qk } from "@/api/queries";
import { ComparisonChart } from "@/components/charts/ComparisonChart";
import { Signed, Spinner } from "@/components/common";
import {
  ConfidenceBadge,
  StatBlock,
  TriggeringNow,
  WinRateBars,
  type RecItem,
} from "@/components/recommendations/parts";
import { TierLadder } from "@/components/rules/TierLadder";
import { fromParams, triggerSummary } from "@/components/rules/ruleSchema";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fmtMonth, fmtPct, fmtPts, fmtUsdShort, fmtUsdSigned } from "@/lib/format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { BacktestPrefill } from "@/pages/Backtest";

function paramsSummary(p: RecItem["params"]): string {
  const parts = [triggerSummary(p)];
  if (p.trigger_type !== "PULLBACK_FROM_HIGH") parts.push(`${p.lookback_days}d high reference`);
  parts.push(p.trend_filter === "NONE" ? "no trend filter" : "only above 200-day SMA");
  parts.push(`confirm ${p.confirm_evals}×`, `cooldown ${p.cooldown_days}d`);
  return parts.join(" · ");
}

/** Full-period result: rule vs DCA return side by side (rule can win windows yet trail here). */
function FullPeriod({ item }: { item: RecItem }) {
  const fp = item.full_period;
  const last = fp.profit_curve[fp.profit_curve.length - 1];
  const tiles = [
    {
      label: "Rule",
      ret: Number(fp.rule.return_pct),
      profit: last?.rule,
      swatch: "bg-primary",
      accent: true,
    },
    {
      label: "Monthly DCA",
      ret: Number(fp.baseline.return_pct),
      profit: last?.baseline,
      swatch: "bg-muted-foreground/60",
      accent: false,
    },
    ...(fp.hold
      ? [
          {
            label: "Buy & hold",
            ret: Number(fp.hold.return_pct),
            profit: last?.hold ?? null,
            swatch: "bg-[var(--chart-hold)]",
            accent: false,
          },
        ]
      : []),
  ];
  return (
    <div className={cn("grid gap-2", tiles.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {tiles.map((x) => (
        <div
          key={x.label}
          className={cn(
            "min-w-0 rounded-lg border px-3 py-2",
            x.accent ? "border-primary/30 bg-primary/[0.05]" : "bg-muted/30",
          )}
        >
          <div className="flex items-center gap-1.5 truncate text-2xs font-medium text-muted-foreground">
            <span aria-hidden className={cn("h-0.5 w-3 shrink-0 rounded-full", x.swatch)} />
            {x.label}
          </div>
          <Signed value={x.ret} className="block text-lg font-semibold tracking-tight">
            {fmtPct(x.ret, 1, true)}
          </Signed>
          <div className="num truncate text-2xs text-muted-foreground">
            {fmtUsdSigned(x.profit, { short: true })} profit
          </div>
        </div>
      ))}
    </div>
  );
}

export function RecommendationCard({
  item,
  rank,
  runId,
  splitDate,
  budgetPerDip,
  maxPosition,
  reference = false,
}: {
  item: RecItem;
  rank?: number;
  runId: string;
  splitDate: string | null;
  /** The run's budget per dip and position cap (used by the full-period simulation). */
  budgetPerDip: string;
  maxPosition: string;
  reference?: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const apply = useMutation({
    mutationFn: () =>
      api.post("/api/recommendations/{rec_id}/apply", {
        path: { rec_id: runId },
        body: { key: item.key, enabled: false },
      }),
    onSuccess: (rule) => {
      qc.setQueryData(qk.rule(rule.id), rule);
      void qc.invalidateQueries({ queryKey: qk.rules });
      toast.success(`Rule ${rule.symbol} created (disabled)`, "Review it, then enable it when you're ready.");
      navigate(`/rules/${rule.id}`);
    },
    onError: (e) => toast.error("Could not create the rule", e),
  });
  const prefill = fromParams(item.params);
  const backtestState: BacktestPrefill | null = prefill
    ? {
        params: prefill,
        source: `recommendation “${item.label}”`,
        start_date: item.full_period.start,
        end_date: item.full_period.end,
      }
    : null;
  const worst = Math.min(item.selection.worst_edge_pct, item.validation.worst_edge_pct);
  const top = rank === 1;

  return (
    <Card
      className={cn(
        "overflow-hidden",
        top && "border-primary/40 ring-1 ring-primary/20",
        reference && "border-dashed bg-muted/20 shadow-none",
      )}
    >
      <div className="flex flex-wrap items-start gap-3 border-b px-4 py-3.5 sm:px-5">
        {rank !== undefined ? (
          <span
            className={cn(
              "num flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
              top ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
            )}
            aria-label={`Rank ${rank}`}
          >
            {rank}
          </span>
        ) : (
          <span className="flex h-8 shrink-0 items-center rounded-full bg-muted px-2.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            Reference
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-5 sm:text-base">
            {item.label}
            {top && (
              <span className="ml-2 align-middle text-2xs font-semibold uppercase tracking-wider text-primary">
                Top pick
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{paramsSummary(item.params)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <ConfidenceBadge confidence={item.confidence} />
            <TriggeringNow current={item.current} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="grid content-start gap-5">
          <div>
            <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              Beat monthly DCA in 3-year windows
            </div>
            <WinRateBars selection={item.selection} validation={item.validation} splitDate={splitDate} />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
            <StatBlock
              label="Median edge"
              hint="Median return-on-invested minus DCA's, selection / validation windows"
              value={
                <span className="flex flex-col leading-tight">
                  <Signed value={item.validation.median_edge_pct}>
                    {fmtPts(item.validation.median_edge_pct)}
                  </Signed>
                  <span className="text-2xs font-normal text-muted-foreground">
                    sel {fmtPts(item.selection.median_edge_pct)}
                  </span>
                </span>
              }
            />
            <StatBlock
              label="Worst window"
              hint="Worst edge vs DCA in any window"
              value={<Signed value={worst}>{fmtPts(worst)}</Signed>}
            />
            <StatBlock
              label="Avg-cost edge"
              hint="Median % lower average cost per share than DCA"
              value={
                <Signed value={item.median_cost_advantage_pct}>
                  {fmtPct(item.median_cost_advantage_pct, 1, true)}
                </Signed>
              }
            />
            <StatBlock label="Buys / year" value={item.buys_per_year.toFixed(1)} />
          </div>
          <div>
            <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              Tier ladder
            </div>
            <TierLadder tiers={item.params.tiers} className="max-w-xs" />
          </div>
        </div>

        <div className="grid content-start gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              Whole period · {fmtMonth(item.full_period.start)} – {fmtMonth(item.full_period.end)}
            </div>
          </div>
          <FullPeriod item={item} />
          <ComparisonChart
            points={item.full_period.profit_curve}
            ruleLabel="Rule profit"
            baselineLabel="DCA profit"
            holdLabel="Buy & hold profit"
            format={(v) => fmtUsdSigned(v, { short: true })}
            zeroLine
            interactive={false}
            chartHeight="h-[190px] sm:h-[210px]"
          />
          <p className="text-2xs leading-4 text-muted-foreground">
            Profit at {fmtUsdShort(budgetPerDip)} per dip with a {fmtUsdShort(maxPosition)} position cap,
            versus monthly DCA and buying the stock on day one and holding it, both with the same dollars.
            Returns are on invested dollars.
          </p>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-5">
        <span className="text-2xs text-muted-foreground sm:mr-auto">
          Rules are created disabled so you can review them first.
        </span>
        {backtestState && (
          <Button variant="outline" size="sm" asChild>
            <Link to="/backtest" state={backtestState}>
              <FlaskConical /> Backtest
            </Link>
          </Button>
        )}
        <Button
          size="sm"
          variant={reference ? "outline" : "default"}
          onClick={() => apply.mutate()}
          disabled={apply.isPending}
        >
          {apply.isPending ? <Spinner /> : <Plus />} Create rule from this
        </Button>
      </div>
    </Card>
  );
}
