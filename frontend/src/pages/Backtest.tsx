import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { qk, useBacktest } from "@/api/queries";
import { BacktestForm } from "@/components/backtest/BacktestForm";
import { BacktestResultView } from "@/components/backtest/BacktestResultView";
import { RecentBacktests } from "@/components/backtest/RecentBacktests";
import { ErrorBox, Loading, PageHeader } from "@/components/common";
import type { RuleFormValues } from "@/components/rules/ruleSchema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function BacktestPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selected = params.get("id");
  const bt = useBacktest(selected);
  const [prefill, setPrefill] = useState<{ n: number; values: RuleFormValues } | null>(null);
  const open = (id: string) => setParams({ id });
  const status = bt.data?.status;

  // Refresh the list when the polled backtest changes state (in case SSE is down).
  useEffect(() => {
    if (status) void qc.invalidateQueries({ queryKey: qk.backtests, exact: true });
  }, [status, qc]);

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader
        title="Backtest"
        subtitle="Daily-bar simulation of a rule versus a monthly DCA baseline investing the same total."
      />
      <Card>
        <CardHeader>
          <CardTitle>New backtest</CardTitle>
        </CardHeader>
        <CardContent>
          <BacktestForm key={prefill?.n ?? 0} onCreated={open} initialParams={prefill?.values} />
        </CardContent>
      </Card>
      {selected &&
        (bt.isPending ? (
          <Loading label="Loading backtest…" />
        ) : bt.isError ? (
          <ErrorBox error={bt.error} />
        ) : (
          <BacktestResultView
            bt={bt.data}
            onRerun={(values) => {
              setPrefill((p) => ({ n: (p?.n ?? 0) + 1, values }));
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        ))}
      <Card>
        <CardHeader>
          <CardTitle>Recent backtests</CardTitle>
        </CardHeader>
        <CardContent>
          <RecentBacktests selected={selected} onOpen={open} />
        </CardContent>
      </Card>
    </div>
  );
}
