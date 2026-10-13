import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "num flex h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-loss aria-[invalid=true]:focus-visible:ring-loss/30",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

/** Input with a fixed prefix/suffix adornment ("$", "%", "days"). */
const AdornedInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { prefix?: string; suffix?: string }
>(({ prefix, suffix, className, ...props }, ref) => (
  <div className="relative">
    {prefix && (
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-muted-foreground">
        {prefix}
      </span>
    )}
    <Input ref={ref} className={cn(prefix && "pl-6", suffix && "pr-12", className)} {...props} />
    {suffix && (
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
        {suffix}
      </span>
    )}
  </div>
));
AdornedInput.displayName = "AdornedInput";

export { AdornedInput, Input };
