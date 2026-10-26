import { Check, ChevronRight, ListOrdered, X } from "lucide-react";
import { Fragment, useState } from "react";
import { usePicksCandidates } from "@/api/queries";
import { ErrorBox, Signed } from "@/components/common";
import { ReasonsList } from "@/components/picks/WhyThisPick";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeaderRow } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtPct, fmtPrice } from "@/lib/format";
import { fmtRangePct, isSuspendedByReasons, type Candidate } from "@/lib/engine";
import { exitReasonText, num } from "@/lib/picks";
import type { Live } from "@/lib/live";
import { cn } from "@/lib/utils";

const INITIAL_ROWS = 10;

function StateBadge({ c }: { c: Candidate }) {
  if (c.eligible) return <Badge variant="secondary">Eligible</Badge>;
  if (isSuspendedByReasons(c.reasons))
    return (
      <Badge variant="warning" title="Suspended by the weekly review after poor live results; still tracked">
        Suspended
      </Badge>
    );
  return (
    <Badge variant="outline" title="Setup has no validated edge; tracked but never traded">
      Not validated
    </Badge>
  );
}

function Result({ c }: { c: Candidate }) {
  const r = num(c.plan_return_pct);
  if (r === null) return <span className="text-2xs text-muted-foreground">after close</span>;
  const win = r > 0;
  return (
    <span className="inline-flex items-center justify-end gap-1.5" title={exitReasonText(c.plan_exit_reason, true)}>
      <Signed value={r}>{fmtPct(r, 2, true)}</Signed>
      {win ? (
        <Check className="h-3.5 w-3.5 text-gain" aria-label="ended positive" />
      ) : (
        <X className="h-3.5 w-3.5 text-loss" aria-label="did not end positive" />
      )}
    </span>
  );
}

function LiveCell({ q }: { q: Live | undefined }) {
  if (!q) return <TableCell className="text-right text-2xs text-muted-foreground">—</TableCell>;
  return (
    <TableCell className="num text-right">
      <div>{fmtPrice(q.price)}</div>
      <Signed value={q.changePct} className="text-2xs">
        {fmtPct(q.changePct, 2, true)}
      </Signed>
    </TableCell>
  );
}

/** Runners-up of a day (scored but not picked) — tracked so the weekly review has more evidence. */
export function RunnersUp({ date, enabled, live }: { date: string; enabled: boolean; live?: Map<string, Live> }) {
  const q = usePicksCandidates(date, enabled);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [all, setAll] = useState(false);
  const rows = (q.data ?? []).filter((c) => !c.chosen);
  const chosen = (q.data ?? []).filter((c) => c.chosen);
  if (!q.isPending && !q.error && rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, INITIAL_ROWS);
  const evaluated = rows.filter((c) => c.plan_return_pct != null);
  const avg = evaluated.length
    ? evaluated.reduce((a, c) => a + (num(c.plan_return_pct) ?? 0), 0) / evaluated.length
    : null;
  const wins = evaluated.filter((c) => (num(c.plan_return_pct) ?? 0) > 0).length;
  const chosenEval = chosen.filter((c) => c.plan_return_pct != null);
  const chosenAvg = chosenEval.length
    ? chosenEval.reduce((a, c) => a + (num(c.plan_return_pct) ?? 0), 0) / chosenEval.length
    : null;
  const hasLive = !!live && rows.some((c) => live.has(c.symbol));
  const cols = hasLive ? 7 : 6;
  const toggle = (rank: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(rank)) n.delete(rank);
      else n.add(rank);
      return n;
    });

  return (
    <Card>
      <CardHeaderRow
        title={
          <>
            <ListOrdered className="h-4 w-4 text-muted-foreground" aria-hidden /> Also scored today
          </>
        }
        description="The best runners-up are tracked like the picks (plan result after the close), so the weekly review has more evidence than three trades a day."
      />
      <CardContent className="grid gap-3">
        <ErrorBox error={q.error} />
        {avg !== null && (
          <p className="num rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Runners-up after the close:{" "}
            <Signed value={avg} className="font-semibold">
              {fmtPct(avg, 2, true)}
            </Signed>{" "}
            average plan return, <span className="font-medium text-foreground">{wins}</span> of {evaluated.length}{" "}
            ended positive
            {chosenAvg !== null && (
              <>
                {" "}
                · the 3 picks averaged{" "}
                <Signed value={chosenAvg} className="font-semibold">
                  {fmtPct(chosenAvg, 2, true)}
                </Signed>
              </>
            )}
          </p>
        )}
        <Table className="[&_td]:px-2 [&_th]:px-2 sm:[&_td]:px-3 sm:[&_th]:px-3 [&_td:first-child]:pl-0 [&_td:last-child]:pr-0 [&_th:first-child]:pl-0 [&_th:last-child]:pr-0">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">#</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead className="text-right">Projected</TableHead>
              {hasLive && <TableHead className="text-right">Now</TableHead>}
              <TableHead className="hidden text-right sm:table-cell">Certainty</TableHead>
              <TableHead className="hidden sm:table-cell">State</TableHead>
              <TableHead className="text-right">Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.isPending ? (
              <TableEmpty colSpan={cols} loading />
            ) : (
              shown.map((c) => {
                const isOpen = open.has(c.score_rank);
                const proj = num(c.projected_move_pct);
                const id = `cand-${c.score_rank}`;
                return (
                  <Fragment key={c.score_rank}>
                    <TableRow
                      className={cn("cursor-pointer", isOpen && "border-b-0 bg-muted/40 hover:bg-muted/40")}
                      onClick={() => toggle(c.score_rank)}
                    >
                      <TableCell className="text-muted-foreground">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-controls={id}
                          aria-label={`${isOpen ? "Hide" : "Show"} reasons for ${c.symbol}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(c.score_rank);
                          }}
                          className="-ml-1 inline-flex items-center gap-0.5 rounded px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ChevronRight
                            className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-90")}
                            aria-hidden
                          />
                          {c.score_rank}
                        </button>
                      </TableCell>
                      <TableCell className="max-w-[13rem] whitespace-normal" title={c.name}>
                        <div className="font-semibold">{c.symbol}</div>
                        <div className="text-2xs leading-4 text-muted-foreground sm:truncate">{c.family_label}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Signed value={proj}>{fmtPct(proj, 2, true)}</Signed>
                        <div className="text-2xs text-muted-foreground sm:hidden">
                          {Math.round(num(c.certainty_pct) ?? 0)}% certain
                        </div>
                        <div className="hidden text-2xs text-muted-foreground lg:block">
                          {fmtRangePct(num(c.projected_low_pct) ?? 0)} to {fmtRangePct(num(c.projected_high_pct) ?? 0)}
                        </div>
                      </TableCell>
                      {hasLive && <LiveCell q={live?.get(c.symbol)} />}
                      <TableCell className="hidden text-right sm:table-cell">{Math.round(num(c.certainty_pct) ?? 0)}%</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <StateBadge c={c} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Result c={c} />
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow id={id} className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={cols} className="whitespace-normal pb-4 pt-1">
                          <div className="grid gap-2 sm:pl-5">
                            <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                              <span className="sm:hidden">
                                <StateBadge c={c} />
                              </span>
                              <span className="font-medium text-foreground">{c.name}</span>
                              <span>· {c.family_label}</span>
                            </div>
                            <ReasonsList reasons={c.reasons} compact />
                            {c.plan_exit_reason && (
                              <p className="text-2xs text-muted-foreground">
                                Plan result: {exitReasonText(c.plan_exit_reason, true)} · engine v{c.engine_version}
                              </p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
        {rows.length > INITIAL_ROWS && (
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" onClick={() => setAll((a) => !a)}>
              {all ? "Show fewer" : `Show all ${rows.length} runners-up`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
