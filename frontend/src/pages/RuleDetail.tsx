import { ArrowLeft, Pencil } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { isApiError, type Schemas } from "@/api/client";
import { useEvaluations, useOrders, useRule, useRuleChart } from "@/api/queries";
import { RuleChart } from "@/components/charts/RuleChart";
import { ErrorBox, Loading, PageHeader, Spinner } from "@/components/common";
import { Pagination } from "@/components/Pagination";
import { EnabledToggle } from "@/components/rules/EnabledToggle";
import { SavedRulePreview } from "@/components/rules/RulePreviewPanel";
import { tiersSummary, TREND_LABELS, triggerSummary } from "@/components/rules/ruleSchema";
import { EvaluationsTable } from "@/components/tables/EvaluationsTable";
import { OrdersTable } from "@/components/tables/OrdersTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtPct, fmtPrice, fmtUsd } from "@/lib/format";

const DAY_OPTIONS = [90, 180, 365] as const;
const PAGE = 25;

export function RuleDetailPage() {
  const { id } = useParams();
  const rule = useRule(id);
  if (rule.isPending) return <Loading />;
  if (rule.isError) {
    return isApiError(rule.error, 404) ? (
      <p className="text-sm">
        Rule not found. <Link to="/rules" className="underline">Back to rules</Link>
      </p>
    ) : (
      <ErrorBox error={rule.error} />
    );
  }
  return <RuleDetail rule={rule.data} />;
}

function RuleDetail({ rule }: { rule: Schemas["RuleOut"] }) {
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {rule.symbol} <EnabledToggle rule={rule} />
          </span>
        }
        subtitle={`${triggerSummary(rule)} · ${tiersSummary(rule.tiers)} · max ${fmtUsd(rule.max_position_usd, { compact: true })}`}
        actions={
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/rules">
                <ArrowLeft /> Rules
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/rules/${rule.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ChartCard rule={rule} />
        <div className="grid grid-cols-1 content-start gap-4">
          <RuleFacts rule={rule} />
          <SavedRulePreview id={rule.id} triggerType={rule.trigger_type} />
        </div>
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
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          Price {chart.isFetching && <Spinner className="h-3 w-3" />}
        </CardTitle>
        <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <TabsList>
            {DAY_OPTIONS.map((d) => (
              <TabsTrigger key={d} value={String(d)}>
                {d}d
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <ErrorBox error={chart.error} className="mb-2" />
        {chart.data ? (
          chart.data.bars.length ? (
            <RuleChart data={chart.data} lookbackDays={rule.lookback_days} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No price data.</p>
          )
        ) : (
          chart.isPending && <Loading label="Loading chart…" />
        )}
      </CardContent>
    </Card>
  );
}

function RuleFacts({ rule }: { rule: Schemas["RuleOut"] }) {
  const facts: [string, string][] = [
    ["Trend filter", TREND_LABELS[rule.trend_filter ?? "ABOVE_200DMA"]],
    ["Confirm evals", String(rule.confirm_evals ?? 2)],
    ["Cooldown", `${rule.cooldown_days ?? 5} days`],
    ["Limit offset", fmtPct(rule.limit_offset_pct, 2)],
    ["Active cycle ref high", fmtPrice(rule.active_cycle_ref_high)],
    [
      "Next tier",
      rule.next_tier != null
        ? `T${rule.next_tier + 1} @ ${fmtPrice(rule.next_tier_price)} (${fmtPct(rule.distance_to_next_tier_pct)} away)`
        : "—",
    ],
  ];
  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <div className="text-[11px] text-muted-foreground">{k}</div>
            <div className="truncate font-medium">{v}</div>
          </div>
        ))}
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
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>Evaluation log</CardTitle>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={triggeredOnly}
            onChange={(e) => {
              setTriggeredOnly(e.target.checked);
              setOffset(0);
            }}
          />
          Triggered only
        </label>
      </CardHeader>
      <CardContent>
        <ErrorBox error={q.error} />
        <EvaluationsTable evaluations={q.data?.items} loading={q.isPending} showSymbol={false} detailed />
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
      <CardHeader>
        <CardTitle>Orders</CardTitle>
      </CardHeader>
      <CardContent>
        <ErrorBox error={q.error} />
        <OrdersTable orders={q.data?.items} loading={q.isPending} showSymbol={false} />
        {q.data && <Pagination total={q.data.total} limit={PAGE} offset={offset} onOffset={setOffset} />}
      </CardContent>
    </Card>
  );
}
