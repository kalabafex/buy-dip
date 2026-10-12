import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type Schemas } from "@/api/client";
import { qk, useRules } from "@/api/queries";
import { DecisionBadge } from "@/components/badges";
import { ErrorBox, PageHeader } from "@/components/common";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EnabledToggle } from "@/components/rules/EnabledToggle";
import { tiersSummary, triggerSummary } from "@/components/rules/ruleSchema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtPct, fmtPrice, fmtRelative, tierLabel } from "@/lib/format";
import { useNow } from "@/lib/hooks";

export function RulesPage() {
  const rules = useRules();
  const [toDelete, setToDelete] = useState<Schemas["RuleOut"] | null>(null);
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (id: string) => api.delete("/api/rules/{rule_id}", { path: { rule_id: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.rules }),
  });

  return (
    <div>
      <PageHeader
        title="Rules"
        subtitle="Buy-the-dip rules evaluated by the worker."
        actions={
          <Button size="sm" asChild>
            <Link to="/rules/new">
              <Plus /> New rule
            </Link>
          </Button>
        }
      />
      <ErrorBox error={rules.error} className="mb-3" />
      <Card>
        <CardContent className="pt-2">
          <RulesTable rules={rules.data} loading={rules.isPending} onDelete={setToDelete} />
        </CardContent>
      </Card>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete rule ${toDelete?.symbol ?? ""}?`}
        description="The rule is disabled and removed from the list. Its order and evaluation history is kept."
        confirmLabel="Delete"
        destructive
        onConfirm={() => (toDelete ? del.mutateAsync(toDelete.id) : undefined)}
      />
    </div>
  );
}

function RulesTable({
  rules,
  loading,
  onDelete,
}: {
  rules: Schemas["RuleOut"][] | undefined;
  loading: boolean;
  onDelete: (r: Schemas["RuleOut"]) => void;
}) {
  const now = useNow(60_000);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Symbol</TableHead>
          <TableHead>Enabled</TableHead>
          <TableHead>Trigger</TableHead>
          <TableHead>Tiers</TableHead>
          <TableHead>Last evaluation</TableHead>
          <TableHead className="text-right">Next tier</TableHead>
          <TableHead className="text-right">Distance</TableHead>
          <TableHead className="w-0" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {!rules?.length ? (
          <TableEmpty colSpan={8}>
            {loading ? "Loading…" : (
              <>
                No rules yet. <Link to="/rules/new" className="underline">Create one</Link>.
              </>
            )}
          </TableEmpty>
        ) : (
          rules.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-semibold">
                <Link to={`/rules/${r.id}`} className="hover:underline">
                  {r.symbol}
                </Link>
              </TableCell>
              <TableCell>
                <EnabledToggle rule={r} />
              </TableCell>
              <TableCell className="text-xs">{triggerSummary(r)}</TableCell>
              <TableCell className="text-xs">
                {tiersSummary(r.tiers)}
                {r.tiers_filled && r.tiers_filled.length > 0 && (
                  <span className="ml-1 text-green-700 dark:text-green-400">
                    ({r.tiers_filled.map(tierLabel).join(", ")} filled)
                  </span>
                )}
              </TableCell>
              <TableCell>
                {r.last_evaluation ? (
                  <div className="flex items-center gap-2">
                    <DecisionBadge decision={r.last_evaluation.decision} />
                    <span className="text-xs text-muted-foreground">
                      {fmtRelative(r.last_evaluation.ts, now)}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">never</span>
                )}
              </TableCell>
              <TableCell className="text-right text-xs">
                {r.next_tier != null ? `${tierLabel(r.next_tier)} @ ${fmtPrice(r.next_tier_price)}` : "—"}
              </TableCell>
              <TableCell className="text-right">{fmtPct(r.distance_to_next_tier_pct)}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Button size="icon" variant="ghost" asChild aria-label={`Edit ${r.symbol}`}>
                    <Link to={`/rules/${r.id}/edit`}>
                      <Pencil />
                    </Link>
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={`Delete ${r.symbol}`} onClick={() => onDelete(r)}>
                    <Trash2 />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
