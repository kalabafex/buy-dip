import { Link } from "react-router-dom";
import type { Schemas } from "@/api/client";
import { DecisionBadge } from "@/components/badges";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDateTime, fmtNum, fmtPct, fmtPrice, tierLabel } from "@/lib/format";

export function EvaluationsTable({
  evaluations,
  loading,
  showSymbol = true,
  detailed = false,
}: {
  evaluations: Schemas["EvaluationOut"][] | undefined;
  loading?: boolean;
  showSymbol?: boolean;
  /** Show indicator columns (SMA, RSI, consecutive). */
  detailed?: boolean;
}) {
  const cols = 6 + (showSymbol ? 1 : 0) + (detailed ? 4 : 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          {showSymbol && <TableHead>Symbol</TableHead>}
          <TableHead className="text-right">Last</TableHead>
          <TableHead className="text-right">Ref high</TableHead>
          <TableHead className="text-right">Pullback</TableHead>
          {detailed && (
            <>
              <TableHead className="text-right">SMA50</TableHead>
              <TableHead className="text-right">SMA200</TableHead>
              <TableHead className="text-right">RSI14</TableHead>
              <TableHead className="text-right">Met×</TableHead>
            </>
          )}
          <TableHead>Tier</TableHead>
          <TableHead>Decision</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {!evaluations?.length ? (
          <TableEmpty colSpan={cols}>{loading ? "Loading…" : "No evaluations"}</TableEmpty>
        ) : (
          evaluations.map((e) => (
            <TableRow key={e.id} title={e.reason}>
              <TableCell className="text-xs text-muted-foreground">{fmtDateTime(e.ts)}</TableCell>
              {showSymbol && (
                <TableCell className="font-medium">
                  <Link to={`/rules/${e.rule_id}`} className="hover:underline">
                    {e.symbol}
                  </Link>
                </TableCell>
              )}
              <TableCell className="text-right">{fmtPrice(e.last_price)}</TableCell>
              <TableCell className="text-right">{fmtPrice(e.ref_high)}</TableCell>
              <TableCell className="text-right">{fmtPct(e.pullback_pct)}</TableCell>
              {detailed && (
                <>
                  <TableCell className="text-right">{fmtPrice(e.sma50)}</TableCell>
                  <TableCell className="text-right">{fmtPrice(e.sma200)}</TableCell>
                  <TableCell className="text-right">{fmtNum(e.rsi14, 1)}</TableCell>
                  <TableCell className="text-right">
                    {e.condition_met ? e.consecutive_met : "—"}
                  </TableCell>
                </>
              )}
              <TableCell>{e.tier_hit !== null ? tierLabel(e.tier_hit) : "—"}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <DecisionBadge decision={e.decision} />
                  <span className="hidden max-w-[22rem] truncate text-xs text-muted-foreground lg:inline">
                    {e.reason}
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
