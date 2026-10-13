import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { History, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, type Schemas } from "@/api/client";
import { qk, useRecommendations } from "@/api/queries";
import { JobStatusBadge } from "@/components/badges";
import { EmptyState, ErrorBox } from "@/components/common";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeaderRow } from "@/components/ui/card";
import { SkeletonRows } from "@/components/ui/skeleton";
import { fmtDateTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const SHOWN = 8;

/**
 * Previous runs. The list endpoint omits results, so the top pick of each finished run
 * shown is read from its detail (cached; finished runs never change).
 */
export function RunHistory({
  selected,
  onOpen,
  onDeleted,
}: {
  selected: string | null;
  onOpen: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  const qc = useQueryClient();
  const runs = useRecommendations();
  const [all, setAll] = useState(false);
  const [toDelete, setToDelete] = useState<Schemas["RecommendationOut"] | null>(null);
  const list = runs.data ?? [];
  const shown = all ? list : list.slice(0, SHOWN);
  const details = useQueries({
    queries: shown
      .filter((r) => r.status === "DONE")
      .map((r) => ({
        queryKey: qk.recommendation(r.id),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          api.get("/api/recommendations/{rec_id}", { path: { rec_id: r.id }, signal }),
        staleTime: Infinity,
      })),
  });
  const topPick = new Map(
    details.flatMap((d) =>
      d.data?.results ? [[d.data.id, d.data.results.recommendations[0]?.label] as const] : [],
    ),
  );

  const del = useMutation({
    mutationFn: (id: string) => api.delete("/api/recommendations/{rec_id}", { path: { rec_id: id } }),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: qk.recommendation(id) });
      void qc.invalidateQueries({ queryKey: qk.recommendations, exact: true });
      toast.success("Run deleted");
      onDeleted(id);
    },
  });

  return (
    <Card>
      <CardHeaderRow
        title={
          <>
            <History className="h-4 w-4 text-muted-foreground" aria-hidden /> Previous runs
          </>
        }
      />
      <CardContent>
        <ErrorBox error={runs.error} />
        {runs.isPending ? (
          <SkeletonRows rows={3} />
        ) : !list.length ? (
          <EmptyState
            title="No runs yet"
            description="Your analyses appear here so you can reopen them."
            className="py-6"
          />
        ) : (
          <ul className="-mx-2 grid gap-0.5">
            {shown.map((r) => (
              <li key={r.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onOpen(r.id)}
                  aria-current={r.id === selected ? "true" : undefined}
                  className={cn(
                    "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-lg py-2 pl-2 pr-10 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    r.id === selected && "bg-primary/[0.07] hover:bg-primary/10",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{r.symbol}</span>
                    <span className="num text-2xs text-muted-foreground">{r.years}y</span>
                  </span>
                  <JobStatusBadge status={r.status} />
                  <span className="truncate text-2xs text-muted-foreground">
                    {r.status === "DONE"
                      ? (topPick.get(r.id) ?? "…")
                      : r.status === "FAILED"
                        ? (r.error ?? "Failed")
                        : r.status === "RUNNING"
                          ? `${r.progress}% done`
                          : "Waiting for worker"}
                  </span>
                  <span className="num text-2xs text-muted-foreground">{fmtDateTime(r.created_at)}</span>
                </button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-60 hover:bg-loss-soft hover:text-loss hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`Delete ${r.symbol} run from ${fmtDateTime(r.created_at)}`}
                  title="Delete run"
                  onClick={() => setToDelete(r)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {list.length > SHOWN && (
          <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setAll((a) => !a)}>
            {all ? "Show fewer" : `Show all ${list.length}`}
          </Button>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete the ${toDelete?.symbol ?? ""} run?`}
        description="The analysis and its results are removed. Rules you created from it are kept."
        confirmLabel="Delete run"
        destructive
        onConfirm={() => (toDelete ? del.mutateAsync(toDelete.id) : undefined)}
      />
    </Card>
  );
}
