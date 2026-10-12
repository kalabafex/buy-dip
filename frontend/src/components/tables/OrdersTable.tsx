import { Link } from "react-router-dom";
import type { Schemas } from "@/api/client";
import { ModeBadge, OrderStatusBadge } from "@/components/badges";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDateTime, fmtNum, fmtPrice, fmtUsd, tierLabel } from "@/lib/format";

export function OrdersTable({
  orders,
  loading,
  showSymbol = true,
}: {
  orders: Schemas["OrderOut"][] | undefined;
  loading?: boolean;
  showSymbol?: boolean;
}) {
  const cols = showSymbol ? 9 : 8;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Created</TableHead>
          {showSymbol && <TableHead>Symbol</TableHead>}
          <TableHead>Tier</TableHead>
          <TableHead className="text-right">Notional</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="text-right">Limit</TableHead>
          <TableHead className="text-right">Filled</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Mode</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {!orders?.length ? (
          <TableEmpty colSpan={cols}>{loading ? "Loading…" : "No orders"}</TableEmpty>
        ) : (
          orders.map((o) => (
            <TableRow key={o.id}>
              <TableCell className="text-xs text-muted-foreground">{fmtDateTime(o.created_at)}</TableCell>
              {showSymbol && (
                <TableCell className="font-medium">
                  <Link to={`/rules/${o.rule_id}`} className="hover:underline">
                    {o.symbol}
                  </Link>
                </TableCell>
              )}
              <TableCell>{tierLabel(o.tier_index)}</TableCell>
              <TableCell className="text-right">{fmtUsd(o.notional_usd)}</TableCell>
              <TableCell className="text-right">{fmtNum(o.qty)}</TableCell>
              <TableCell className="text-right">{fmtPrice(o.limit_price)}</TableCell>
              <TableCell className="text-right">
                {o.filled_qty && Number(o.filled_qty) > 0
                  ? `${fmtNum(o.filled_qty)} @ ${fmtPrice(o.filled_avg_price)}`
                  : "—"}
              </TableCell>
              <TableCell title={o.error ?? undefined}>
                <OrderStatusBadge status={o.status} />
              </TableCell>
              <TableCell>
                <ModeBadge mode={o.mode} />
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
