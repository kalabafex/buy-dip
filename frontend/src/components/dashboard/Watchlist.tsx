import { Eye, Plus, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import type { Schemas } from "@/api/client";
import { DecisionBadge, EnabledChip } from "@/components/badges";
import { EmptyState, ErrorBox } from "@/components/common";
import { DistanceToTier } from "@/components/rules/DistanceToTier";
import { TierLadder } from "@/components/rules/TierLadder";
import { triggerSummary } from "@/components/rules/ruleSchema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeaderRow } from "@/components/ui/card";
import { SkeletonRows } from "@/components/ui/skeleton";
import { fmtPct, fmtPrice, fmtRelative } from "@/lib/format";
import { useNow } from "@/lib/hooks";

/** Each rule's symbol with last price and how far it is from its next buy tier. */
export function Watchlist({
  rules,
  loading,
  error,
}: {
  rules: Schemas["RuleOut"][] | undefined;
  loading: boolean;
  error: unknown;
}) {
  const now = useNow(60_000);
  // Closest to triggering first; enabled before disabled.
  const sorted = [...(rules ?? [])].sort((a, b) => {
    if (!!a.enabled !== !!b.enabled) return a.enabled ? -1 : 1;
    const da = a.distance_to_next_tier_pct != null ? Number(a.distance_to_next_tier_pct) : Infinity;
    const db = b.distance_to_next_tier_pct != null ? Number(b.distance_to_next_tier_pct) : Infinity;
    return da - db;
  });
  return (
    <Card>
      <CardHeaderRow
        title={
          <>
            <Eye className="h-4 w-4 text-muted-foreground" aria-hidden /> Watchlist &amp; opportunities
          </>
        }
        description="Your rules, closest to their next buy tier first. Prices are from each rule's last evaluation."
        actions={
          rules?.length ? (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/rules">All rules</Link>
            </Button>
          ) : undefined
        }
      />
      <CardContent>
        <ErrorBox error={error} className="mb-3" />
        {loading ? (
          <SkeletonRows rows={3} />
        ) : !sorted.length ? (
          <EmptyState
            icon={Sparkles}
            title="No rules yet"
            description={
              <>
                Let the app test rule ideas against a symbol's history, or create one yourself. Running{" "}
                <code className="whitespace-nowrap rounded bg-muted px-1 py-0.5 font-mono text-2xs">
                  just seed-rules
                </code>{" "}
                adds three researched presets (disabled).
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
          <ul className="divide-y">
            {sorted.map((r) => {
              const ev = r.last_evaluation;
              return (
                <li key={r.id}>
                  <Link
                    to={`/rules/${r.id}`}
                    className="-mx-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-lg px-2 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,9rem)_6.5rem_minmax(9rem,1fr)_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{r.symbol}</span>
                        <EnabledChip enabled={r.enabled ?? false} />
                      </div>
                      <div className="mt-0.5 truncate text-2xs text-muted-foreground">
                        {triggerSummary(r)}
                      </div>
                    </div>
                    <div className="num text-right sm:text-left">
                      <div className="text-sm font-medium">{fmtPrice(ev?.last_price)}</div>
                      <div className="text-2xs text-muted-foreground">
                        {ev?.pullback_pct != null
                          ? `−${fmtPct(ev.pullback_pct, 1)} from high`
                          : "no evaluation"}
                      </div>
                    </div>
                    <DistanceToTier rule={r} className="col-span-2 sm:col-span-1" />
                    <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:justify-end">
                      <TierLadder tiers={r.tiers} filled={r.tiers_filled} size="sm" />
                      {ev ? (
                        <span title={`Last evaluated ${fmtRelative(ev.ts, now)}`}>
                          <DecisionBadge decision={ev.decision} />
                        </span>
                      ) : (
                        <span className="text-2xs text-muted-foreground">not evaluated</span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
