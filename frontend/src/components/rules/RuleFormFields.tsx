import { Plus, Trash2 } from "lucide-react";
import { Controller, useFieldArray, useFormContext, useWatch, type RegisterOptions } from "react-hook-form";
import { FormField } from "@/components/FormField";
import {
  TREND_FILTERS,
  TREND_LABELS,
  TRIGGER_LABELS,
  TRIGGER_TYPES,
  type RuleFormValues,
} from "@/components/rules/ruleSchema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fmtUsd } from "@/lib/format";

/** Empty input → undefined (→ "Required"), otherwise a number (NaN → "Must be a number"). */
const numOpts = { setValueAs: (v: unknown) => (v === "" || v == null ? undefined : Number(v)) };
const nullableNumOpts = { setValueAs: (v: unknown) => (v === "" || v == null ? null : Number(v)) };
const symbolOpts: RegisterOptions<RuleFormValues, "symbol"> = {
  setValueAs: (v: unknown) => String(v ?? "").trim().toUpperCase(),
};

/**
 * All rule parameter inputs. Must be rendered inside a <FormProvider> for a
 * `useForm<RuleFormValues>` (used by the rule editor and by ad-hoc backtests).
 */
export function RuleFormFields({ idPrefix = "rule", showEnabled = true }: { idPrefix?: string; showEnabled?: boolean }) {
  const { register, control, formState } = useFormContext<RuleFormValues>();
  const { errors } = formState;
  const tiers = useFieldArray({ control, name: "tiers" });
  const triggerType = useWatch({ control, name: "trigger_type" });
  const tierValues = useWatch({ control, name: "tiers" });
  const tierSum = (tierValues ?? []).reduce(
    (s, t) => s + (Number.isFinite(t?.amount_usd) ? Number(t.amount_usd) : 0),
    0,
  );
  const id = (n: string) => `${idPrefix}-${n}`;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FormField id={id("symbol")} label="Symbol" error={errors.symbol?.message}>
          <Input
            id={id("symbol")}
            className="uppercase"
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
          label="Lookback days"
          error={errors.lookback_days?.message}
          hint="N for the N-day high"
        >
          <Input id={id("lookback")} type="number" step={1} {...register("lookback_days", numOpts)} />
        </FormField>
        {triggerType === "RSI_OVERSOLD" && (
          <FormField
            id={id("rsi")}
            label="RSI threshold"
            error={errors.rsi_threshold?.message}
            hint="Triggers when RSI14 ≤ this (5–50)"
          >
            <Input id={id("rsi")} type="number" step="any" {...register("rsi_threshold", nullableNumOpts)} />
          </FormField>
        )}
        {triggerType === "BELOW_MA" && (
          <FormField
            id={id("ma")}
            label="MA period"
            error={errors.ma_period?.message}
            hint="Triggers when last < SMA(period)"
          >
            <Input id={id("ma")} type="number" step={1} {...register("ma_period", nullableNumOpts)} />
          </FormField>
        )}
      </div>

      <fieldset className="grid grid-cols-1 gap-2">
        <div className="flex items-center justify-between">
          <Label asChild>
            <legend>Tiers (drop from reference high → buy amount)</legend>
          </Label>
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
            <Plus /> Tier
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-2">
          {tiers.fields.map((f, i) => {
            const e = errors.tiers?.[i];
            return (
              <div key={f.id} className="grid grid-cols-[2rem_1fr_1fr_2rem] items-start gap-2">
                <span className="pt-2 text-xs font-medium text-muted-foreground">T{i + 1}</span>
                <div className="grid grid-cols-1 gap-1">
                  <div className="relative">
                    <Input
                      aria-label={`Tier ${i + 1} drop %`}
                      aria-invalid={!!e?.drop_pct}
                      type="number"
                      step="any"
                      className="pr-7"
                      {...register(`tiers.${i}.drop_pct`, numOpts)}
                    />
                    <span className="pointer-events-none absolute right-2 top-2 text-xs text-muted-foreground">%</span>
                  </div>
                  {e?.drop_pct?.message && <p className="text-xs text-red-600 dark:text-red-400">{e.drop_pct.message}</p>}
                </div>
                <div className="grid grid-cols-1 gap-1">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2 top-2 text-xs text-muted-foreground">$</span>
                    <Input
                      aria-label={`Tier ${i + 1} amount USD`}
                      aria-invalid={!!e?.amount_usd}
                      type="number"
                      step="any"
                      className="pl-5"
                      {...register(`tiers.${i}.amount_usd`, numOpts)}
                    />
                  </div>
                  {e?.amount_usd?.message && <p className="text-xs text-red-600 dark:text-red-400">{e.amount_usd.message}</p>}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove tier ${i + 1}`}
                  disabled={tiers.fields.length <= 1}
                  onClick={() => tiers.remove(i)}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </div>
        {errors.tiers?.root?.message && <p className="text-xs text-red-600">{errors.tiers.root.message}</p>}
        {errors.tiers?.message && <p className="text-xs text-red-600">{errors.tiers.message}</p>}
        <p className="text-[11px] text-muted-foreground">Total across tiers: {fmtUsd(tierSum)}</p>
      </fieldset>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <FormField
          id={id("maxpos")}
          label="Max position (USD)"
          error={errors.max_position_usd?.message}
          hint="≥ sum of tier amounts"
        >
          <Input id={id("maxpos")} type="number" step="any" {...register("max_position_usd", numOpts)} />
        </FormField>
        <FormField id={id("trend")} label="Trend filter">
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
          hint="Consecutive evals before buying (1–10)"
        >
          <Input id={id("confirm")} type="number" step={1} {...register("confirm_evals", numOpts)} />
        </FormField>
        <FormField
          id={id("cooldown")}
          label="Cooldown days"
          error={errors.cooldown_days?.message}
          hint="0–60"
        >
          <Input id={id("cooldown")} type="number" step={1} {...register("cooldown_days", numOpts)} />
        </FormField>
        <FormField
          id={id("offset")}
          label="Limit offset %"
          error={errors.limit_offset_pct?.message}
          hint="Limit = last × (1 + offset%), 0–2"
        >
          <Input id={id("offset")} type="number" step="any" {...register("limit_offset_pct", numOpts)} />
        </FormField>
        {showEnabled && (
          <FormField id={id("enabled")} label="Enabled">
            <Controller
              control={control}
              name="enabled"
              render={({ field }) => (
                <div className="flex h-9 items-center gap-2">
                  <Switch id={id("enabled")} checked={field.value} onCheckedChange={field.onChange} />
                  <span className="text-xs text-muted-foreground">
                    {field.value ? "Worker will evaluate this rule" : "Disabled"}
                  </span>
                </div>
              )}
            />
          </FormField>
        )}
      </div>
    </div>
  );
}
