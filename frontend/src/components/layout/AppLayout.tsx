import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut, Menu, OctagonX, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { qk, useMe, useSettings } from "@/api/queries";
import { useEventStream } from "@/api/useEventStream";
import { ModeBadge } from "@/components/badges";
import { Brand, BrandMark } from "@/components/layout/Brand";
import { KillSwitch } from "@/components/layout/KillSwitch";
import { SidebarNav } from "@/components/layout/SidebarNav";
import { HeartbeatDot, MarketStatusPill } from "@/components/layout/StatusIndicators";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { readStored, writeStored } from "@/lib/storage";
import { cn } from "@/lib/utils";

const COLLAPSE_KEY = "dipbuyer.sidebar-collapsed";

export function AppLayout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const me = useMe();
  const settings = useSettings();
  const stream = useEventStream(!!me.data);
  const live = settings.data?.trading_mode === "LIVE";
  const halted = settings.data?.kill_switch ?? false;
  const [collapsed, setCollapsed] = useState(() => readStored(COLLAPSE_KEY) === "1");
  const [drawer, setDrawer] = useState(false);

  useEffect(() => writeStored(COLLAPSE_KEY, collapsed ? "1" : null), [collapsed]);
  useEffect(() => setDrawer(false), [location.pathname]);

  const logout = useMutation({
    mutationFn: () => api.post("/api/auth/logout"),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(qk.me, null);
      navigate("/login", { replace: true });
    },
  });

  const userFooter = (compact: boolean) => (
    <div className={cn("flex items-center gap-2 border-t p-3", compact && "flex-col")}>
      {!compact && (
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{me.data?.username}</div>
          <div className="text-2xs text-muted-foreground">Signed in</div>
        </div>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut />
      </Button>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <div className="hidden shrink-0 border-r bg-sidebar lg:block">
        <aside
          className={cn(
            "sticky top-0 flex h-screen flex-col transition-[width] duration-200",
            collapsed ? "w-[4.25rem]" : "w-60",
          )}
        >
          <div className={cn("flex h-14 items-center border-b px-4", collapsed && "justify-center px-0")}>
            <Brand collapsed={collapsed} />
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <SidebarNav collapsed={collapsed} />
          </div>
          <div className={cn("px-3 pb-2", collapsed && "flex justify-center")}>
            <Button
              variant="ghost"
              size="sm"
              className={cn("w-full justify-start", collapsed && "w-auto justify-center px-2")}
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              {!collapsed && "Collapse"}
            </Button>
          </div>
          {userFooter(collapsed)}
        </aside>
      </div>

      {/* Mobile drawer */}
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Main navigation menu</SheetDescription>
          <div className="flex h-14 items-center border-b px-4">
            <Brand />
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <SidebarNav onNavigate={() => setDrawer(false)} />
          </div>
          {userFooter(false)}
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cn(
            "sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70",
            live && "border-t-[3px] border-t-red-600",
          )}
        >
          <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-6">
            <Button
              variant="ghost"
              size="icon"
              className="-ml-1 lg:hidden"
              onClick={() => setDrawer(true)}
              aria-label="Open navigation menu"
            >
              <Menu />
            </Button>
            <BrandMark className="h-6 w-6 lg:hidden max-[359px]:hidden" />
            <ModeBadge mode={settings.data?.trading_mode} size="lg" />
            <MarketStatusPill />
            <HeartbeatDot stream={stream} />
            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <KillSwitch />
              <ThemeToggle />
            </div>
          </div>
        </header>
        {(halted || live) && (
          <div
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-xs font-medium sm:px-6",
              halted ? "bg-loss text-white" : "bg-red-600/10 text-loss",
            )}
            role="status"
          >
            <OctagonX className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {halted
              ? "Kill switch is ON — the worker will not place orders and cancels open ones."
              : "LIVE trading — the worker places real orders with real money."}
          </div>
        )}
        <main className="mx-auto w-full min-w-0 max-w-[90rem] flex-1 px-4 py-5 sm:px-6 sm:py-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
