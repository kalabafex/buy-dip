import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="scrollbar-thin relative w-full overflow-x-auto">
      <table ref={ref} className={cn("num w-full caption-bottom text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
  ),
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn("border-b border-border/70 transition-colors hover:bg-muted/50", className)}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "h-9 whitespace-nowrap px-3 text-left align-middle text-2xs font-medium uppercase tracking-wider text-muted-foreground first:pl-0 last:pr-0",
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn("whitespace-nowrap px-3 py-2.5 align-middle first:pl-0 last:pr-0", className)}
      {...props}
    />
  ),
);
TableCell.displayName = "TableCell";

/** Full-width single-cell row for empty / loading states (loading → skeleton rows). */
function TableEmpty({
  colSpan,
  children,
  loading,
}: {
  colSpan: number;
  children?: React.ReactNode;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <>
        {[0, 1, 2].map((i) => (
          <TableRow key={i} className="hover:bg-transparent">
            <TableCell colSpan={colSpan}>
              <Skeleton className="h-5" style={{ width: `${92 - i * 14}%` }} />
            </TableCell>
          </TableRow>
        ))}
      </>
    );
  }
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell
        colSpan={colSpan}
        className="whitespace-normal py-8 text-center text-xs text-muted-foreground"
      >
        {children}
      </TableCell>
    </TableRow>
  );
}

export { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow };
