import { ArrowLeft, CandlestickChart, FlaskConical, Pencil, SearchX } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { isApiError, type Schemas } from "@/api/client";
import { useEvaluations, useOrders, useRule, useRuleChart } from "@/api/queries";
import { DecisionBadge, EnabledChip } from "@/components/badges";
import { RuleChart } from "@/components/charts/RuleChart";
import { EmptyState, ErrorBox, Fact, PageHeader, PageSkeleton, Spinner } from "@/components/common";
import { Pagination } from "@/components/Pagination";
import { DistanceToTier } from "@/components/rules/DistanceToTier";
import { EnabledToggle } from "@/components/rules/EnabledToggle";
import { SavedRulePreview } from "@/components/rules/RulePreviewPanel";
import { TierLadder } from "@/components/rules/TierLadder";
import { fromRule, TREND_LABELS, triggerSummary } from "@/components/rules/ruleSchema";
import { EvaluationsTable } from "@/components/tables/EvaluationsTable";
import { OrdersTable } from "@/components/tables/OrdersTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeaderRow } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtPct, fmtPrice, fmtRelative, fmtUsd, tierLabel } from "@/lib/format";
import type { BacktestPrefill } from "@/pages/Backtest";

const DAY_OPTIONS = [90, 180, 365] as const;
const PAGE = 25;

export function RuleDetailPage() {
  const { id } = useParams();
  const rule = useRule(id);
  if (rule.isPending) return <PageSkeleton />;
  if (rule.isError) {
    return isApiError(rule.error, 404) ? (
      <EmptyState
        icon={SearchX}
        title="Rule not found"
        description="It may have been deleted."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/rules">Back to rules</Link>
          </Button>
        }
      />
    ) : (
      <ErrorBox error={rule.error} />
    );
  }
  return <RuleDetail rule={rule.data} />;
}

function RuleDetail({ rule }: { rule: Schemas["RuleOut"] }) {
  const ev = rule.last_evaluation;
  const backtestState: BacktestPrefill = { params: fromRule(rule), source: `rule ${rule.symbol}` };
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        eyebrow={
          <Link
            to="/rules"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Rules
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {rule.symbol}
            <EnabledChip enabled={rule.enabled ?? false} />
          </span>
        }
        subtitle={`${triggerSummary(rule)} · trend filter: ${TREND_LABELS[rule.trend_filter ?? "ABOVE_200DMA"].toLowerCase()}`}
        actions={
          <>
            <label className="flex h-8 items-center gap-2 rounded-md border bg-card px-3 text-xs font-medium">
              Enabled <EnabledToggle rule={rule} />
            </label>
            <Button variant="outline" size="sm" asChild>
              <Link to="/backtest" state={backtestState}>
                <FlaskConical /> Backtest
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link to={`/rules/${rule.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 pt-4 sm:pt-4 md:grid-cols-4 xl:grid-cols-7">
          <Fact label="Last price">{fmtPrice(ev?.last_price)}</Fact>
          <Fact label="Pullback">{ev?.pullback_pct != null ? fmtPct(ev.pullback_pct) : "—"}</Fact>
          <Fact label="Last decision">
            {ev ? (
              <span className="flex items-center gap-1.5">
                <DecisionBadge decision={ev.decision} />
                <span className="text-2xs font-normal text-muted-foreground">{fmtRelative(ev.ts)}</span>
              </span>
            ) : (
              "Not evaluated"
            )}
          </Fact>
          <Fact label="Cycle ref high">{fmtPrice(rule.active_cycle_ref_high)}</Fact>
          <Fact label="Max position">{fmtUsd(rule.max_position_usd, { compact: true })}</Fact>
          <Fact label="Confirm · cooldown">
            {rule.confirm_evals ?? 2}× · {rule.cooldown_days ?? 5} days
          </Fact>
          <Fact label="Limit offset">{fmtPct(rule.limit_offset_pct, 2)}</Fact>
          <div className="col-span-2 md:col-span-4 xl:col-span-7 grid gap-4 border-t pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
            <div className="grid gap-1.5">
              <div className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                Next tier
              </div>
              <DistanceToTier rule={rule} className="max-w-md" />
            </div>
            <div className="grid gap-1.5">
              <div className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                Tier ladder
                {rule.tiers_filled?.length ? ` · ${rule.tiers_filled.map(tierLabel).join(", ")} filled` : ""}
              </div>
              <TierLadder tiers={rule.tiers} filled={rule.tiers_filled} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ChartCard rule={rule} />
        <SavedRulePreview id={rule.id} triggerType={rule.trigger_type} />
      </div>
      <RuleEvaluations ruleId={rule.id} />
      <RuleOrders ruleId={rule.id} />
    </div>
  );
}

function ChartCard({ rule }: { rule: Schemas["RuleOut"] }) {
  const [days, setDays] = useState<number>(180);
  const chart = useRuleChart(rule.id, days);
  return (
    <Card>
      <CardHeaderRow
        title={
          <>
            <CandlestickChart className="h-4 w-4 text-muted-foreground" aria-hidden /> Price &amp; tiers
            {chart.isFetching && chart.data && <Spinner className="h-3 w-3 text-muted-foreground" />}
          </>
        }
        description="Daily candles with the rule's reference lines; hover for values."
        actions={
          <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <TabsList aria-label="Chart range">
              {DAY_OPTIONS.map((d) => (
                <TabsTrigger key={d} value={String(d)}>
                  {d === 365 ? "1Y" : `${d / 30}M`}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />
      <CardContent>
        <ErrorBox error={chart.error} className="mb-2" />
        {chart.data ? (
          chart.data.bars.length ? (
            <div className={chart.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
              <RuleChart data={chart.data} lookbackDays={rule.lookback_days} />
            </div>
          ) : (
            <EmptyState
              icon={CandlestickChart}
              title="No price data"
              description="Market data is not available for this symbol yet."
            />
          )
        ) : (
          chart.isPending && <Skeleton className="h-[340px] w-full sm:h-[460px]" />
        )}
      </CardContent>
    </Card>
  );
}

function RuleEvaluations({ ruleId }: { ruleId: string }) {
  const [offset, setOffset] = useState(0);
  const [triggeredOnly, setTriggeredOnly] = useState(false);
  const q = useEvaluations({ rule_id: ruleId, limit: PAGE, offset, triggered_only: triggeredOnly });
  return (
    <Card>
      <CardHeaderRow
        title="Evaluation log"
        description="Every worker check of this rule, with the decision and why."
        actions={
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={triggeredOnly}
              onCheckedChange={(v) => {
                setTriggeredOnly(v);
                setOffset(0);
              }}
              aria-label="Show only evaluations that reached a tier"
            />
            Reached a tier only
          </label>
        }
      />
      <CardContent>
        <ErrorBox error={q.error} />
        <EvaluationsTable
          evaluations={q.data?.items}
          loading={q.isPending}
          showSymbol={false}
          detailed
          empty={
            triggeredOnly
              ? "No evaluation reached a tier yet."
              : "Not evaluated yet. Enabled rules are checked during market hours."
          }
        />
        {q.data && <Pagination total={q.data.total} limit={PAGE} offset={offset} onOffset={setOffset} />}
      </CardContent>
    </Card>
  );
}

function RuleOrders({ ruleId }: { ruleId: string }) {
  const [offset, setOffset] = useState(0);
  const q = useOrders({ rule_id: ruleId, limit: PAGE, offset });
  return (
    <Card>
      <CardHeaderRow title="Orders" />
      <CardContent>
        <ErrorBox error={q.error} />
        <OrdersTable orders={q.data?.items} loading={q.isPending} showSymbol={false} />
        {q.data && <Pagination total={q.data.total} limit={PAGE} offset={offset} onOffset={setOffset} />}
      </CardContent>
    </Card>
  );
}
