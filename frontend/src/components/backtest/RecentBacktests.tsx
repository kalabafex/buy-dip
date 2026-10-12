import { useBacktests } from "@/api/queries";
import { BacktestStatusBadge } from "@/components/badges";
import { ErrorBox } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDateTime, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export function RecentBacktests({ selected, onOpen }: { selected: string | null; onOpen: (id: string) => void }) {
  const q = useBacktests();
  return (
    <>
      <ErrorBox error={q.error} />
      <Table>
        <TableHeader>
          <TableRow>
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
            <TableEmpty colSpan={6}>{q.isPending ? "Loading…" : "No backtests yet"}</TableEmpty>
          ) : (
            q.data.map((b) => (
              <TableRow key={b.id} className={cn(b.id === selected && "bg-muted")}>
                <TableCell className="text-xs text-muted-foreground">{fmtDateTime(b.created_at)}</TableCell>
                <TableCell className="font-medium">
                  {typeof b.rule_snapshot.symbol === "string" ? b.rule_snapshot.symbol : "?"}
                  {!b.rule_id && <span className="ml-1 text-[10px] text-muted-foreground">ad-hoc</span>}
                </TableCell>
                <TableCell className="text-xs">
                  {b.start_date} → {b.end_date}
                </TableCell>
                <TableCell className="text-right">{fmtUsd(b.starting_cash, { compact: true })}</TableCell>
                <TableCell>
                  <BacktestStatusBadge status={b.status} />
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => onOpen(b.id)} disabled={b.id === selected}>
                    Open
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
