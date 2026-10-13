import { ReceiptText } from "lucide-react";
import { Link } from "react-router-dom";
import type { Schemas } from "@/api/client";
import { EmptyState } from "@/components/common";
import { ModeBadge, OrderStatusBadge } from "@/components/badges";
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
  if (!loading && !orders?.length) {
    return (
      <EmptyState
        icon={ReceiptText}
        title={"No orders yet"}
        description="Orders appear here when an enabled rule triggers during market hours."
        className="py-8"
      />
    );
  }
  return (
    <>
      <ul className="divide-y md:hidden">
        {loading && !orders?.length && (
          <li>
            <SkeletonRows rows={3} />
          </li>
        )}
        {orders?.map((o) => (
          <li key={o.id} className="grid gap-1.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                {showSymbol && (
                  <Link to={`/rules/${o.rule_id}`} className="font-semibold hover:text-primary">
                    {o.symbol}
                  </Link>
                )}
                <span className="text-xs font-medium">{tierLabel(o.tier_index)}</span>
                <OrderStatusBadge status={o.status} />
              </span>
              <span className="num shrink-0 text-sm font-semibold">{fmtUsd(o.notional_usd)}</span>
            </div>
            <div className="num flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{fmtDateTime(o.created_at)}</span>
              <span>
                {fmtNum(o.qty)} @ limit {fmtPrice(o.limit_price)}
              </span>
              {o.filled_qty && Number(o.filled_qty) > 0 && (
                <span>filled @ {fmtPrice(o.filled_avg_price)}</span>
              )}
              <ModeBadge mode={o.mode} />
            </div>
            {o.error && <p className="text-xs text-loss">{o.error}</p>}
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
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
              <TableEmpty colSpan={cols} loading={loading}>
                No orders yet. Orders appear here when an enabled rule triggers during market hours.
              </TableEmpty>
            ) : (
              orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="text-xs text-muted-foreground">{fmtDateTime(o.created_at)}</TableCell>
                  {showSymbol && (
                    <TableCell className="font-semibold">
                      <Link to={`/rules/${o.rule_id}`} className="hover:text-primary hover:underline">
                        {o.symbol}
                      </Link>
                    </TableCell>
                  )}
                  <TableCell>{tierLabel(o.tier_index)}</TableCell>
                  <TableCell className="text-right font-medium">{fmtUsd(o.notional_usd)}</TableCell>
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
      </div>
    </>
  );
}
