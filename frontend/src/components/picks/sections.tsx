import { CalendarCheck, LineChart, SlidersHorizontal, Target, Trophy, Wallet } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Callout, Signed } from "@/components/common";
import { StatCard } from "@/components/dashboard/StatCard";
import { fmtPct, fmtUsdSigned } from "@/lib/format";
import { num, type PicksDay } from "@/lib/picks";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "Today", icon: CalendarCheck, end: true },
  { to: "/picks/performance", label: "Performance", icon: LineChart, end: false },
  { to: "/picks/model", label: "Model", icon: SlidersHorizontal, end: false },
];

/** Link tabs shared by the three daily-picks pages (styled like <TabsList>). */
export function PicksTabs({ className }: { className?: string }) {
  return (
    <nav
      aria-label="Daily picks"
      className={cn("inline-flex h-9 items-center gap-0.5 rounded-lg bg-muted p-0.5 text-muted-foreground", className)}
    >
      {TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-all hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive && "bg-card text-foreground shadow-sm",
            )
          }
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

/** Day totals: average expected vs plan return, realized P/L and wins. */
export function DayTotals({ day }: { day: PicksDay }) {
  const picks = day.picks;
  const exp = picks.length ? picks.reduce((a, p) => a + (num(p.expected_return_pct) ?? 0), 0) / picks.length : null;
  const plan = num(day.plan_return_avg_pct);
  const evaluated = picks.filter((p) => p.plan_return_pct != null);
  const planWins = evaluated.filter((p) => (num(p.plan_return_pct) ?? 0) > 0).length;
  const traded = picks.filter((p) => p.realized_pnl_usd != null);
  const realWins = traded.filter((p) => (num(p.realized_pnl_usd) ?? 0) > 0).length;
  const pnl = num(day.realized_pnl_usd);
  const tradeable = picks.filter((p) => p.status !== "WATCH").length;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        title="Avg expected"
        icon={Target}
        valueClassName="proportional"
        value={<Signed value={exp}>{fmtPct(exp, 2, true)}</Signed>}
        sub={`${picks.length} pick${picks.length === 1 ? "" : "s"} · ${tradeable} tradeable`}
      />
      <StatCard
        title="Avg plan return"
        icon={CalendarCheck}
        valueClassName="proportional"
        value={plan !== null ? <Signed value={plan}>{fmtPct(plan, 2, true)}</Signed> : "—"}
        sub={evaluated.length ? `${evaluated.length} evaluated after the close` : "Recorded after the close"}
      />
      <StatCard
        title="Realized P/L"
        icon={Wallet}
        valueClassName="proportional"
        value={pnl !== null ? <Signed value={pnl}>{fmtUsdSigned(pnl)}</Signed> : "—"}
        sub={traded.length ? `${traded.length} closed trade${traded.length === 1 ? "" : "s"}` : "No closed trades"}
      />
      <StatCard
        title="Wins"
        icon={Trophy}
        valueClassName="proportional"
        value={
          evaluated.length ? (
            <>
              {planWins}
              <span className="text-sm font-medium text-muted-foreground"> / {evaluated.length} plan</span>
            </>
          ) : (
            "—"
          )
        }
        sub={traded.length ? `${realWins} of ${traded.length} traded closed green` : "Plan wins = plan return > 0"}
      />
    </div>
  );
}

export function PicksCaveat() {
  return (
    <Callout tone="warning" title="Expected returns are historical averages, not predictions">
      <ul className="list-disc space-y-1 pl-4">
        <li>Single days often lose even when the average is positive; judge the picks over many days.</li>
        <li>
          The simulation is conservative: when both the target and the stop are inside the day's range, the
          stop is assumed to hit first.
        </li>
        <li>Prices come from Alpaca's free IEX feed, which can differ slightly from the consolidated tape.</li>
      </ul>
    </Callout>
  );
}
