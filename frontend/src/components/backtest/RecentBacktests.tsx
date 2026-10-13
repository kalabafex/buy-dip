import { History } from "lucide-react";
import { useBacktests } from "@/api/queries";
import { JobStatusBadge } from "@/components/badges";
import { EmptyState, ErrorBox } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDateTime, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export function RecentBacktests({
  selected,
  onOpen,
}: {
  selected: string | null;
  onOpen: (id: string) => void;
}) {
  const q = useBacktests();
  if (!q.isPending && !q.error && !q.data?.length) {
    return (
      <EmptyState
        icon={History}
        title={"No backtests yet"}
        description="Run one above to compare a rule with monthly DCA."
        className="py-8"
      />
    );
  }
  return (
    <>
      <ErrorBox error={q.error} />
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Created</TableHead>
            <TableHead>Symbol</TableHead>
            <TableHead>Range</TableHead>
            <TableHead className="text-right">Cash</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {!q.data?.length ? (
            <TableEmpty colSpan={6} loading={q.isPending}>
              No backtests yet. Run one above to compare a rule with monthly DCA.
            </TableEmpty>
          ) : (
            q.data.map((b) => (
              <TableRow
                key={b.id}
                className={cn(b.id === selected && "bg-primary/[0.06] hover:bg-primary/[0.08]")}
              >
                <TableCell className="text-xs text-muted-foreground">{fmtDateTime(b.created_at)}</TableCell>
                <TableCell className="font-semibold">
                  <span className="flex items-center gap-1.5">
                    {typeof b.rule_snapshot.symbol === "string" ? b.rule_snapshot.symbol : "?"}
                    {!b.rule_id && <Badge variant="outline">ad-hoc</Badge>}
                  </span>
                </TableCell>
                <TableCell className="text-xs">
                  {b.start_date} → {b.end_date}
                </TableCell>
                <TableCell className="text-right">{fmtUsd(b.starting_cash, { compact: true })}</TableCell>
                <TableCell>
                  <JobStatusBadge status={b.status} />
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onOpen(b.id)}
                    disabled={b.id === selected}
                  >
                    {b.id === selected ? "Open" : "View"}
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </>
  );
}
