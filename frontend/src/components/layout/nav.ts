import {
  CalendarCheck,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end: boolean;
  /** Extra path prefixes that also mark this item active (e.g. sub-pages). */
  match?: string[];
};

export const NAV: NavItem[] = [
  { to: "/", label: "Daily picks", icon: CalendarCheck, end: true, match: ["/picks"] },
  { to: "/dashboard", label: "Account", icon: LayoutDashboard, end: false },
  { to: "/rules", label: "Rules", icon: ListChecks, end: false },
  { to: "/recommendations", label: "Recommendations", icon: Sparkles, end: false },
  { to: "/backtest", label: "Backtest", icon: FlaskConical, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
];
