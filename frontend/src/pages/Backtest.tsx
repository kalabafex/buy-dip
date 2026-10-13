import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical, History } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { qk, useBacktest } from "@/api/queries";
import { BacktestForm } from "@/components/backtest/BacktestForm";
import { BacktestResultView } from "@/components/backtest/BacktestResultView";
import { RecentBacktests } from "@/components/backtest/RecentBacktests";
import { Callout, ErrorBox, PageHeader } from "@/components/common";
import type { RuleFormValues } from "@/components/rules/ruleSchema";
import { Card, CardContent, CardHeaderRow } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Router state accepted by /backtest to prefill ad-hoc params (e.g. from a recommendation). */
export type BacktestPrefill = {
  params: RuleFormValues;
  source: string;
  start_date?: string;
  end_date?: string;
};

export function BacktestPage() {
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selected = params.get("id");
  const bt = useBacktest(selected);
  const incoming = (location.state as BacktestPrefill | null) ?? null;
  const [prefill, setPrefill] = useState<{
    n: number;
    values: RuleFormValues;
    source?: string;
    start?: string;
    end?: string;
  } | null>(() =>
    incoming?.params
      ? {
          n: 1,
          values: incoming.params,
          source: incoming.source,
          start: incoming.start_date,
          end: incoming.end_date,
        }
      : null,
  );
  const open = (id: string) => setParams({ id });
  const status = bt.data?.status;

  // Consume the router state so a reload doesn't re-apply it.
  useEffect(() => {
    if (incoming) navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [incoming, navigate, location.pathname, location.search]);

  // Refresh the list when the polled backtest changes state (in case SSE is down).
  useEffect(() => {
    if (status) void qc.invalidateQueries({ queryKey: qk.backtests, exact: true });
  }, [status, qc]);

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        title="Backtest"
        subtitle="Daily-bar simulation of a rule versus a monthly dollar-cost-averaging (DCA) baseline that invests the same total."
      />
      <Card>
        <CardHeaderRow
          title={
            <>
              <FlaskConical className="h-4 w-4 text-muted-foreground" aria-hidden /> New backtest
            </>
          }
          description="Use a saved rule or try parameters without saving them."
        />
        <CardContent className="grid gap-4">
          {prefill?.source && (
            <Callout tone="info" title={`Prefilled from ${prefill.source}`}>
              Adjust anything below, then run. Nothing is saved as a rule.
            </Callout>
          )}
          <BacktestForm
            key={prefill?.n ?? 0}
            onCreated={open}
            initialParams={prefill?.values}
            initialRange={
              prefill?.start && prefill.end ? { start: prefill.start, end: prefill.end } : undefined
            }
          />
        </CardContent>
      </Card>
      {selected &&
        (bt.isPending ? (
          <Skeleton className="h-96 rounded-xl" />
        ) : bt.isError ? (
          <ErrorBox error={bt.error} />
        ) : (
          <BacktestResultView
            bt={bt.data}
            onRerun={(values) => {
              setPrefill((p) => ({ n: (p?.n ?? 0) + 1, values, source: "a previous backtest" }));
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        ))}
      <Card>
        <CardHeaderRow
          title={
            <>
              <History className="h-4 w-4 text-muted-foreground" aria-hidden /> Recent backtests
            </>
          }
        />
        <CardContent>
          <RecentBacktests selected={selected} onOpen={open} />
        </CardContent>
      </Card>
    </div>
  );
}
