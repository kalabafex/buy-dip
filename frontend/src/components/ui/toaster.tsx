import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { dismissToast, subscribeToasts, type ToastItem } from "@/lib/toast";
import { cn } from "@/lib/utils";

const ICON = { success: CheckCircle2, error: XCircle, info: Info } as const;
const TONE = {
  success: "text-gain",
  error: "text-loss",
  info: "text-info",
} as const;

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:bottom-2 sm:right-2 sm:left-auto sm:items-end"
      aria-live="polite"
      role="region"
      aria-label="Notifications"
    >
      {items.map((t) => {
        const Icon = ICON[t.variant];
        return (
          <div
            key={t.id}
            role={t.variant === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-lg border bg-popover p-3 pr-2 text-popover-foreground shadow-pop"
          >
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", TONE[t.variant])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-5">{t.title}</p>
              {t.description && (
                <p className="mt-0.5 break-words text-xs text-muted-foreground">{t.description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
