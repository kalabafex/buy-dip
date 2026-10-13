import { ScrollText } from "lucide-react";
import { Link } from "react-router-dom";
import type { Schemas } from "@/api/client";
import { EmptyState } from "@/components/common";
import { DecisionBadge } from "@/components/badges";
import { SkeletonRows } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDateTime, fmtNum, fmtPct, fmtPrice, readableReason, tierLabel } from "@/lib/format";

export function EvaluationsTable({
  evaluations,
  loading,
  showSymbol = true,
  detailed = false,
  empty = "No evaluations yet",
}: {
  evaluations: Schemas["EvaluationOut"][] | undefined;
  loading?: boolean;
  showSymbol?: boolean;
  /** Show indicator columns (SMA, RSI, consecutive). */
  detailed?: boolean;
  empty?: string;
}) {
  const cols = 5 + (showSymbol ? 1 : 0) + (detailed ? 5 : 0);
  if (!loading && !evaluations?.length) {
    return <EmptyState icon={ScrollText} title={empty} className="py-8" />;
  }
  return (
    <>
      <ul className="divide-y md:hidden">
        {loading && !evaluations?.length && (
          <li>
            <SkeletonRows rows={3} />
          </li>
        )}
        {evaluations?.map((e) => (
          <li key={e.id} className="grid gap-1.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                {showSymbol && (
                  <Link to={`/rules/${e.rule_id}`} className="font-semibold hover:text-primary">
                    {e.symbol}
                  </Link>
                )}
                <DecisionBadge decision={e.decision} />
                {e.tier_hit !== null && <span className="text-xs font-medium">{tierLabel(e.tier_hit)}</span>}
              </span>
              <span className="shrink-0 text-2xs text-muted-foreground">{fmtDateTime(e.ts)}</span>
            </div>
            <div className="num flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              <span>
                Last <span className="text-foreground">{fmtPrice(e.last_price)}</span>
              </span>
              <span>
                Pullback <span className="text-foreground">{fmtPct(e.pullback_pct)}</span>
              </span>
              {detailed && (
                <span>
                  RSI <span className="text-foreground">{fmtNum(e.rsi14, 1)}</span>
                </span>
              )}
            </div>
            {e.reason && (
              <p className="text-xs leading-4 text-muted-foreground">{readableReason(e.reason)}</p>
            )}
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Time</TableHead>
              {showSymbol && <TableHead>Symbol</TableHead>}
              <TableHead className="text-right">Last</TableHead>
              {detailed && <TableHead className="text-right">Ref high</TableHead>}
              <TableHead className="text-right">Pullback</TableHead>
              {detailed && (
                <>
                  <TableHead className="text-right">SMA50</TableHead>
                  <TableHead className="text-right">SMA200</TableHead>
                  <TableHead className="text-right">RSI14</TableHead>
                  <TableHead className="text-right" title="Consecutive evaluations with the condition met">
                    Streak
                  </TableHead>
                </>
              )}
              <TableHead>Tier</TableHead>
              <TableHead className="min-w-[16rem]">Decision</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!evaluations?.length ? (
              <TableEmpty colSpan={cols} loading={loading}>
                {empty}
              </TableEmpty>
            ) : (
              evaluations.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs text-muted-foreground">{fmtDateTime(e.ts)}</TableCell>
                  {showSymbol && (
                    <TableCell className="font-semibold">
                      <Link to={`/rules/${e.rule_id}`} className="hover:text-primary hover:underline">
                        {e.symbol}
                      </Link>
                    </TableCell>
                  )}
                  <TableCell className="text-right">{fmtPrice(e.last_price)}</TableCell>
                  {detailed && <TableCell className="text-right">{fmtPrice(e.ref_high)}</TableCell>}
                  <TableCell className="text-right">{fmtPct(e.pullback_pct)}</TableCell>
                  {detailed && (
                    <>
                      <TableCell className="text-right">{fmtPrice(e.sma50)}</TableCell>
                      <TableCell className="text-right">{fmtPrice(e.sma200)}</TableCell>
                      <TableCell className="text-right">{fmtNum(e.rsi14, 1)}</TableCell>
                      <TableCell className="text-right">
                        {e.condition_met ? `${e.consecutive_met}×` : "—"}
                      </TableCell>
                    </>
                  )}
                  <TableCell>{e.tier_hit !== null ? tierLabel(e.tier_hit) : "—"}</TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-col items-start gap-1 py-0.5">
                      <DecisionBadge decision={e.decision} />
                      {e.reason && (
                        <span className="max-w-[28rem] text-xs leading-4 text-muted-foreground">
                          {readableReason(e.reason)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
