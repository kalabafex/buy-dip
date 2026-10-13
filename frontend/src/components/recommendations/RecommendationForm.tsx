import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api, isApiError } from "@/api/client";
import { qk } from "@/api/queries";
import { ErrorBox, Spinner } from "@/components/common";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { AdornedInput, Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";

const num = () => z.number({ required_error: "Required", invalid_type_error: "Must be a number" });

const schema = z
  .object({
    symbol: z
      .string()
      .trim()
      .min(1, "Required")
      .max(12, "Max 12 characters")
      .regex(/^[A-Z0-9.-]+$/, "Letters, digits, '.' or '-'"),
    years: num().int("Whole number").min(5, "Min 5 years").max(20, "Max 20 years"),
    budget_per_dip_usd: num().positive("Must be > 0").max(100_000, "Max $100,000"),
    max_position_usd: num().positive("Must be > 0").max(10_000_000, "Max $10,000,000"),
  })
  .refine((v) => v.max_position_usd >= v.budget_per_dip_usd, {
    path: ["max_position_usd"],
    message: "Must be at least the budget per dip",
  });
type Values = z.infer<typeof schema>;

const numOpts = { setValueAs: (v: unknown) => (v === "" || v == null ? undefined : Number(v)) };

export function RecommendationForm({ onCreated }: { onCreated: (id: string, symbol: string) => void }) {
  const qc = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { symbol: "", years: 10, budget_per_dip_usd: 600, max_position_usd: 3000 },
  });
  const create = useMutation({
    mutationFn: (v: Values) =>
      api.post("/api/recommendations", {
        body: {
          symbol: v.symbol,
          years: v.years,
          budget_per_dip_usd: String(v.budget_per_dip_usd),
          max_position_usd: String(v.max_position_usd),
        },
      }),
    onSuccess: ({ id }, v) => {
      void qc.invalidateQueries({ queryKey: qk.recommendations, exact: true });
      toast.success(`Analyzing ${v.symbol}`, "Usually takes 30 seconds to 3 minutes.");
      onCreated(id, v.symbol);
    },
    onError: (e) => {
      if (isApiError(e, 422)) {
        const fe = e.fieldErrors;
        const keys = Object.keys(fe) as (keyof Values)[];
        if (keys.length) {
          for (const k of keys) form.setError(k, { message: fe[k] });
        } else if (typeof e.detail === "string" && /tradable/.test(e.detail)) {
          form.setError("symbol", { message: e.message });
        }
      }
    },
  });
  const { errors } = form.formState;
  const showError = create.error && !(isApiError(create.error, 422) && Object.keys(errors).length > 0);

  return (
    <form className="grid grid-cols-1 gap-4" onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate>
      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        <FormField
          id="rec-symbol"
          label="Symbol"
          error={errors.symbol?.message}
          hint="Any tradable stock or ETF"
          className="col-span-2 sm:col-span-1 xl:col-span-2"
        >
          <Input
            id="rec-symbol"
            placeholder="SPY"
            autoComplete="off"
            maxLength={12}
            className="font-semibold uppercase"
            {...form.register("symbol", {
              setValueAs: (v: unknown) =>
                String(v ?? "")
                  .trim()
                  .toUpperCase(),
            })}
          />
        </FormField>
        <FormField
          id="rec-years"
          label="History"
          error={errors.years?.message}
          hint="Years of daily bars to test (5–20); ~6+ needed"
          className="col-span-2 sm:col-span-1 xl:col-span-2"
        >
          <AdornedInput
            id="rec-years"
            type="number"
            step={1}
            min={5}
            max={20}
            suffix="years"
            className="pr-14"
            {...form.register("years", numOpts)}
          />
        </FormField>
        <FormField
          id="rec-budget"
          label="Budget per dip"
          error={errors.budget_per_dip_usd?.message}
          hint="Spread across the tiers, deeper tiers buy more"
        >
          <AdornedInput
            id="rec-budget"
            type="number"
            step="any"
            prefix="$"
            {...form.register("budget_per_dip_usd", numOpts)}
          />
        </FormField>
        <FormField
          id="rec-max"
          label="Max position"
          error={errors.max_position_usd?.message}
          hint="Cap on total invested by the rule"
        >
          <AdornedInput
            id="rec-max"
            type="number"
            step="any"
            prefix="$"
            {...form.register("max_position_usd", numOpts)}
          />
        </FormField>
      </div>
      {showError && <ErrorBox error={create.error} />}
      <Button type="submit" size="lg" disabled={create.isPending}>
        {create.isPending ? <Spinner /> : <Sparkles />} Analyze
      </Button>
    </form>
  );
}
