import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleSlash, Radar } from "lucide-react";
import type { ReactNode } from "react";
import { useWatch, type Control } from "react-hook-form";
import { api, type Schemas } from "@/api/client";
import { qk, useRulePreview } from "@/api/queries";
import { EmptyState, ErrorBox, Fact, Spinner } from "@/components/common";
import { ruleSchema, toRuleParams, type RuleFormValues } from "@/components/rules/ruleSchema";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeaderRow } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import { SkeletonRows } from "@/components/ui/skeleton";
import { fmtDate, fmtNum, fmtPct, fmtPrice, fmtUsd, tierLabel } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";

function Chip({ ok, yes, no, label }: { ok: boolean; yes: string; no: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Badge variant={ok ? "success" : "secondary"}>
        {ok ? (
          <CheckCircle2 className="h-3 w-3" aria-hidden />
        ) : (
          <CircleSlash className="h-3 w-3" aria-hidden />
        )}
        {ok ? yes : no}
      </Badge>
    </div>
  );
}

export function PreviewView({
  data,
  triggerType,
}: {
  data: Schemas["PreviewOut"];
  triggerType?: Schemas["TriggerType"];
}) {
  const last = Number(data.last);
  const pullback = Number(data.pullback_pct ?? 0);
  const refDiffers = data.ref_high !== null && data.ref_high !== data.high_n;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-4 gap-y-3">
        <Fact label="Last">{fmtPrice(data.last)}</Fact>
        <Fact label="N-day high">{fmtPrice(data.high_n)}</Fact>
        <Fact label="Pullback">{fmtPct(data.pullback_pct)}</Fact>
        <Fact label="RSI14">{fmtNum(data.rsi14, 1)}</Fact>
        {refDiffers && <Fact label="Cycle ref high">{fmtPrice(data.ref_high)}</Fact>}
        <Fact label="SMA50">{fmtPrice(data.sma50)}</Fact>
        <Fact label="SMA200">{fmtPrice(data.sma200)}</Fact>
        {(triggerType === "BELOW_MA" || data.sma_rule !== null) && (
          <Fact label="Rule SMA">{fmtPrice(data.sma_rule)}</Fact>
        )}
        <Fact label="Latest bar">{fmtDate(data.latest_bar_date)}</Fact>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
        <Chip label="Condition" ok={data.condition_met} yes="Met" no="Not met" />
        <Chip label="Trend filter" ok={data.trend_ok} yes="OK" no="Blocked" />
      </div>
      <div className="grid gap-2.5">
        <div className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Tiers</div>
        {data.tiers.map((t) => {
          const tp = t.trigger_price !== null ? Number(t.trigger_price) : null;
          const dist = tp !== null && last > 0 ? ((last - tp) / last) * 100 : null;
          const drop = Number(t.drop_pct);
          return (
            <div key={t.index} className="grid gap-1">
              <div className="num flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                <span className="flex items-center gap-1.5 font-medium">
                  {tierLabel(t.index)}
                  <span className="text-muted-foreground">
                    −{fmtPct(t.drop_pct, 1)} · {fmtUsd(t.amount_usd)}
                  </span>
                  {t.filled && <Badge variant="success">filled</Badge>}
                </span>
                <span className="text-muted-foreground">
                  {fmtPrice(t.trigger_price)} ·{" "}
                  {dist === null ? (
                    "—"
                  ) : dist <= 0 ? (
                    <span className="text-gain">reached</span>
                  ) : (
                    `${fmtPct(dist)} away`
                  )}
                </span>
              </div>
              <Meter
                value={t.filled ? drop : Math.min(drop, Math.max(0, pullback))}
                max={drop || 1}
                tone="neutral"
                label={`${tierLabel(t.index)} progress`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PanelShell({
  title,
  description,
  fetching,
  children,
}: {
  title: string;
  description?: ReactNode;
  fetching?: boolean;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeaderRow
        title={
          <>
            <Radar className="h-4 w-4 text-muted-foreground" aria-hidden /> {title}
            {fetching && <Spinner className="h-3 w-3 text-muted-foreground" />}
          </>
        }
        description={description}
      />
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Live preview of the saved rule (GET /api/rules/{id}/preview). */
export function SavedRulePreview({ id, triggerType }: { id: string; triggerType?: Schemas["TriggerType"] }) {
  const q = useRulePreview(id);
  return (
    <PanelShell
      title="Live preview"
      description="Saved rule, including any active dip cycle."
      fetching={q.isFetching && !!q.data}
    >
      <ErrorBox error={q.error} />
      {q.isPending && <SkeletonRows rows={5} />}
      {q.data && <PreviewView data={q.data} triggerType={triggerType} />}
    </PanelShell>
  );
}

/**
 * Preview of unsaved form values (POST /api/rules/preview), debounced and only
 * requested while the form values pass validation.
 */
export function FormRulePreview({
  control,
  title = "Live preview",
  description,
}: {
  control: Control<RuleFormValues>;
  title?: string;
  description?: ReactNode;
}) {
  const values = useWatch({ control });
  const parsed = ruleSchema.safeParse(values);
  const json = parsed.success ? JSON.stringify(toRuleParams(parsed.data)) : null;
  const debounced = useDebouncedValue(json, 600);
  const q = useQuery({
    queryKey: qk.paramsPreview(debounced ?? ""),
    queryFn: ({ signal }) =>
      api.post("/api/rules/preview", { body: JSON.parse(debounced!) as Schemas["RuleParams"], signal }),
    enabled: !!debounced && debounced === json,
    staleTime: 60_000,
    retry: false,
    placeholderData: keepPreviousData,
  });

  return (
    <PanelShell
      title={title}
      description={description}
      fetching={q.isFetching || (!!json && json !== debounced)}
    >
      {!json && (
        <EmptyState
          icon={Radar}
          title="Preview appears here"
          description="Complete the form with valid values to see today's trigger prices."
          className="py-6"
        />
      )}
      {json && <ErrorBox error={q.error} className="mb-2" />}
      {json && !q.data && q.isFetching && <SkeletonRows rows={5} />}
      {json && q.data && (
        <div className={q.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
          <PreviewView data={q.data} triggerType={parsed.success ? parsed.data.trigger_type : undefined} />
        </div>
      )}
    </PanelShell>
  );
}
