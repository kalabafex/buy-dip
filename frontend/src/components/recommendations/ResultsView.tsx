import { CalendarRange, ChevronDown, FlaskConical, Layers, Scale, SearchX } from "lucide-react";
import { useState } from "react";
import type { Schemas } from "@/api/client";
import { Callout, EmptyState, Signed } from "@/components/common";
import { RecommendationCard } from "@/components/recommendations/RecommendationCard";
import { ConfidenceBadge, type RecItem } from "@/components/recommendations/parts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDay, fmtMonth, fmtPct, fmtPts } from "@/lib/format";

function Summary({ r, run }: { r: Schemas["RecommendationResults"]; run: Schemas["RecommendationOut"] }) {
  const facts = [
    {
      icon: CalendarRange,
      label: "History",
      value: `${fmtMonth(r.history.first)} – ${fmtMonth(r.history.last)}`,
    },
    { icon: Layers, label: "Candidates", value: `${r.candidates_tested} rules` },
    { icon: FlaskConical, label: "Windows", value: `${r.windows} × ${r.window_years}-year` },
    { icon: Scale, label: "Split", value: r.split_date ? fmtDay(r.split_date) : "—" },
  ];
  return (
    <Card>
      <CardContent className="grid gap-4 pt-5 sm:pt-5">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {r.symbol}: top {r.recommendations.length} of {r.candidates_tested} rules
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Each candidate was backtested against monthly DCA (same dollars) in {r.windows} rolling{" "}
            {r.window_years}-year windows. Windows starting before{" "}
            {r.split_date ? fmtDay(r.split_date) : "the split"} were used to{" "}
            <span className="font-medium text-foreground">select</span> rules; later ones{" "}
            <span className="font-medium text-foreground">validate</span> them on data they were not picked
            from. Budget ${Number(run.budget_per_dip_usd).toLocaleString()} per dip, max position $
            {Number(run.max_position_usd).toLocaleString()}.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label} className="flex items-center gap-2.5 rounded-lg border bg-muted/30 px-3 py-2">
              <f.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <dt className="text-2xs text-muted-foreground">{f.label}</dt>
                <dd className="num text-xs font-semibold">{f.value}</dd>
              </div>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export function Caveats() {
  return (
    <Callout tone="warning" title="Backtests describe the past; they don't predict the future">
      <ul className="list-disc space-y-1 pl-4">
        <li>
          A rule can beat DCA in most 3-year windows yet trail it over the whole period: dip buys happen
          later, so less money is invested during long rallies. Compare the whole-period returns on each card.
        </li>
        <li>
          Fills are simulated on daily bars from your Alpaca data feed (IEX on the free plan), with
          approximations, so real fills will differ. Ranking favors rules that won consistently in both
          halves, not the single best return.
        </li>
      </ul>
    </Callout>
  );
}

function Delta({ value, unit }: { value: number; unit: "pts" | "pct" }) {
  return (
    <Signed value={value}>
      {unit === "pts"
        ? fmtPts(value)
        : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(0)} pp`}
    </Signed>
  );
}

/** The app's default rule as a muted comparison against the top pick. */
function ReferenceRow({
  refItem,
  top,
  run,
  splitDate,
}: {
  refItem: RecItem;
  top: RecItem | undefined;
  run: Schemas["RecommendationOut"];
  splitDate: string | null;
}) {
  const [open, setOpen] = useState(false);
  const refRet = Number(refItem.full_period.rule.return_pct);
  const cells = [
    {
      label: "Validation beat-DCA",
      value: `${Math.round(refItem.validation.win_rate * 100)}%`,
      delta: top ? (
        <Delta value={(top.validation.win_rate - refItem.validation.win_rate) * 100} unit="pct" />
      ) : null,
    },
    {
      label: "Median edge (val.)",
      value: fmtPts(refItem.validation.median_edge_pct),
      delta: top ? (
        <Delta value={top.validation.median_edge_pct - refItem.validation.median_edge_pct} unit="pts" />
      ) : null,
    },
    {
      label: "Whole-period return",
      value: fmtPct(refRet, 1, true),
      delta: top ? <Delta value={Number(top.full_period.rule.return_pct) - refRet} unit="pts" /> : null,
    },
    { label: "Buys / year", value: refItem.buys_per_year.toFixed(1), delta: null },
  ];
  return (
    <div className="grid gap-3">
      <Card className="border-dashed bg-muted/20 shadow-none">
        <CardContent className="grid gap-3 pt-4 sm:pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                For comparison
              </div>
              <div className="mt-0.5 text-sm font-medium">{refItem.label}</div>
            </div>
            <ConfidenceBadge confidence={refItem.confidence} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {cells.map((c) => (
              <div key={c.label} className="min-w-0">
                <div className="text-2xs text-muted-foreground">{c.label}</div>
                <div className="num text-sm font-semibold text-muted-foreground">{c.value}</div>
                {c.delta && <div className="num text-2xs">top pick {c.delta}</div>}
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            <ChevronDown className={open ? "rotate-180 transition-transform" : "transition-transform"} />
            {open ? "Hide details" : "Show details"}
          </Button>
        </CardContent>
      </Card>
      {open && (
        <RecommendationCard
          item={refItem}
          runId={run.id}
          splitDate={splitDate}
          budgetPerDip={run.budget_per_dip_usd}
            maxPosition={run.max_position_usd}
          reference
        />
      )}
    </div>
  );
}

export function ResultsView({
  run,
  results,
}: {
  run: Schemas["RecommendationOut"];
  results: Schemas["RecommendationResults"];
}) {
  const top = results.recommendations[0];
  return (
    <div className="grid gap-5">
      <Summary r={results} run={run} />
      <Caveats />
      {results.recommendations.length === 0 ? (
        <Card>
          <EmptyState
            icon={SearchX}
            title="No candidate qualified"
            description="None of the tested rules produced buys in enough windows. Try more years of history or another symbol."
          />
        </Card>
      ) : (
        results.recommendations.map((item, i) => (
          <RecommendationCard
            key={item.key}
            item={item}
            rank={i + 1}
            runId={run.id}
            splitDate={results.split_date}
            budgetPerDip={run.budget_per_dip_usd}
            maxPosition={run.max_position_usd}
          />
        ))
      )}
      {results.reference && (
        <ReferenceRow refItem={results.reference} top={top} run={run} splitDate={results.split_date} />
      )}
    </div>
  );
}
