import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useWatch, type Control } from "react-hook-form";
import { api, type Schemas } from "@/api/client";
import { qk, useRulePreview } from "@/api/queries";
import { ErrorBox, Spinner } from "@/components/common";
import { ruleSchema, toRuleParams, type RuleFormValues } from "@/components/rules/ruleSchema";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtNum, fmtPct, fmtPrice, fmtUsd, tierLabel } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed py-1 text-sm last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

function YesNo({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <Badge variant={ok ? "success" : "secondary"}>{ok ? yes : no}</Badge>;
}

export function PreviewView({ data, triggerType }: { data: Schemas["PreviewOut"]; triggerType?: Schemas["TriggerType"] }) {
  const last = Number(data.last);
  const refDiffers = data.ref_high !== null && data.ref_high !== data.high_n;
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <Row label="Last">{fmtPrice(data.last)}</Row>
        <Row label="Latest bar">{fmtDate(data.latest_bar_date)}</Row>
        <Row label="N-day high">{fmtPrice(data.high_n)}</Row>
        {refDiffers && <Row label="Cycle ref high">{fmtPrice(data.ref_high)}</Row>}
        <Row label="Pullback">{fmtPct(data.pullback_pct)}</Row>
        <Row label="SMA50">{fmtPrice(data.sma50)}</Row>
        <Row label="SMA200">{fmtPrice(data.sma200)}</Row>
        {(triggerType === "BELOW_MA" || data.sma_rule !== null) && (
          <Row label="Rule SMA">{fmtPrice(data.sma_rule)}</Row>
        )}
        <Row label="RSI14">{fmtNum(data.rsi14, 1)}</Row>
        <Row label="Condition">
          <YesNo ok={data.condition_met} yes="Met" no="Not met" />
        </Row>
        <Row label="Trend filter">
          <YesNo ok={data.trend_ok} yes="OK" no="Blocked" />
        </Row>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tier</TableHead>
            <TableHead className="text-right">Drop</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Trigger price</TableHead>
            <TableHead className="text-right">From last</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.tiers.map((t) => {
            const tp = t.trigger_price !== null ? Number(t.trigger_price) : null;
            const dist = tp !== null && last > 0 ? ((last - tp) / last) * 100 : null;
            return (
              <TableRow key={t.index}>
                <TableCell>
                  {tierLabel(t.index)} {t.filled && <Badge variant="success">filled</Badge>}
                </TableCell>
                <TableCell className="text-right">-{fmtPct(t.drop_pct, 1)}</TableCell>
                <TableCell className="text-right">{fmtUsd(t.amount_usd)}</TableCell>
                <TableCell className="text-right">{fmtPrice(t.trigger_price)}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {dist === null ? "—" : dist <= 0 ? "reached" : `-${fmtPct(dist)}`}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title} {fetching && <Spinner className="h-3 w-3" />}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Live preview of the saved rule (GET /api/rules/{id}/preview). */
export function SavedRulePreview({ id, triggerType }: { id: string; triggerType?: Schemas["TriggerType"] }) {
  const q = useRulePreview(id);
  return (
    <PanelShell title="Live preview" description="Saved rule, including any active dip cycle." fetching={q.isFetching}>
      <ErrorBox error={q.error} />
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
    <PanelShell title={title} description={description} fetching={q.isFetching || (!!json && json !== debounced)}>
      {!json && <p className="text-xs text-muted-foreground">Complete the form with valid values to see a preview.</p>}
      {json && <ErrorBox error={q.error} className="mb-2" />}
      {json && q.data && (
        <PreviewView data={q.data} triggerType={parsed.success ? parsed.data.trigger_type : undefined} />
      )}
    </PanelShell>
  );
}
