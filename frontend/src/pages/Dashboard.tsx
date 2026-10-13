import { CalendarRange, Landmark, Wallet, Zap } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useAccount,
  useEvaluations,
  useHealth,
  useOrders,
  usePositions,
  useRules,
  useSettings,
} from "@/api/queries";
import { ErrorBox, PageHeader } from "@/components/common";
import { HeartbeatCard } from "@/components/dashboard/HeartbeatCard";
import { StatCard } from "@/components/dashboard/StatCard";
import { Watchlist } from "@/components/dashboard/Watchlist";
import { Pagination } from "@/components/Pagination";
import { EvaluationsTable } from "@/components/tables/EvaluationsTable";
import { OrdersTable } from "@/components/tables/OrdersTable";
import { PositionsTable } from "@/components/tables/PositionsTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeaderRow } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import { fmtRelative, fmtUsd, fmtUsdShort } from "@/lib/format";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function DashboardPage() {
  const account = useAccount();
  const settings = useSettings();
  const health = useHealth();
  const positions = usePositions();
  const rules = useRules();
  const [ordersOffset, setOrdersOffset] = useState(0);
  const orders = useOrders({ limit: 8, offset: ordersOffset });
  const triggered = useEvaluations({ triggered_only: true, limit: 8 });

  const s = settings.data;
  const a = account.data;
  const enabled = rules.data?.filter((r) => r.enabled).length ?? 0;

  return (
    <div className="grid grid-cols-1 gap-5 sm:gap-6">
      <PageHeader
        title={greeting()}
        subtitle={
          rules.data
            ? `${enabled} of ${rules.data.length} rule${rules.data.length === 1 ? "" : "s"} enabled · account snapshot ${a ? fmtRelative(a.ts) : "not taken yet"}`
            : "Overview of your account, rules and recent activity."
        }
      />
      <ErrorBox error={account.error ?? settings.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          hero
          className="col-span-2 lg:col-span-1"
          title="Equity"
          icon={Landmark}
          loading={account.isPending}
          value={a ? fmtUsd(a.equity) : "—"}
          sub={
            a
              ? `Cash ${fmtUsd(a.cash)}`
              : "No account snapshot yet — the worker takes one each market-hours tick"
          }
        />
        <StatCard
          title="Buying power"
          icon={Wallet}
          loading={account.isPending}
          value={a ? fmtUsd(a.buying_power) : "—"}
          sub={a ? `${a.mode === "LIVE" ? "Live" : "Paper"} account` : undefined}
        />
        <StatCard
          title="Spend today"
          icon={Zap}
          loading={settings.isPending}
          value={s ? fmtUsdShort(s.spend_today) : "—"}
          sub={s ? `of ${fmtUsd(s.max_daily_spend_usd, { compact: true })} daily cap` : undefined}
        >
          {s && (
            <Meter
              value={Number(s.spend_today)}
              max={Number(s.max_daily_spend_usd)}
              label="Daily spend vs cap"
            />
          )}
        </StatCard>
        <StatCard
          title="Spend this week"
          icon={CalendarRange}
          loading={settings.isPending}
          value={s ? fmtUsdShort(s.spend_week) : "—"}
          sub={s ? `of ${fmtUsd(s.max_weekly_spend_usd, { compact: true })} weekly cap` : undefined}
        >
          {s && (
            <Meter
              value={Number(s.spend_week)}
              max={Number(s.max_weekly_spend_usd)}
              label="Weekly spend vs cap"
            />
          )}
        </StatCard>
        <HeartbeatCard
          health={health.data}
          error={health.error}
          intervalMinutes={s?.evaluation_interval_minutes}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Watchlist rules={rules.data} loading={rules.isPending} error={rules.error} />
        <Card>
          <CardHeaderRow title="Positions" description="From the latest account snapshot." />
          <CardContent>
            <PositionsTable positions={positions.data} loading={positions.isPending} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
        <Card>
          <CardHeaderRow
            title="Recent orders"
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link to="/rules">By rule</Link>
              </Button>
            }
          />
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
        <Card>
          <CardHeaderRow
            title="Triggered evaluations"
            description="Evaluations that reached a buy tier, whether or not an order followed."
          />
          <CardContent>
            <ErrorBox error={triggered.error} />
            <EvaluationsTable
              evaluations={triggered.data?.items}
              loading={triggered.isPending}
              empty="Nothing has triggered yet."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
