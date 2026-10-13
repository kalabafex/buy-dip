import { Briefcase } from "lucide-react";
import type { Schemas } from "@/api/client";
import { EmptyState, Signed } from "@/components/common";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtNum, fmtPct, fmtPrice, fmtUsd, fmtUsdSigned } from "@/lib/format";

export function PositionsTable({
  positions,
  loading,
}: {
  positions: Schemas["PositionOut"][] | undefined;
  loading?: boolean;
}) {
  if (!loading && !positions?.length) {
    return (
      <EmptyState
        icon={Briefcase}
        title={"No open positions"}
        description="Positions bought by your rules show up after the next account snapshot."
        className="py-8"
      />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Symbol</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Avg entry</TableHead>
          <TableHead className="text-right">Value</TableHead>
          <TableHead className="text-right" title="Unrealized profit / loss">
            P/L
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {!positions?.length ? (
          <TableEmpty colSpan={5} loading={loading}>
            No open positions.
          </TableEmpty>
        ) : (
          positions.map((p) => {
            const pl = Number(p.unrealized_pl);
            const cost = Number(p.qty) * Number(p.avg_entry_price);
            const plPct = cost > 0 ? (pl / cost) * 100 : null;
            return (
              <TableRow key={p.symbol}>
                <TableCell className="font-semibold">{p.symbol}</TableCell>
                <TableCell className="text-right">{fmtNum(p.qty)}</TableCell>
                <TableCell className="hidden text-right sm:table-cell">{fmtPrice(p.avg_entry_price)}</TableCell>
                <TableCell className="text-right font-medium">{fmtUsd(p.market_value)}</TableCell>
                <TableCell className="text-right">
                  <Signed value={pl} className="font-medium">
                    {fmtUsdSigned(p.unrealized_pl)}
                    {plPct !== null && (
                      <span className="ml-1.5 text-xs opacity-90">{fmtPct(plPct, 2, true)}</span>
                    )}
                  </Signed>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
