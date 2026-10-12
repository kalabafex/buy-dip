import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { qk, useMe, useSettings } from "@/api/queries";
import { useEventStream, type StreamState } from "@/api/useEventStream";
import { ModeBadge } from "@/components/badges";
import { KillSwitch } from "@/components/layout/KillSwitch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/rules", label: "Rules", end: false },
  { to: "/backtest", label: "Backtest", end: false },
  { to: "/settings", label: "Settings", end: false },
];

function StreamDot({ state }: { state: StreamState }) {
  const color =
    state === "open" ? "bg-green-500" : state === "connecting" ? "bg-amber-500" : "bg-red-500";
  const label =
    state === "open" ? "Live updates connected" : state === "connecting" ? "Connecting…" : "Live updates disconnected; retrying";
  return <span className={cn("inline-block h-2 w-2 rounded-full", color)} title={label} aria-label={label} />;
}

export function AppLayout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useMe();
  const settings = useSettings();
  const stream = useEventStream(!!me.data);
  const live = settings.data?.trading_mode === "LIVE";

  const logout = useMutation({
    mutationFn: () => api.post("/api/auth/logout"),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(qk.me, null);
      navigate("/login", { replace: true });
    },
  });

  return (
    <div className="min-h-screen">
      <header
        className={cn(
          "sticky top-0 z-40 border-b bg-background/95 backdrop-blur",
          live && "border-b-2 border-b-red-500",
        )}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 sm:px-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-tight">Dip Buyer</span>
            <ModeBadge mode={settings.data?.trading_mode} />
            <StreamDot state={stream} />
          </div>
          <nav className="order-last -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-2.5 py-1 text-sm transition-colors hover:bg-accent",
                    isActive ? "bg-accent font-medium" : "text-muted-foreground",
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <KillSwitch />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              title={me.data ? `Sign out ${me.data.username}` : "Sign out"}
            >
              <LogOut /> <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-4">
        <Outlet />
      </main>
    </div>
  );
}
