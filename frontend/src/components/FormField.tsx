import type { ReactNode } from "react";
import { FieldError } from "@/components/common";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function FormField({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id?: string;
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <FieldError message={error} />
      ) : (
        hint && <p className="text-2xs leading-4 text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** Titled group of fields inside a form. */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("grid grid-cols-1 gap-4 border-t pt-5 first:border-t-0 first:pt-0", className)}>
      <div>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {description && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
