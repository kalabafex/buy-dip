import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type Schemas } from "@/api/client";
import { qk, useRules } from "@/api/queries";
import { DecisionBadge } from "@/components/badges";
import { EmptyState, ErrorBox, PageHeader } from "@/components/common";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DistanceToTier } from "@/components/rules/DistanceToTier";
import { EnabledToggle } from "@/components/rules/EnabledToggle";
import { TierLadder } from "@/components/rules/TierLadder";
import { tiersSummary, triggerSummary } from "@/components/rules/ruleSchema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtPrice, fmtRelative, fmtUsdShort, tierLabel } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { toast } from "@/lib/toast";

export function RulesPage() {
  const rules = useRules();
  const [toDelete, setToDelete] = useState<Schemas["RuleOut"] | null>(null);
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (r: Schemas["RuleOut"]) => api.delete("/api/rules/{rule_id}", { path: { rule_id: r.id } }),
    onSuccess: (_d, r) => {
      toast.success(`Rule ${r.symbol} deleted`, "Its order and evaluation history is kept.");
      return qc.invalidateQueries({ queryKey: qk.rules });
    },
  });
  const list = rules.data ?? [];
  const enabled = list.filter((r) => r.enabled).length;

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        title="Rules"
        subtitle={
          rules.data
            ? `${list.length} rule${list.length === 1 ? "" : "s"} · ${enabled} enabled. The worker evaluates enabled rules during market hours.`
            : "Buy-the-dip rules evaluated by the worker."
        }
        actions={
          <>
            <Button size="sm" variant="outline" asChild>
              <Link to="/recommendations">
                <Sparkles /> Recommendations
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/rules/new">
                <Plus /> New rule
              </Link>
            </Button>
          </>
        }
      />
      <ErrorBox error={rules.error} />
      <Card>
        <CardContent className="pt-3 sm:pt-3">
          {rules.isPending ? (
            <SkeletonRows rows={4} className="py-3" />
          ) : !list.length ? (
            <EmptyState
              icon={ListChecks}
              title="No rules yet"
              description={
                <>
                  Start from a recommendation tested on the symbol's history, or build a rule from scratch.{" "}
                  <code className="whitespace-nowrap rounded bg-muted px-1 py-0.5 font-mono text-2xs">
                    just seed-rules
                  </code>{" "}
                  adds three researched presets.
                </>
              }
              actions={
                <>
                  <Button asChild size="sm">
                    <Link to="/recommendations">
                      <Sparkles /> Get recommendations
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/rules/new">
                      <Plus /> Create rule
                    </Link>
                  </Button>
                </>
              }
            />
          ) : (
            <>
              <RulesTable rules={list} onDelete={setToDelete} />
              <RuleCards rules={list} onDelete={setToDelete} />
            </>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete rule ${toDelete?.symbol ?? ""}?`}
        description="The rule is disabled and removed from the list. Its order and evaluation history is kept."
        confirmLabel="Delete rule"
        destructive
        onConfirm={() => (toDelete ? del.mutateAsync(toDelete) : undefined)}
      />
    </div>
  );
}

function RowActions({
  rule,
  onDelete,
}: {
  rule: Schemas["RuleOut"];
  onDelete: (r: Schemas["RuleOut"]) => void;
}) {
  return (
    <div className="flex justify-end gap-0.5">
      <Button size="icon" variant="ghost" asChild aria-label={`Edit ${rule.symbol}`} title="Edit">
        <Link to={`/rules/${rule.id}/edit`}>
          <Pencil />
        </Link>
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="hover:bg-loss-soft hover:text-loss"
        aria-label={`Delete ${rule.symbol}`}
        title="Delete"
        onClick={() => onDelete(rule)}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function LastEval({ rule, now }: { rule: Schemas["RuleOut"]; now: number }) {
  const ev = rule.last_evaluation;
  if (!ev) return <span className="text-xs text-muted-foreground">Not evaluated yet</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      <DecisionBadge decision={ev.decision} />
      <span className="num text-2xs text-muted-foreground">
        {fmtPrice(ev.last_price)} · {fmtRelative(ev.ts, now)}
      </span>
    </div>
  );
}

function RulesTable({
  rules,
  onDelete,
}: {
  rules: Schemas["RuleOut"][];
  onDelete: (r: Schemas["RuleOut"]) => void;
}) {
  const now = useNow(60_000);
  return (
    <div className="hidden md:block">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Rule</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead>Tier ladder</TableHead>
            <TableHead>Last evaluation</TableHead>
            <TableHead className="w-56">Next tier</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Link to={`/rules/${r.id}`} className="group block">
                  <span className="text-sm font-semibold group-hover:text-primary">{r.symbol}</span>
                  <span className="block text-xs text-muted-foreground">{triggerSummary(r)}</span>
                </Link>
              </TableCell>
              <TableCell>
                <EnabledToggle rule={r} />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-3">
                  <TierLadder tiers={r.tiers} filled={r.tiers_filled} size="sm" />
                  <div className="text-2xs leading-4 text-muted-foreground">
                    <div className="text-foreground">{tiersSummary(r.tiers)}</div>
                    <div>
                      max {fmtUsdShort(r.max_position_usd)}
                      {r.tiers_filled && r.tiers_filled.length > 0 && (
                        <span className="text-gain">
                          {" "}
                          · {r.tiers_filled.map(tierLabel).join(", ")} filled
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <LastEval rule={r} now={now} />
              </TableCell>
              <TableCell>
                <DistanceToTier rule={r} />
              </TableCell>
              <TableCell>
                <RowActions rule={r} onDelete={onDelete} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RuleCards({
  rules,
  onDelete,
}: {
  rules: Schemas["RuleOut"][];
  onDelete: (r: Schemas["RuleOut"]) => void;
}) {
  const now = useNow(60_000);
  return (
    <ul className="grid gap-3 md:hidden">
      {rules.map((r) => (
        <li key={r.id} className="rounded-lg border bg-muted/20 p-3">
          <div className="flex items-start justify-between gap-2">
            <Link to={`/rules/${r.id}`} className="min-w-0">
              <span className="text-base font-semibold">{r.symbol}</span>
              <span className="block truncate text-xs text-muted-foreground">{triggerSummary(r)}</span>
            </Link>
            <EnabledToggle rule={r} />
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DistanceToTier rule={r} />
            </div>
            <TierLadder tiers={r.tiers} filled={r.tiers_filled} size="sm" />
          </div>
          <div className="mt-3 flex items-end justify-between gap-2 border-t pt-2">
            <LastEval rule={r} now={now} />
            <RowActions rule={r} onDelete={onDelete} />
          </div>
        </li>
      ))}
    </ul>
  );
}
