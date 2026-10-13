import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-7 w-7 shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-foreground" />
      <path
        d="M6 10l6.5 8.5 4.5-4.5 9 11"
        className="stroke-background"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12.5" cy="18.5" r="2.6" fill="#22c55e" />
    </svg>
  );
}

export function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <BrandMark />
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold tracking-tight text-foreground">Dip Buyer</div>
          <div className="truncate text-2xs text-muted-foreground">Rules-based dip buying</div>
        </div>
      )}
    </div>
  );
}
