import { AlertTriangle, Info, Loader2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { errorText, isApiError } from "@/api/client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Inline busy indicator for buttons only; page/section loading uses skeletons. */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} aria-label="Working" />;
}

/** Generic page placeholder: header + a few cards. */
export function PageSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5" role="status" aria-label="Loading">
      <div className="grid gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

/** Error banner; 503s are styled as a softer "unavailable" warning. */
export function ErrorBox({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const unavailable = isApiError(error, 503);
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm",
        unavailable
          ? "border-warning/30 bg-warning-soft text-warning"
          : "border-loss/30 bg-loss-soft text-loss",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{errorText(error)}</span>
    </div>
  );
}

export function Callout({
  tone = "info",
  title,
  icon: Icon = tone === "info" ? Info : AlertTriangle,
  children,
  className,
}: {
  tone?: "info" | "warning" | "danger";
  title?: ReactNode;
  icon?: LucideIcon;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-info/25 bg-info-soft/60 [&_svg]:text-info",
    warning: "border-warning/30 bg-warning-soft/70 [&_svg]:text-warning",
    danger: "border-loss/30 bg-loss-soft [&_svg]:text-loss",
  };
  return (
    <div className={cn("flex gap-3 rounded-lg border px-3.5 py-3 text-sm", tones[tone], className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-medium leading-5">{title}</p>}
        {children && <div className="text-xs leading-5 text-foreground/80">{children}</div>}
      </div>
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-loss">{message}</p>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <div className="mt-1 max-w-3xl text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-4 py-10 text-center", className)}>
      {Icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <div className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{description}</div>
      )}
      {actions && <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

/** Colors a signed number: gain positive, loss negative. */
export function Signed({
  value,
  children,
  className,
}: {
  value: number | null;
  children: ReactNode;
  className?: string;
}) {
  const color =
    value === null || value === 0 || Number.isNaN(value) ? "" : value > 0 ? "text-gain" : "text-loss";
  return <span className={cn("num", color, className)}>{children}</span>;
}

/** Small label/value pair. */
export function Fact({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="num mt-0.5 break-words text-sm font-medium">{children}</div>
    </div>
  );
}
