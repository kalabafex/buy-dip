import { NavLink } from "react-router-dom";
import { NAV } from "@/components/layout/nav";
import { cn } from "@/lib/utils";

export function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Main" className="grid gap-0.5">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            cn(
              "group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              collapsed && "justify-center px-0",
              isActive
                ? "bg-accent text-foreground"
                : "text-sidebar-foreground hover:bg-accent/60 hover:text-foreground",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />
              )}
              <Icon
                className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "opacity-80")}
                aria-hidden
              />
              {collapsed ? (
                <span className="sr-only">{label}</span>
              ) : (
                <span className="truncate">{label}</span>
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
