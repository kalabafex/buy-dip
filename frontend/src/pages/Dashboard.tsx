import { useState } from "react";
import { useAccount, useEvaluations, useHealth, useOrders, usePositions, useSettings } from "@/api/queries";
import { ErrorBox } from "@/components/common";
import { Pagination } from "@/components/Pagination";
import { StatCard } from "@/components/dashboard/StatCard";
import { HeartbeatCard } from "@/components/dashboard/HeartbeatCard";
import { EvaluationsTable } from "@/components/tables/EvaluationsTable";
import { OrdersTable } from "@/components/tables/OrdersTable";
import { PositionsTable } from "@/components/tables/PositionsTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { fmtRelative, fmtUsd } from "@/lib/format";

export function DashboardPage() {
  const account = useAccount();
  const settings = useSettings();
  const health = useHealth();
  const positions = usePositions();
  const [ordersOffset, setOrdersOffset] = useState(0);
  const orders = useOrders({ limit: 10, offset: ordersOffset });
  const triggered = useEvaluations({ triggered_only: true, limit: 10 });

  const s = settings.data;
  const a = account.data;

  return (
    <div className="grid grid-cols-1 gap-4">
      {s?.kill_switch && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          Kill switch is ON — the worker will not place orders.
        </div>
      )}
      <ErrorBox error={account.error ?? settings.error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          title="Equity"
          value={a ? fmtUsd(a.equity) : "—"}
          sub={a ? `Cash ${fmtUsd(a.cash)} · ${fmtRelative(a.ts)}` : account.isPending ? "…" : "No snapshot yet"}
        />
        <StatCard
          title="Buying power"
          value={a ? fmtUsd(a.buying_power) : "—"}
          sub={a ? `${a.mode} account` : undefined}
        />
        <StatCard
          title="Spend today"
          value={s ? fmtUsd(s.spend_today) : "—"}
          sub={s ? `of ${fmtUsd(s.max_daily_spend_usd, { compact: true })} daily cap` : undefined}
        >
          {s && <Progress value={Number(s.spend_today)} max={Number(s.max_daily_spend_usd)} />}
        </StatCard>
        <StatCard
          title="Spend this week"
          value={s ? fmtUsd(s.spend_week) : "—"}
          sub={s ? `of ${fmtUsd(s.max_weekly_spend_usd, { compact: true })} weekly cap` : undefined}
        >
          {s && <Progress value={Number(s.spend_week)} max={Number(s.max_weekly_spend_usd)} />}
        </StatCard>
        <HeartbeatCard
          className="col-span-2 lg:col-span-1"
          health={health.data}
          error={health.error}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Positions</CardTitle>
          </CardHeader>
          <CardContent>
            <PositionsTable positions={positions.data} loading={positions.isPending} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent triggered evaluations</CardTitle>
          </CardHeader>
          <CardContent>
            <ErrorBox error={triggered.error} />
            <EvaluationsTable evaluations={triggered.data?.items} loading={triggered.isPending} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent orders</CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorBox error={orders.error} />
          <OrdersTable orders={orders.data?.items} loading={orders.isPending} />
          {orders.data && (
            <Pagination
              total={orders.data.total}
              limit={orders.data.limit}
              offset={orders.data.offset}
              onOffset={setOrdersOffset}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
