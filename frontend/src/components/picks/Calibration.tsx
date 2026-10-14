import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Database, Loader2, RefreshCw } from "lucide-react";
import { api, type Schemas } from "@/api/client";
import { qk } from "@/api/queries";
import { JobStatusBadge } from "@/components/badges";
import { Spinner } from "@/components/common";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ageMs } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { toast } from "@/lib/toast";

type Model = Schemas["PickModelOut"];

function elapsed(ms: number | null): string {
  if (ms === null || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** "Calibrate now" / "Recalibrate": queues a calibration (the worker picks it up). */
export function CalibrateButton({
  children = "Calibrate now",
  ...props
}: ButtonProps & { children?: React.ReactNode }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.post("/api/picks/model/calibrate"),
    onSuccess: (row) => {
      qc.setQueryData(qk.picksModel, row);
      void qc.invalidateQueries({ queryKey: qk.picks });
      toast.success(
        row.status === "RUNNING" ? "Calibration already running" : "Calibration queued",
        "The worker downloads ~5 years of daily bars and backtests every setup; this takes a few minutes.",
      );
    },
    onError: (e) => toast.error("Could not queue a calibration", e),
  });
  return (
    <Button {...props} onClick={() => m.mutate()} disabled={m.isPending || props.disabled}>
      {m.isPending ? <Spinner /> : <RefreshCw />} {children}
    </Button>
  );
}

/** Live progress of a queued/running calibration (SSE + 5 s polling). */
export function CalibrationProgress({ model, compact = false }: { model: Model; compact?: boolean }) {
  const now = useNow(1_000);
  const queued = model.status === "QUEUED";
  const pct = queued ? 0 : Math.max(2, model.progress);
  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
          <span className="text-sm font-semibold">{queued ? "Calibration queued" : "Calibrating setups"}</span>
          <JobStatusBadge status={model.status} />
        </div>
        <span className="num text-xs text-muted-foreground">
          {queued ? "" : `${model.progress}% · `}
          {elapsed(ageMs(model.created_at, now))} elapsed
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-primary/15"
        role="progressbar"
        aria-label="Calibration progress"
        aria-valuenow={queued ? 0 : model.progress}
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
      {!compact && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {queued
            ? "Waiting for the worker to pick this up…"
            : "Downloading about 5 years of daily bars for ~500 stocks and backtesting every setup × exit combination. This takes a few minutes; you can leave this page."}
        </p>
      )}
    </div>
  );
}

/** First run: nothing to pick from until a calibration has finished. */
export function NoModelCard({ running, failed }: { running: Model | null; failed?: Model | null }) {
  return (
    <Card>
      <CardContent className="grid gap-5 pt-6 sm:pt-6">
        <div className="flex flex-col items-center text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Database className="h-5 w-5" aria-hidden />
          </div>
          <p className="text-sm font-medium">The picks model has not been calibrated yet</p>
          <p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">
            Before it can publish picks, the app backtests its five setups on about 5 years of daily bars for
            ~500 S&amp;P 500 stocks and keeps only those that held up on later, unseen data. The worker
            downloads the data and runs it in the background — it takes a few minutes and then repeats
            weekly.
          </p>
          {failed?.error && !running && (
            <p className="mt-2 max-w-lg text-xs text-loss">Last calibration failed: {failed.error}</p>
          )}
          {!running && <CalibrateButton className="mt-4" />}
        </div>
        {running && (
          <div className="mx-auto w-full max-w-xl">
            <CalibrationProgress model={running} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
