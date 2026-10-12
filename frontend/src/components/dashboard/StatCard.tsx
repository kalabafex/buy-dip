import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  title,
  value,
  sub,
  className,
  valueClassName,
  children,
}: {
  title: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
  valueClassName?: string;
  children?: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardContent className="grid grid-cols-1 gap-1 p-3">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className={cn("truncate text-lg font-semibold", valueClassName)}>{value}</div>
        {children}
        {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
