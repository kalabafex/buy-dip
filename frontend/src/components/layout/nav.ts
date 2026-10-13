import { FlaskConical, LayoutDashboard, ListChecks, Settings, Sparkles, type LucideIcon } from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon; end: boolean };

export const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/rules", label: "Rules", icon: ListChecks, end: false },
  { to: "/recommendations", label: "Recommendations", icon: Sparkles, end: false },
  { to: "/backtest", label: "Backtest", icon: FlaskConical, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
];
