import { AlertTriangle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { errorText, isApiError } from "@/api/client";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} aria-label="Loading" />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <Spinner /> {label}
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
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        unavailable
          ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          : "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="break-words">{errorText(error)}</span>
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-600 dark:text-red-400">{message}</p>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Colors a signed number: green positive, red negative. */
export function Signed({ value, children }: { value: number | null; children: ReactNode }) {
  const color =
    value === null || value === 0
      ? ""
      : value > 0
        ? "text-green-700 dark:text-green-400"
        : "text-red-700 dark:text-red-400";
  return <span className={color}>{children}</span>;
}
