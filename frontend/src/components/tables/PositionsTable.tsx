import type { Schemas } from "@/api/client";
import { Signed } from "@/components/common";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtNum, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";

export function PositionsTable({
  positions,
  loading,
}: {
  positions: Schemas["PositionOut"][] | undefined;
  loading?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Symbol</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="text-right">Avg entry</TableHead>
          <TableHead className="text-right">Market value</TableHead>
          <TableHead className="text-right">Unrealized P/L</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {!positions?.length ? (
          <TableEmpty colSpan={5}>{loading ? "Loading…" : "No positions"}</TableEmpty>
        ) : (
          positions.map((p) => {
            const pl = Number(p.unrealized_pl);
            const cost = Number(p.qty) * Number(p.avg_entry_price);
            const plPct = cost > 0 ? (pl / cost) * 100 : null;
            return (
              <TableRow key={p.symbol}>
                <TableCell className="font-medium">{p.symbol}</TableCell>
                <TableCell className="text-right">{fmtNum(p.qty)}</TableCell>
                <TableCell className="text-right">{fmtPrice(p.avg_entry_price)}</TableCell>
                <TableCell className="text-right">{fmtUsd(p.market_value)}</TableCell>
                <TableCell className="text-right">
                  <Signed value={pl}>
                    {fmtUsd(p.unrealized_pl)}
                    {plPct !== null && (
                      <span className="ml-1 text-xs">({fmtPct(plPct, 2, true)})</span>
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
