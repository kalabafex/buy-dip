import { Loader2 } from "lucide-react";
import type { Schemas } from "@/api/client";
import { JobStatusBadge } from "@/components/badges";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ageMs } from "@/lib/format";
import { useNow } from "@/lib/hooks";

function elapsed(ms: number | null): string {
  if (ms === null || ms < 0) return "";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** Live progress of a queued/running recommendation run (SSE + 2 s polling). */
export function RunProgress({ run }: { run: Schemas["RecommendationOut"] }) {
  const now = useNow(1_000);
  const queued = run.status === "QUEUED";
  const pct = queued ? 0 : Math.max(2, run.progress);
  return (
    <div className="grid gap-5">
      <Card>
        <CardContent className="grid gap-4 pt-5 sm:pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
              <span className="text-sm font-semibold">Analyzing {run.symbol}</span>
              <JobStatusBadge status={run.status} />
            </div>
            <span className="num text-xs text-muted-foreground">
              {elapsed(ageMs(run.created_at, now))} elapsed
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-primary/15"
            role="progressbar"
            aria-label="Analysis progress"
            aria-valuenow={queued ? 0 : run.progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={
                queued
                  ? "h-full w-1/4 animate-pulse rounded-full bg-primary/40"
                  : "h-full rounded-full bg-primary transition-[width] duration-700"
              }
              style={queued ? undefined : { width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {queued
              ? "Waiting for the worker to pick this up (it checks every ~10 seconds)…"
              : `Backtesting every candidate rule over rolling 3-year windows of ${run.years} years of ${run.symbol} history — ${run.progress}% done. A run usually takes 30 seconds to 3 minutes.`}
          </p>
        </CardContent>
      </Card>
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-64 rounded-xl" />
      ))}
    </div>
  );
}
