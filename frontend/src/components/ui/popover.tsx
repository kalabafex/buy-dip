import { Info } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Tiny click/tap popover for a short explanation next to a label. Closes on Escape and on
 * a click outside; keyboard accessible (button + aria-expanded + labelled region).
 */
export function InfoPopover({
  label,
  title,
  children,
  className,
  align = "start",
}: {
  /** Accessible name of the trigger, e.g. "About this setup". */
  label: string;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={root} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open && "bg-accent text-foreground",
        )}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <span
          id={id}
          role="dialog"
          aria-label={label}
          className={cn(
            "absolute top-full z-30 mt-1.5 block w-72 max-w-[calc(100vw-3rem)] animate-fade-in rounded-lg border bg-popover p-3 text-left text-xs font-normal normal-case leading-5 tracking-normal text-popover-foreground shadow-pop",
            align === "start" ? "left-0" : "right-0",
          )}
        >
          {title && <span className="mb-1 block text-sm font-semibold">{title}</span>}
          <span className="block text-muted-foreground">{children}</span>
        </span>
      )}
    </span>
  );
}
