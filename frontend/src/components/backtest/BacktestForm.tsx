import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { Controller, FormProvider, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { api, type Schemas } from "@/api/client";
import { qk, useRules } from "@/api/queries";
import { ErrorBox, Spinner } from "@/components/common";
import { FormField } from "@/components/FormField";
import { RuleFormFields } from "@/components/rules/RuleFormFields";
import {
  DEFAULT_RULE,
  ruleSchema,
  tiersSummary,
  toRuleParams,
  type RuleFormValues,
} from "@/components/rules/ruleSchema";
import { Button } from "@/components/ui/button";
import { AdornedInput, Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/lib/toast";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

const schema = z
  .object({
    source: z.enum(["rule", "params"]),
    rule_id: z.string(),
    start_date: isoDate,
    end_date: isoDate,
    starting_cash: z
      .number({ required_error: "Required", invalid_type_error: "Must be a number" })
      .positive("Must be > 0")
      .max(100_000_000, "Max 100,000,000"),
  })
  .superRefine((v, ctx) => {
    if (v.source === "rule" && !v.rule_id) {
      ctx.addIssue({ code: "custom", path: ["rule_id"], message: "Choose a rule" });
    }
    if (v.start_date && v.end_date && v.end_date <= v.start_date) {
      ctx.addIssue({ code: "custom", path: ["end_date"], message: "Must be after the start date" });
    }
  });
type Values = z.infer<typeof schema>;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const numOpts = { setValueAs: (v: unknown) => (v === "" || v == null ? undefined : Number(v)) };

export function BacktestForm({
  onCreated,
  initialParams,
  initialRange,
}: {
  onCreated: (id: string) => void;
  /** Prefill for ad-hoc params (e.g. "re-run with edits", or from a recommendation). */
  initialParams?: RuleFormValues | null;
  initialRange?: { start: string; end: string };
}) {
  const qc = useQueryClient();
  const rules = useRules();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      source: initialParams ? "params" : "rule",
      rule_id: "",
      start_date: initialRange?.start ?? isoDaysAgo(365 * 3),
      end_date: initialRange?.end ?? isoDaysAgo(1),
      starting_cash: 10_000,
    },
  });
  const paramsForm = useForm<RuleFormValues>({
    resolver: zodResolver(ruleSchema),
    defaultValues: initialParams ?? { ...DEFAULT_RULE, symbol: "SPY" },
  });
  const source = useWatch({ control: form.control, name: "source" });

  const create = useMutation({
    mutationFn: (body: Schemas["BacktestIn"]) => api.post("/api/backtests", { body }),
    onSuccess: ({ id }) => {
      void qc.invalidateQueries({ queryKey: qk.backtests });
      toast.success("Backtest queued", "The worker picks it up within about 10 seconds.");
      onCreated(id);
    },
    onError: (e) => toast.error("Could not start the backtest", e),
  });

  const submit = form.handleSubmit(async (v) => {
    const base = { start_date: v.start_date, end_date: v.end_date, starting_cash: String(v.starting_cash) };
    if (v.source === "rule") {
      create.mutate({ ...base, rule_id: v.rule_id });
      return;
    }
    await paramsForm.handleSubmit((p) => create.mutate({ ...base, params: toRuleParams(p) }))();
  });

  const { errors } = form.formState;
  return (
    <form className="grid grid-cols-1 gap-4" onSubmit={(e) => void submit(e)} noValidate>
      <Controller
        control={form.control}
        name="source"
        render={({ field }) => (
          <Tabs value={field.value} onValueChange={field.onChange}>
            <TabsList>
              <TabsTrigger value="rule">Existing rule</TabsTrigger>
              <TabsTrigger value="params">Ad-hoc params</TabsTrigger>
            </TabsList>
            <TabsContent value="rule">
              <FormField id="bt-rule" label="Rule" error={errors.rule_id?.message}>
                <Controller
                  control={form.control}
                  name="rule_id"
                  render={({ field: f }) => (
                    <Select value={f.value || undefined} onValueChange={f.onChange}>
                      <SelectTrigger id="bt-rule" className="sm:max-w-md">
                        <SelectValue placeholder={rules.isPending ? "Loading…" : "Choose a rule"} />
                      </SelectTrigger>
                      <SelectContent>
                        {rules.data?.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.symbol} — {tiersSummary(r.tiers)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
            </TabsContent>
            <TabsContent value="params" forceMount hidden={field.value !== "params"} className="mt-5">
              <FormProvider {...paramsForm}>
                <RuleFormFields idPrefix="bt" showEnabled={false} />
              </FormProvider>
            </TabsContent>
          </Tabs>
        )}
      />
      <div className="grid grid-cols-2 gap-3 border-t pt-4 sm:grid-cols-4">
        <FormField id="bt-start" label="Start date" error={errors.start_date?.message}>
          <Input id="bt-start" type="date" {...form.register("start_date")} />
        </FormField>
        <FormField id="bt-end" label="End date" error={errors.end_date?.message}>
          <Input id="bt-end" type="date" {...form.register("end_date")} />
        </FormField>
        <FormField id="bt-cash" label="Starting cash (USD)" error={errors.starting_cash?.message}>
          <AdornedInput
            id="bt-cash"
            type="number"
            step="any"
            prefix="$"
            {...form.register("starting_cash", numOpts)}
          />
        </FormField>
        <div className="col-span-2 flex items-end sm:col-span-1">
          <Button type="submit" className="w-full" disabled={create.isPending}>
            {create.isPending ? <Spinner /> : <Play />} Run backtest
          </Button>
        </div>
      </div>
      {source === "params" && Object.keys(paramsForm.formState.errors).length > 0 && (
        <p className="text-xs text-loss">Fix the rule parameters above.</p>
      )}
      <ErrorBox error={create.error} />
    </form>
  );
}
