import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** KPI tile: label · value · optional meter/children · sub line. */
export function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  loading,
  hero,
  className,
  valueClassName,
  children,
}: {
  title: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: LucideIcon;
  loading?: boolean;
  hero?: boolean;
  className?: string;
  valueClassName?: string;
  children?: ReactNode;
}) {
  return (
    <Card
      className={cn(
        "flex flex-col gap-2 p-4",
        hero && "bg-gradient-to-br from-card to-primary/[0.04]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-muted-foreground">{title}</span>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />}
      </div>
      {loading ? (
        <Skeleton className={cn("h-7 w-28", hero && "h-9 w-36")} />
      ) : (
        <div
          className={cn(
            "num truncate font-semibold tracking-tight",
            hero ? "text-2xl sm:text-[1.75rem] sm:leading-9" : "text-xl",
            valueClassName,
          )}
        >
          {value}
        </div>
      )}
      {children}
      {sub && <div className="num mt-auto truncate text-2xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}
