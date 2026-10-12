import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, type FieldPath } from "react-hook-form";
import { z } from "zod";
import { api, isApiError, type Schemas } from "@/api/client";
import { qk } from "@/api/queries";
import { ErrorBox, Spinner } from "@/components/common";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const num = () => z.number({ required_error: "Required", invalid_type_error: "Must be a number" });
const int = (min: number, max: number) =>
  num().int("Whole number").min(min, `Min ${min}`).max(max, `Max ${max}`);

const schema = z
  .object({
    max_daily_spend_usd: num().min(0, "Min 0").max(1_000_000, "Max 1,000,000"),
    max_weekly_spend_usd: num().min(0, "Min 0").max(5_000_000, "Max 5,000,000"),
    evaluation_interval_minutes: int(1, 60),
    open_exclusion_minutes: int(0, 120),
    close_exclusion_minutes: int(0, 120),
  })
  .refine((v) => v.max_weekly_spend_usd >= v.max_daily_spend_usd, {
    path: ["max_weekly_spend_usd"],
    message: "Weekly cap must be ≥ daily cap",
  });
type Values = z.infer<typeof schema>;

const numOpts = { setValueAs: (v: unknown) => (v === "" || v == null ? undefined : Number(v)) };

function toValues(s: Schemas["SettingsOut"]): Values {
  return {
    max_daily_spend_usd: Number(s.max_daily_spend_usd),
    max_weekly_spend_usd: Number(s.max_weekly_spend_usd),
    evaluation_interval_minutes: s.evaluation_interval_minutes,
    open_exclusion_minutes: s.open_exclusion_minutes,
    close_exclusion_minutes: s.close_exclusion_minutes,
  };
}

export function SettingsForm({ settings }: { settings: Schemas["SettingsOut"] }) {
  const qc = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: toValues(settings),
    resetOptions: { keepDirtyValues: true },
  });
  const save = useMutation({
    mutationFn: (v: Values) =>
      api.put("/api/settings", {
        body: {
          ...v,
          max_daily_spend_usd: String(v.max_daily_spend_usd),
          max_weekly_spend_usd: String(v.max_weekly_spend_usd),
        },
      }),
    onSuccess: (s) => {
      qc.setQueryData(qk.settings, s);
      form.reset(toValues(s));
    },
    onError: (e) => {
      if (isApiError(e, 422)) {
        for (const [path, msg] of Object.entries(e.fieldErrors)) {
          if (path) form.setError(path as FieldPath<Values>, { message: msg });
        }
      }
    },
  });
  const { errors, isDirty } = form.formState;

  return (
    <form className="grid grid-cols-1 gap-4" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="s-daily" label="Max daily spend (USD)" error={errors.max_daily_spend_usd?.message}>
          <Input id="s-daily" type="number" step="any" {...form.register("max_daily_spend_usd", numOpts)} />
        </FormField>
        <FormField id="s-weekly" label="Max weekly spend (USD)" error={errors.max_weekly_spend_usd?.message}>
          <Input id="s-weekly" type="number" step="any" {...form.register("max_weekly_spend_usd", numOpts)} />
        </FormField>
        <FormField
          id="s-interval"
          label="Evaluation interval (minutes)"
          error={errors.evaluation_interval_minutes?.message}
          hint="1–60"
        >
          <Input id="s-interval" type="number" step={1} {...form.register("evaluation_interval_minutes", numOpts)} />
        </FormField>
        <div className="hidden sm:block" />
        <FormField
          id="s-open"
          label="Skip after market open (minutes)"
          error={errors.open_exclusion_minutes?.message}
          hint="0–120"
        >
          <Input id="s-open" type="number" step={1} {...form.register("open_exclusion_minutes", numOpts)} />
        </FormField>
        <FormField
          id="s-close"
          label="Skip before market close (minutes)"
          error={errors.close_exclusion_minutes?.message}
          hint="0–120"
        >
          <Input id="s-close" type="number" step={1} {...form.register("close_exclusion_minutes", numOpts)} />
        </FormField>
      </div>
      <ErrorBox error={save.error} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={!isDirty || save.isPending} onClick={() => form.reset(toValues(settings))}>
          Reset
        </Button>
        <Button type="submit" disabled={!isDirty || save.isPending}>
          {save.isPending && <Spinner />} Save settings
        </Button>
      </div>
    </form>
  );
}
