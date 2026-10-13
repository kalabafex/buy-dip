import { Plus, Trash2 } from "lucide-react";
import { Controller, useFieldArray, useFormContext, useWatch, type RegisterOptions } from "react-hook-form";
import { FormField, FormSection } from "@/components/FormField";
import { TierLadder } from "@/components/rules/TierLadder";
import {
  TREND_FILTERS,
  TREND_LABELS,
  TRIGGER_HELP,
  TRIGGER_LABELS,
  TRIGGER_TYPES,
  type RuleFormValues,
} from "@/components/rules/ruleSchema";
import { Button } from "@/components/ui/button";
import { AdornedInput, Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fmtUsd } from "@/lib/format";

/** Empty input → undefined (→ "Required"), otherwise a number (NaN → "Must be a number"). */
const numOpts = { setValueAs: (v: unknown) => (v === "" || v == null ? undefined : Number(v)) };
const nullableNumOpts = { setValueAs: (v: unknown) => (v === "" || v == null ? null : Number(v)) };
const symbolOpts: RegisterOptions<RuleFormValues, "symbol"> = {
  setValueAs: (v: unknown) =>
    String(v ?? "")
      .trim()
      .toUpperCase(),
};

/**
 * All rule parameter inputs, grouped in sections with inline help. Must be rendered inside a
 * <FormProvider> for a `useForm<RuleFormValues>` (used by the rule editor and ad-hoc backtests).
 */
export function RuleFormFields({
  idPrefix = "rule",
  showEnabled = true,
}: {
  idPrefix?: string;
  showEnabled?: boolean;
}) {
  const { register, control, formState } = useFormContext<RuleFormValues>();
  const { errors } = formState;
  const tiers = useFieldArray({ control, name: "tiers" });
  const triggerType = useWatch({ control, name: "trigger_type" });
  const tierValues = useWatch({ control, name: "tiers" });
  const validTiers = (tierValues ?? []).filter(
    (t) => Number.isFinite(t?.drop_pct) && Number.isFinite(t?.amount_usd) && Number(t.amount_usd) > 0,
  );
  const tierSum = validTiers.reduce((s, t) => s + Number(t.amount_usd), 0);
  const id = (n: string) => `${idPrefix}-${n}`;

  return (
    <div className="grid grid-cols-1 gap-6">
      <FormSection
        title="What to buy, and when"
        description={TRIGGER_HELP[triggerType ?? "PULLBACK_FROM_HIGH"]}
      >
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
          <FormField
            id={id("symbol")}
            label="Symbol"
            error={errors.symbol?.message}
            hint="Must be tradable on Alpaca"
          >
            <Input
              id={id("symbol")}
              className="font-semibold uppercase"
              autoComplete="off"
              placeholder="SPY"
              maxLength={12}
              {...register("symbol", symbolOpts)}
            />
          </FormField>
          <FormField id={id("trigger")} label="Trigger" className="col-span-2 sm:col-span-2">
            <Controller
              control={control}
              name="trigger_type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={id("trigger")} onBlur={field.onBlur}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIGGER_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TRIGGER_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
          <FormField
            id={id("lookback")}
            label="Lookback"
            error={errors.lookback_days?.message}
            hint="N for the N-day high that tier drops are measured from (5–250)"
          >
            <AdornedInput
              id={id("lookback")}
              type="number"
              step={1}
              suffix="days"
              {...register("lookback_days", numOpts)}
            />
          </FormField>
          {triggerType === "RSI_OVERSOLD" && (
            <FormField
              id={id("rsi")}
              label="RSI threshold"
              error={errors.rsi_threshold?.message}
              hint="RSI(14) runs 0–100; at or below this counts as oversold. 30–35 is typical (5–50)"
              className="col-span-2"
            >
              <Input
                id={id("rsi")}
                type="number"
                step="any"
                {...register("rsi_threshold", nullableNumOpts)}
              />
            </FormField>
          )}
          {triggerType === "BELOW_MA" && (
            <FormField
              id={id("ma")}
              label="Moving-average period"
              error={errors.ma_period?.message}
              hint="Triggers while the price is below its simple average over this many days (10–250)"
              className="col-span-2"
            >
              <AdornedInput
                id={id("ma")}
                type="number"
                step={1}
                suffix="days"
                {...register("ma_period", nullableNumOpts)}
              />
            </FormField>
          )}
        </div>
      </FormSection>

      <FormSection
        title="Tier ladder"
        description="Each tier buys once per dip when the price is at least this far below the reference high. Deeper tiers usually buy more."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_11rem]">
          <fieldset className="grid grid-cols-1 gap-2">
            <legend className="sr-only">Tiers</legend>
            <div className="grid grid-cols-[2rem_1fr_1fr_2rem] gap-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              <span>Tier</span>
              <span>Drop from high</span>
              <span>Buy amount</span>
              <span />
            </div>
            {tiers.fields.map((f, i) => {
              const e = errors.tiers?.[i];
              return (
                <div key={f.id} className="grid grid-cols-[2rem_1fr_1fr_2rem] items-start gap-2">
                  <span className="flex h-9 items-center text-xs font-semibold text-muted-foreground">
                    T{i + 1}
                  </span>
                  <div className="grid grid-cols-1 gap-1">
                    <AdornedInput
                      aria-label={`Tier ${i + 1} drop %`}
                      aria-invalid={!!e?.drop_pct}
                      type="number"
                      step="any"
                      suffix="%"
                      className="pr-7"
                      {...register(`tiers.${i}.drop_pct`, numOpts)}
                    />
                    {e?.drop_pct?.message && <p className="text-xs text-loss">{e.drop_pct.message}</p>}
                  </div>
                  <div className="grid grid-cols-1 gap-1">
                    <AdornedInput
                      aria-label={`Tier ${i + 1} amount USD`}
                      aria-invalid={!!e?.amount_usd}
                      type="number"
                      step="any"
                      prefix="$"
                      {...register(`tiers.${i}.amount_usd`, numOpts)}
                    />
                    {e?.amount_usd?.message && <p className="text-xs text-loss">{e.amount_usd.message}</p>}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="mt-0.5"
                    aria-label={`Remove tier ${i + 1}`}
                    disabled={tiers.fields.length <= 1}
                    onClick={() => tiers.remove(i)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
            {errors.tiers?.root?.message && <p className="text-xs text-loss">{errors.tiers.root.message}</p>}
            {errors.tiers?.message && <p className="text-xs text-loss">{errors.tiers.message}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                disabled={tiers.fields.length >= 5}
                onClick={() => {
                  const last = tierValues?.[tierValues.length - 1];
                  tiers.append({
                    drop_pct: last && Number.isFinite(last.drop_pct) ? Number(last.drop_pct) + 5 : 5,
                    amount_usd: last && Number.isFinite(last.amount_usd) ? Number(last.amount_usd) : 100,
                  });
                }}
              >
                <Plus /> Add tier
              </Button>
              <span className="num text-xs text-muted-foreground">
                Total per dip: <span className="font-semibold text-foreground">{fmtUsd(tierSum)}</span>
              </span>
            </div>
          </fieldset>
          <div className="hidden rounded-lg border border-dashed bg-muted/30 p-3 md:block">
            <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              Preview
            </div>
            {validTiers.length > 0 ? (
              <TierLadder tiers={validTiers} />
            ) : (
              <p className="text-xs text-muted-foreground">Enter tiers</p>
            )}
          </div>
        </div>
      </FormSection>

      <FormSection
        title="Risk & timing"
        description="Limits that keep a rule from over-buying a falling stock."
      >
        <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField
            id={id("maxpos")}
            label="Max position"
            error={errors.max_position_usd?.message}
            hint="Stops buying once this much has been invested. Must be ≥ the tier total."
          >
            <AdornedInput
              id={id("maxpos")}
              type="number"
              step="any"
              prefix="$"
              {...register("max_position_usd", numOpts)}
            />
          </FormField>
          <FormField
            id={id("trend")}
            label="Trend filter"
            hint="“Above 200-day SMA” only buys in uptrends. Research found it hurt dip buying: it blocks buys in deep drawdowns."
          >
            <Controller
              control={control}
              name="trend_filter"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={id("trend")} onBlur={field.onBlur}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TREND_FILTERS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TREND_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
          <FormField
            id={id("confirm")}
            label="Confirm evaluations"
            error={errors.confirm_evals?.message}
            hint="Consecutive worker checks that must see the condition before buying; filters brief spikes (1–10)"
          >
            <AdornedInput
              id={id("confirm")}
              type="number"
              step={1}
              suffix="checks"
              className="pr-14"
              {...register("confirm_evals", numOpts)}
            />
          </FormField>
          <FormField
            id={id("cooldown")}
            label="Cooldown"
            error={errors.cooldown_days?.message}
            hint="Minimum days between two buys of this rule (0–60)"
          >
            <AdornedInput
              id={id("cooldown")}
              type="number"
              step={1}
              suffix="days"
              {...register("cooldown_days", numOpts)}
            />
          </FormField>
          <FormField
            id={id("offset")}
            label="Limit offset"
            error={errors.limit_offset_pct?.message}
            hint="Limit price = last × (1 + offset). Higher fills more reliably (0–2%)"
          >
            <AdornedInput
              id={id("offset")}
              type="number"
              step="any"
              suffix="%"
              {...register("limit_offset_pct", numOpts)}
            />
          </FormField>
          {showEnabled && (
            <FormField id={id("enabled")} label="Status">
              <Controller
                control={control}
                name="enabled"
                render={({ field }) => (
                  <div className="flex h-9 items-center gap-2.5">
                    <Switch id={id("enabled")} checked={field.value} onCheckedChange={field.onChange} />
                    <span className="text-xs text-muted-foreground">
                      {field.value
                        ? "Enabled: the worker evaluates this rule"
                        : "Disabled: saved but not evaluated"}
                    </span>
                  </div>
                )}
              />
            </FormField>
          )}
        </div>
      </FormSection>
    </div>
  );
}
