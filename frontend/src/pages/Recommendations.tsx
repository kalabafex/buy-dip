import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, SearchX, Sparkles, XCircle } from "lucide-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { isApiError } from "@/api/client";
import { qk, useRecommendation } from "@/api/queries";
import { EmptyState, ErrorBox, PageHeader } from "@/components/common";
import { RecommendationForm } from "@/components/recommendations/RecommendationForm";
import { ResultsView } from "@/components/recommendations/ResultsView";
import { RunHistory } from "@/components/recommendations/RunHistory";
import { RunProgress } from "@/components/recommendations/RunProgress";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeaderRow } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDateTime } from "@/lib/format";
import { useMediaQuery } from "@/lib/hooks";

export function RecommendationsPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selected = params.get("id");
  const run = useRecommendation(selected);
  const open = (id: string) => setParams({ id });
  const status = run.data?.status;
  const wide = useMediaQuery("(min-width: 1280px)");
  const history = (
    <RunHistory selected={selected} onOpen={open} onDeleted={(id) => id === selected && setParams({})} />
  );

  // Refresh the history list when the polled run changes state (in case SSE is down).
  useEffect(() => {
    if (status) void qc.invalidateQueries({ queryKey: qk.recommendations, exact: true });
  }, [status, qc]);

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        title="Recommendations"
        subtitle="Test dozens of dip-buying rules against a symbol's own history and see which ones beat monthly dollar-cost averaging consistently, then turn one into a rule."
      />
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="grid gap-5 xl:sticky xl:top-20">
          <Card>
            <CardHeaderRow
              title={
                <>
                  <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Analyze a symbol
                </>
              }
              description="Runs on the worker; you can leave this page and come back."
            />
            <CardContent>
              <RecommendationForm onCreated={(id) => open(id)} />
            </CardContent>
          </Card>
          {wide && history}
        </div>

        <div className="grid min-w-0 gap-5">
          {!selected ? (
            <Card>
              <EmptyState
                icon={BarChart3}
                title="Pick a symbol to analyze"
                description="We backtest about 40 rule variants (RSI, pullback and moving-average triggers with different tier ladders) over rolling 3-year windows, then rank them by how reliably they beat DCA before and after a split date."
                className="py-14"
              />
            </Card>
          ) : run.isPending ? (
            <div className="grid gap-5">
              <Skeleton className="h-40 rounded-xl" />
              <Skeleton className="h-80 rounded-xl" />
            </div>
          ) : run.isError ? (
            isApiError(run.error, 404) ? (
              <Card>
                <EmptyState
                  icon={SearchX}
                  title="Run not found"
                  description="It may have been deleted."
                  actions={
                    <Button size="sm" variant="outline" onClick={() => setParams({})}>
                      Start a new analysis
                    </Button>
                  }
                />
              </Card>
            ) : (
              <ErrorBox error={run.error} />
            )
          ) : run.data.status === "QUEUED" || run.data.status === "RUNNING" ? (
            <RunProgress run={run.data} />
          ) : run.data.status === "FAILED" ? (
            <Card className="border-loss/30">
              <EmptyState
                icon={XCircle}
                title={`Analysis of ${run.data.symbol} failed`}
                description={
                  <>
                    <span className="block font-medium text-foreground">
                      {run.data.error ?? "Unknown error"}
                    </span>
                    <span className="mt-1 block">
                      Started {fmtDateTime(run.data.created_at)} with {run.data.years} years of history.
                      Symbols with a short listing history need fewer years, or may not have enough data at
                      all.
                    </span>
                  </>
                }
              />
            </Card>
          ) : run.data.results ? (
            <ResultsView run={run.data} results={run.data.results} />
          ) : (
            <ErrorBox error={new Error("This run finished without results.")} />
          )}
        </div>

        {!wide && history}
      </div>
    </div>
  );
}
