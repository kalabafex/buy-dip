import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarClock,
  ChevronDown,
  CirclePause,
  CirclePlay,
  ClipboardCheck,
  Cpu,
  Gauge,
  GitCommitHorizontal,
  Play,
  Scale,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/api/client";
import { qk, usePicksEngine, usePicksModel } from "@/api/queries";
import { Callout, EmptyState, ErrorBox, PageHeader, Signed, Spinner } from "@/components/common";
import { CalibrationChart, CalibrationTable } from "@/components/picks/CalibrationChart";
import { Eyebrow } from "@/components/picks/parts";
import { PicksTabs } from "@/components/picks/sections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeaderRow } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  calibrate,
  certaintyInWords,
  changeValue,
  diffParams,
  isIdentityCalibration,
  pct01,
  setupLabel,
  SETUP_ORDER,
  type EngineParams,
  type EngineVersion,
  type Review,
  type ReviewChange,
  type ReviewStats,
} from "@/lib/engine";
import { fmtDateTime, fmtNum, fmtPct, fmtPts } from "@/lib/format";
import { fmtSessionDate } from "@/lib/picks";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const MULT_MAX = 1.5;

/** Rounded to the shown 2 decimals, so a value displayed as 0.00 is not colored. */
const r2 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100) / 100);

/** Plain decimal with a real minus sign and no "−0.0". */
function fmtSigned(v: number | null | undefined, digits: number): string {
  if (v == null) return "—";
  const body = Math.abs(v).toFixed(digits);
  return `${Number(body) === 0 || v >= 0 ? "" : "−"}${body}`;
}

/** Multiplier on a 0–1.5 track with a 1.0 (unchanged) reference; the bar grows from 1.0. */
function MultiplierBar({ value, label }: { value: number; label: string }) {
  const x = (v: number) => (Math.min(MULT_MAX, Math.max(0, v)) / MULT_MAX) * 100;
  const one = x(1);
  const left = Math.min(one, x(value));
  const width = Math.max(0.8, Math.abs(x(value) - one));
  return (
    <div className="relative h-2 w-full rounded-full bg-muted" role="img" aria-label={`${label}: ×${value.toFixed(2)}`}>
      <span
        aria-hidden
        className={cn("absolute inset-y-0 bg-primary", value >= 1 ? "rounded-r-full" : "rounded-l-full")}
        style={{ left: `${left}%`, width: `${width}%` }}
      />
      <span aria-hidden className="absolute inset-y-[-3px] w-px bg-foreground/50" style={{ left: `${one}%` }} />
    </div>
  );
}

function ReviewNowButton() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.post("/api/picks/engine/review"),
    onSuccess: (rev) => {
      void qc.invalidateQueries({ queryKey: qk.picks });
      toast.success(
        rev.version_after !== rev.version_before
          ? `Review done — engine v${rev.version_after} is now active`
          : "Review done — no changes",
        rev.summary,
      );
    },
    onError: (e) => toast.error("Could not run the review", e),
  });
  return (
    <Button variant="outline" size="sm" onClick={() => m.mutate()} disabled={m.isPending}>
      {m.isPending ? <Spinner /> : <Play />} Review now
    </Button>
  );
}

function ActiveVersion({
  v,
  labels,
  reviewedOn,
}: {
  v: EngineVersion;
  labels: Record<string, string>;
  reviewedOn: string | null;
}) {
  const p = v.params;
  const fams = [...new Set([...SETUP_ORDER, ...Object.keys(labels), ...Object.keys(p.family_multiplier), ...p.suspended])];
  const a = p.certainty_a;
  const b = p.certainty_b;
  const identity = isIdentityCalibration(a, b);
  return (
    <Card>
      <CardContent className="grid gap-5 pt-4 sm:pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <Cpu className="h-4 w-4 text-muted-foreground" aria-hidden />
              Engine v{v.version}
              <Badge variant="success" dot>
                Active
              </Badge>
            </h2>
            <p className="num mt-0.5 text-xs text-muted-foreground">
              Since {fmtDateTime(v.created_at)} ·{" "}
              {v.review_id ? `set by the review of ${reviewedOn ? fmtSessionDate(reviewedOn) : "—"}` : "initial parameters"}
            </p>
          </div>
          <ReviewNowButton />
        </div>
        <div className="grid gap-6 md:grid-cols-2 md:gap-8">
          <section aria-label="Setup multipliers" className="grid content-start gap-2.5">
            <div>
              <Eyebrow>Projection scaling per setup</Eyebrow>
              <p className="mt-0.5 text-2xs leading-4 text-muted-foreground">
                ×1.00 = projections used as computed; below 1 they ran hot live and are scaled down.
              </p>
            </div>
            <ul className="grid gap-2">
              {fams.map((f) => {
                const m = p.family_multiplier[f] ?? 1;
                const susp = p.suspended.includes(f);
                const label = setupLabel(f, labels);
                return (
                  <li key={f} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                    <span className={cn("flex min-w-0 items-center gap-1.5 text-xs", susp && "text-muted-foreground")}>
                      <span className="truncate">{label}</span>
                      {susp && (
                        <Badge variant="warning" className="px-1.5">
                          <CirclePause className="h-3 w-3" aria-hidden /> Suspended
                        </Badge>
                      )}
                    </span>
                    <span className="num text-right text-xs font-semibold">×{m.toFixed(2)}</span>
                    <div className="col-span-2">
                      <MultiplierBar value={m} label={label} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="grid" aria-hidden>
              <div className="num relative h-3 text-[10px] text-muted-foreground">
                <span className="absolute left-0">×0</span>
                <span className="absolute -translate-x-1/2" style={{ left: `${(1 / MULT_MAX) * 100}%` }}>
                  ×1
                </span>
                <span className="absolute right-0">×1.5</span>
              </div>
            </div>
          </section>
          <section aria-label="Certainty calibration" className="grid content-start gap-2.5">
            <Eyebrow>Certainty calibration</Eyebrow>
            <p className="text-sm leading-5">{certaintyInWords(a, b)}</p>
            {!identity && (
              <div className="grid grid-cols-4 gap-2">
                {[0.5, 0.6, 0.7, 0.8].map((raw) => (
                  <div key={raw} className="rounded-lg border bg-muted/30 px-2 py-1.5 text-center">
                    <div className="text-2xs text-muted-foreground">Raw {Math.round(raw * 100)}%</div>
                    <div className="num text-sm font-semibold">{Math.round(calibrate(raw, a, b) * 100)}%</div>
                  </div>
                ))}
              </div>
            )}
            <p className="num text-2xs text-muted-foreground">
              Logistic recalibration: a = {a.toFixed(2)} (spread), b = {b >= 0 ? "+" : "−"}
              {Math.abs(b).toFixed(2)} (shift). a = 1, b = 0 leaves certainties unchanged.
            </p>
            <div className="grid gap-1.5 border-t pt-3">
              <Eyebrow>Suspended setups</Eyebrow>
              {p.suspended.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {p.suspended.map((f) => (
                    <Badge key={f} variant="warning">
                      {setupLabel(f, labels)}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">None — every validated setup can be picked.</p>
              )}
              <p className="text-2xs text-muted-foreground">Suspended setups are still scored and tracked, never picked.</p>
            </div>
          </section>
        </div>
      </CardContent>
    </Card>
  );
}

function VersionHistory({
  versions,
  reviews,
  labels,
}: {
  versions: EngineVersion[];
  reviews: Review[];
  labels: Record<string, string>;
}) {
  const byId = new Map(reviews.map((r) => [r.id, r]));
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  return (
    <Card>
      <CardHeaderRow
        title={
          <>
            <GitCommitHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden /> Version history
          </>
        }
      />
      <CardContent>
        <ol className="grid">
          {sorted.map((v, i) => {
            const prev: EngineParams | null = sorted[i + 1]?.params ?? null;
            const d = diffParams(prev, v.params, labels);
            const rev = v.review_id ? byId.get(v.review_id) : undefined;
            return (
              <li key={v.version} className="group/v relative flex gap-3 pb-4 last:pb-0">
                <span aria-hidden className="absolute bottom-0 left-[0.6875rem] top-6 w-px bg-border group-last/v:hidden" />
                <span
                  className={cn(
                    "num relative z-[1] flex h-[1.375rem] min-w-[1.375rem] items-center justify-center rounded-full border px-1 text-2xs font-semibold",
                    i === 0 ? "border-primary/40 bg-primary text-primary-foreground" : "bg-card text-muted-foreground",
                  )}
                >
                  {v.version}
                </span>
                <div className="min-w-0 pt-px">
                  <div className="text-sm font-medium leading-5">
                    v{v.version}
                    <span className="num ml-2 text-2xs font-normal text-muted-foreground">
                      {rev ? fmtSessionDate(rev.reviewed_on, { year: false }) : fmtDateTime(v.created_at)}
                    </span>
                  </div>
                  {prev === null ? (
                    <p className="text-2xs text-muted-foreground">Initial: all setups ×1.00, no recalibration.</p>
                  ) : d.length ? (
                    <ul className="mt-0.5 grid gap-0.5">
                      {d.map((x, j) => (
                        <li key={j} className="num text-2xs text-muted-foreground">
                          {x.text}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-2xs text-muted-foreground">No parameter differences.</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

const CHANGE_META = {
  multiplier: { icon: Scale, cls: "border-info/30 bg-info-soft text-info" },
  suspend: { icon: CirclePause, cls: "border-warning/30 bg-warning-soft text-warning" },
  unsuspend: { icon: CirclePlay, cls: "border-gain/30 bg-gain-soft text-gain" },
  certainty: { icon: Gauge, cls: "border-info/30 bg-info-soft text-info" },
} as const;

function ChangeTitle({ c, labels }: { c: ReviewChange; labels: Record<string, string> }) {
  const fam = c.family ? setupLabel(c.family, labels) : null;
  const from = changeValue(c.from);
  const to = changeValue(c.to);
  if (c.kind === "multiplier" && typeof from === "number" && typeof to === "number") {
    return (
      <>
        {fam} projections{" "}
        <span className="num whitespace-nowrap">
          ×{from.toFixed(2)} <ArrowRight className="inline h-3 w-3" aria-label="to" /> ×{to.toFixed(2)}
        </span>
      </>
    );
  }
  if (c.kind === "certainty" && from && to && typeof from === "object" && typeof to === "object") {
    return (
      <>
        Certainty recalibrated{" "}
        <span className="num whitespace-nowrap text-muted-foreground">
          (a {from.a.toFixed(2)} → {to.a.toFixed(2)}, b {from.b.toFixed(2)} → {to.b.toFixed(2)})
        </span>
      </>
    );
  }
  if (c.kind === "suspend") return <>{fam} suspended from picks</>;
  if (c.kind === "unsuspend") return <>{fam} allowed again</>;
  return <>{fam ?? c.kind}</>;
}

function Changes({ review, labels }: { review: Review; labels: Record<string, string> }) {
  if (!review.changes.length) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
        No parameter changes — the evidence did not justify any. Changes need at least 20 candidates of a setup
        (scaling), 30 with t ≤ −2 (suspension) or 60 overall (certainty).
      </p>
    );
  }
  return (
    <ul className="grid gap-2">
      {review.changes.map((c, i) => {
        const m = CHANGE_META[c.kind as keyof typeof CHANGE_META] ?? CHANGE_META.multiplier;
        return (
          <li key={i} className="flex gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
            <span className={cn("mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full border", m.cls)}>
              <m.icon className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium leading-5">
                <ChangeTitle c={c} labels={labels} />
              </div>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{c.reason}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

type Row = { label: string; hint?: string; f: (s: ReviewStats) => React.ReactNode };

const STAT_ROWS: Row[] = [
  { label: "Candidates", f: (s) => fmtNum(s.n, 0) },
  { label: "Projected, avg", f: (s) => fmtPct(s.projected_mean_pct, 2, true) },
  {
    label: "Realized (plan), avg",
    f: (s) => <Signed value={r2(s.realized_mean_pct)}>{fmtPct(s.realized_mean_pct, 2, true)}</Signed>,
  },
  {
    label: "Bias",
    hint: "realized − projected",
    f: (s) => <Signed value={r2(s.bias_pct)}>{fmtPts(s.bias_pct, 2)}</Signed>,
  },
  { label: "Mean abs. error", f: (s) => (s.mae_pct == null ? "—" : `${s.mae_pct.toFixed(2)} pts`) },
  { label: "Direction right", hint: "sign of projected = realized", f: (s) => pct01(s.direction_hit_rate) },
  { label: "Certainty, avg", f: (s) => pct01(s.avg_certainty) },
  { label: "Actual win rate", f: (s) => pct01(s.win_rate) },
  { label: "Brier score", hint: "lower is better; 0.25 = coin flip", f: (s) => (s.brier == null ? "—" : s.brier.toFixed(3)) },
  { label: "t-stat of realized", f: (s) => fmtSigned(s.t_stat, 1) },
];

function StatsTable({ review }: { review: Review }) {
  const cols: { label: string; sub: string; s: ReviewStats; strong?: boolean }[] = [
    { label: "This week", sub: "all scored", s: review.week_all },
    { label: `${Math.round(review.window_days / 7)} weeks`, sub: "all scored", s: review.window_all, strong: true },
    { label: `${Math.round(review.window_days / 7)} weeks`, sub: "picks only", s: review.window_picks },
  ];
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="num w-full min-w-[20rem] text-xs">
        <caption className="sr-only">Projected versus realized, this week and the review window</caption>
        <thead>
          <tr className="border-b text-2xs uppercase tracking-wider text-muted-foreground">
            <th scope="col" className="py-1.5 text-left font-medium">
              <span className="sr-only">Statistic</span>
            </th>
            {cols.map((c, i) => (
              <th key={i} scope="col" className={cn("py-1.5 pl-3 text-right font-medium", c.strong && "text-foreground")}>
                {c.label}
                <span className="block text-[10px] font-normal normal-case tracking-normal text-muted-foreground">{c.sub}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {STAT_ROWS.map((r) => (
            <tr key={r.label} className="border-b border-border/60 last:border-0">
              <th scope="row" className="py-1.5 text-left font-normal text-muted-foreground">
                {r.label}
                {r.hint && <span className="hidden text-[10px] text-muted-foreground/80 sm:inline"> · {r.hint}</span>}
              </th>
              {cols.map((c, i) => (
                <td key={i} className={cn("py-1.5 pl-3 text-right", c.strong ? "font-semibold" : "text-muted-foreground")}>
                  {c.s.n === 0 && r.label !== "Candidates" ? "—" : r.f(c.s)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Headline({ review }: { review: Review }) {
  const w = review.window_all;
  const items = [
    {
      label: "Projected vs realized",
      value: (
        <>
          {fmtPct(w.projected_mean_pct, 2, true)}{" "}
          <span className="text-muted-foreground">→</span>{" "}
          <Signed value={r2(w.realized_mean_pct)}>{fmtPct(w.realized_mean_pct, 2, true)}</Signed>
        </>
      ),
      sub: `bias ${fmtPts(w.bias_pct, 2)}`,
    },
    {
      label: "Certainty vs actual",
      value: (
        <>
          {pct01(w.avg_certainty)} <span className="text-muted-foreground">→</span> {pct01(w.win_rate)}
        </>
      ),
      sub: `Brier ${w.brier == null ? "—" : w.brier.toFixed(3)}`,
    },
    { label: "Direction right", value: pct01(w.direction_hit_rate), sub: "sign of projected = realized" },
    { label: "Scored candidates", value: fmtNum(w.n, 0), sub: `${review.week_all.n} this week` },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="min-w-0 rounded-lg border bg-muted/30 px-3 py-2">
          <dt className="text-2xs text-muted-foreground">{it.label}</dt>
          <dd className="proportional mt-0.5 text-base font-semibold leading-6 tracking-tight">{it.value}</dd>
          <dd className="num text-2xs leading-4 text-muted-foreground">{it.sub}</dd>
        </div>
      ))}
    </dl>
  );
}

function FamiliesTable({ review, labels }: { review: Review; labels: Record<string, string> }) {
  const rows = Object.entries(review.families).sort((a, b) => b[1].n - a[1].n);
  const before = review.params_before;
  const after = review.params_after;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Setup</TableHead>
          <TableHead className="text-right">n</TableHead>
          <TableHead className="text-right">Projected</TableHead>
          <TableHead className="text-right">Realized</TableHead>
          <TableHead className="text-right">Bias</TableHead>
          <TableHead className="text-right">Won</TableHead>
          <TableHead className="text-right">Certainty</TableHead>
          <TableHead className="text-right">t</TableHead>
          <TableHead className="text-right">Scale</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(([f, s]) => {
          const mb = before.family_multiplier[f] ?? 1;
          const ma = after.family_multiplier[f] ?? 1;
          const susp = after.suspended.includes(f);
          const wasSusp = before.suspended.includes(f);
          return (
            <TableRow key={f}>
              <TableCell className="max-w-[14rem] whitespace-normal">
                <div className="text-xs font-medium">{s.label ?? setupLabel(f, labels)}</div>
                {susp ? (
                  <Badge variant="warning" className="mt-0.5">
                    {wasSusp ? "Suspended" : "Suspended now"}
                  </Badge>
                ) : wasSusp ? (
                  <Badge variant="success" className="mt-0.5">
                    Reinstated
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell className="text-right">{s.n}</TableCell>
              <TableCell className="text-right text-muted-foreground">{fmtPct(s.projected_mean_pct, 2, true)}</TableCell>
              <TableCell className="text-right">
                <Signed value={r2(s.realized_mean_pct)}>{fmtPct(s.realized_mean_pct, 2, true)}</Signed>
              </TableCell>
              <TableCell className="text-right">
                <Signed value={r2(s.bias_pct)}>{fmtPts(s.bias_pct, 2)}</Signed>
              </TableCell>
              <TableCell className="text-right">{pct01(s.win_rate)}</TableCell>
              <TableCell className="text-right text-muted-foreground">{pct01(s.avg_certainty)}</TableCell>
              <TableCell className={cn("text-right", (s.t_stat ?? 0) <= -2 && "font-semibold text-loss")}>
                {fmtSigned(s.t_stat, 1)}
              </TableCell>
              <TableCell className="text-right">
                {Math.abs(ma - mb) >= 0.005 ? (
                  <span className="font-semibold">
                    <span className="font-normal text-muted-foreground">×{mb.toFixed(2)} → </span>×{ma.toFixed(2)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">×{ma.toFixed(2)}</span>
                )}
                {s.implied_multiplier != null && (
                  <div className="text-[10px] text-muted-foreground">implied ×{fmtSigned(s.implied_multiplier, 2)}</div>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ReviewCard({
  review,
  labels,
  defaultOpen,
}: {
  review: Review;
  labels: Record<string, string>;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const changed = review.version_after !== review.version_before;
  const cert = review.certainty;
  const id = `review-${review.id}`;
  return (
    <Card aria-label={`Review of ${review.reviewed_on}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start justify-between gap-3 rounded-xl px-4 py-3.5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight">Review of {fmtSessionDate(review.reviewed_on)}</h3>
            {changed ? (
              <Badge variant="info">
                v{review.version_before} <ArrowRight className="h-3 w-3" aria-label="to" /> v{review.version_after}
              </Badge>
            ) : (
              <Badge variant="outline">No change · v{review.version_after}</Badge>
            )}
            {review.changes.length > 0 && (
              <span className="text-2xs text-muted-foreground">
                {review.changes.length} change{review.changes.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{review.summary}</p>
        </div>
        <ChevronDown
          className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open && (
        <div id={id} className="grid gap-6 border-t px-4 py-4 sm:px-5 sm:py-5">
          <section aria-label="Changes" className="grid gap-2">
            <Eyebrow>Changes</Eyebrow>
            <Changes review={review} labels={labels} />
          </section>
          <section aria-label="Projected versus realized" className="grid gap-3">
            <Eyebrow>Predictions vs outcomes · last {Math.round(review.window_days / 7)} weeks, all scored candidates</Eyebrow>
            <Headline review={review} />
            <StatsTable review={review} />
          </section>
          <section aria-label="Certainty calibration" className="grid gap-3">
            <div>
              <Eyebrow>Is certainty honest?</Eyebrow>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Candidates grouped by the certainty they were given; a well-calibrated engine sits on the diagonal.
                Red gaps below it mean it was overconfident.
              </p>
            </div>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <CalibrationChart bins={review.calibration} />
              <div className="grid content-start gap-3">
                <CalibrationTable bins={review.calibration} />
                {cert.brier_before != null && cert.brier_after != null && (
                  <p className="num text-2xs leading-4 text-muted-foreground">
                    Recalibration fit a = {fmtNum(cert.fit_a, 2)}, b = {fmtNum(cert.fit_b, 2)} · Brier{" "}
                    {cert.brier_before.toFixed(3)} → {cert.brier_after.toFixed(3)} with the new (half-step) setting.
                  </p>
                )}
              </div>
            </div>
          </section>
          <section aria-label="Per setup" className="grid gap-2">
            <Eyebrow>Per setup</Eyebrow>
            <FamiliesTable review={review} labels={labels} />
          </section>
          <p className="num text-2xs text-muted-foreground">Ran {fmtDateTime(review.created_at)}</p>
        </div>
      )}
    </Card>
  );
}

function HowItWorks() {
  return (
    <Callout tone="info" title="How the weekly review works">
      <ul className="list-disc space-y-1 pl-4">
        <li>Every weekend it compares projections and certainties with what following each plan returned, for the picks and the runners-up of the last 8 weeks.</li>
        <li>A setup's scaling moves 30% of the way toward realized ÷ projected (≥ 20 candidates, bounded 0–1.5).</li>
        <li>A setup that loses live (≥ 30 candidates, t ≤ −2) is suspended until it recovers.</li>
        <li>Certainty is recalibrated halfway toward the best fit (≥ 60 candidates).</li>
      </ul>
    </Callout>
  );
}

export function PicksEnginePage() {
  const q = usePicksEngine();
  const model = usePicksModel();
  const e = q.data;
  const labels: Record<string, string> = {};
  for (const f of model.data?.families ?? []) labels[f.family] = f.label;
  for (const r of e?.reviews ?? []) for (const [k, s] of Object.entries(r.families)) if (s.label) labels[k] ??= s.label;

  const header = (
    <PageHeader
      title="Picks engine"
      subtitle="The parameters that turn each setup's history into a projected move and a certainty, and the weekly reviews that check them against live results."
      actions={<PicksTabs />}
    />
  );

  if (q.isPending) {
    return (
      <div className="grid grid-cols-1 gap-5" role="status" aria-label="Loading">
        {header}
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }
  if (!e) {
    return (
      <div className="grid grid-cols-1 gap-5">
        {header}
        <ErrorBox error={q.error ?? new Error("Could not load the engine.")} />
      </div>
    );
  }
  const reviewOf = new Map(e.reviews.map((r) => [r.id, r.reviewed_on]));
  return (
    <div className="grid grid-cols-1 gap-5">
      {header}
      <ErrorBox error={q.error} />
      <ActiveVersion v={e.active} labels={labels} reviewedOn={e.active.review_id ? (reviewOf.get(e.active.review_id) ?? null) : null} />
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label="Weekly reviews" className="grid min-w-0 gap-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" aria-hidden /> Weekly reviews
            {e.reviews.length > 0 && <span className="text-2xs font-normal text-muted-foreground">{e.reviews.length}</span>}
          </h2>
          {e.reviews.length === 0 ? (
            <Card>
              <EmptyState
                icon={CalendarClock}
                title="No reviews yet"
                description="The engine reviews itself every weekend (or Friday after the close) once picks and runners-up have results. Each review compares projections and certainties with what actually happened and may publish a new version. You can also run one now."
                actions={<ReviewNowButton />}
                className="py-12"
              />
            </Card>
          ) : (
            e.reviews.map((r, i) => <ReviewCard key={r.id} review={r} labels={labels} defaultOpen={i === 0} />)
          )}
        </section>
        <div className="grid gap-5 xl:sticky xl:top-20">
          <VersionHistory versions={e.versions} reviews={e.reviews} labels={labels} />
          <HowItWorks />
        </div>
      </div>
    </div>
  );
}
