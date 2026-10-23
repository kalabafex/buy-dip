import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, OctagonX, ShieldCheck } from "lucide-react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";
import { api, isApiError, type Schemas } from "@/api/client";
import { qk, useSettings } from "@/api/queries";
import { ModeBadge } from "@/components/badges";
import { ErrorBox, Spinner } from "@/components/common";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeaderRow } from "@/components/ui/card";
import { AdornedInput } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const num = () => z.number({ required_error: "Required", invalid_type_error: "Must be a number" });
const schema = z.object({
  notional_usd: num().positive("Must be > 0").max(1_000_000, "Max $1,000,000"),
  min_expected_pct: num().min(-5, "Min −5%").max(5, "Max 5%"),
});
type Values = z.infer<typeof schema>;
const numOpts = { setValueAs: (v: unknown) => (v === "" || v == null ? undefined : Number(v)) };

type PicksSettings = Schemas["PicksSettingsOut"];

function toValues(s: PicksSettings): Values {
  return { notional_usd: Number(s.notional_usd), min_expected_pct: Number(s.min_expected_pct) };
}

const LIVE_MSG =
  "Picks auto-trade only runs on the paper account. Switch the app to PAPER mode in Settings to turn it on.";

/** Auto-trade toggle (applies immediately) and sizing/threshold (saved with a button). */
export function AutoTradeCard({ settings }: { settings: PicksSettings }) {
  const qc = useQueryClient();
  const app = useSettings();
  const halted = app.data?.kill_switch ?? false;
  const live = settings.trading_mode === "LIVE";
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: toValues(settings),
    resetOptions: { keepDirtyValues: true },
  });

  const save = useMutation({
    mutationFn: (body: { autotrade: boolean } & Values) =>
      api.put("/api/picks/settings", {
        body: {
          autotrade: body.autotrade,
          notional_usd: String(body.notional_usd),
          min_expected_pct: String(body.min_expected_pct),
        },
      }),
    onSuccess: (s, body) => {
      qc.setQueryData(qk.picksSettings, s);
      void qc.invalidateQueries({ queryKey: qk.picks });
      form.reset(toValues(s));
      if (body.autotrade !== settings.autotrade)
        toast.success(
          s.autotrade ? "Auto-trade on" : "Auto-trade off",
          s.autotrade
            ? `Tradeable picks are bought at the entry time, $${Number(s.notional_usd).toLocaleString()} each, on the paper account.`
            : "Picks are still published; nothing is traded.",
        );
      else toast.success("Picks settings saved", "They apply from the next picks.");
    },
    onError: (e) => {
      if (isApiError(e, 409)) toast.error("Auto-trade not available in LIVE mode", new Error(LIVE_MSG));
      else toast.error("Could not save picks settings", e);
    },
  });

  const saved = toValues(settings);
  const { errors, isDirty } = form.formState;
  const conflict = isApiError(save.error, 409);

  return (
    <Card>
      <CardHeaderRow
        title={
          <>
            <Bot className="h-4 w-4 text-primary" aria-hidden /> Auto-trade
            <ModeBadge mode={settings.trading_mode} className="ml-auto" />
          </>
        }
        description="One bracket order per tradeable pick."
      />
      <CardContent className="grid gap-4">
        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5",
            settings.autotrade ? "border-gain/30 bg-gain-soft/60" : "bg-muted/30",
          )}
        >
          <label htmlFor="picks-autotrade" className="min-w-0 cursor-pointer">
            <span className="block text-sm font-medium">
              {settings.autotrade ? "On — trading picks" : "Off — picks only"}
            </span>
            <span className="block text-2xs text-muted-foreground">
              {settings.autotrade
                ? "Buys, target/stop and the forced exit are managed for you."
                : "Picks are published every day; nothing is traded."}
            </span>
          </label>
          <Switch
            id="picks-autotrade"
            checked={settings.autotrade}
            disabled={save.isPending || (live && !settings.autotrade)}
            onCheckedChange={(next) => save.mutate({ ...saved, autotrade: next })}
            aria-label={settings.autotrade ? "Turn picks auto-trade off" : "Turn picks auto-trade on"}
          />
        </div>

        {(live || conflict) && (
          <div className="rounded-lg border border-loss/30 bg-loss-soft px-3 py-2 text-xs text-loss" role="alert">
            {LIVE_MSG}{" "}
            <Link to="/settings" className="font-medium underline underline-offset-2">
              Open settings
            </Link>
          </div>
        )}

        <form
          className="grid gap-3"
          noValidate
          onSubmit={form.handleSubmit((v) => save.mutate({ ...v, autotrade: settings.autotrade }))}
        >
          <div className="grid grid-cols-2 gap-3">
            <FormField
              id="picks-notional"
              label="Per pick"
              error={errors.notional_usd?.message}
              hint="Whole shares up to this"
            >
              <AdornedInput
                id="picks-notional"
                type="number"
                step="any"
                prefix="$"
                {...form.register("notional_usd", numOpts)}
              />
            </FormField>
            <FormField
              id="picks-min"
              label="Min projected"
              error={errors.min_expected_pct?.message}
              hint="Lower → watch only"
            >
              <AdornedInput
                id="picks-min"
                type="number"
                step="0.05"
                suffix="%"
                className="pr-8"
                {...form.register("min_expected_pct", numOpts)}
              />
            </FormField>
          </div>
          {save.error && !conflict && <ErrorBox error={save.error} />}
          {isDirty && (
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={save.isPending}
                onClick={() => form.reset(saved)}
              >
                Reset
              </Button>
              <Button type="submit" size="sm" disabled={save.isPending}>
                {save.isPending && <Spinner />} Save
              </Button>
            </div>
          )}
        </form>

        <ul className="grid gap-2 border-t pt-3 text-2xs leading-4 text-muted-foreground">
          <li className="flex gap-2">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-gain" aria-hidden />
            <span>
              <span className="font-medium text-foreground">Paper account only.</span> Auto-trade never runs
              in LIVE mode, even if left on.
            </span>
          </li>
          <li className="flex gap-2">
            <OctagonX className={cn("mt-px h-3.5 w-3.5 shrink-0", halted ? "text-loss" : "")} aria-hidden />
            <span>
              {halted ? (
                <span className="font-medium text-loss">Kill switch is ON: no new entries. </span>
              ) : (
                <span className="font-medium text-foreground">Kill switch </span>
              )}
              blocks new entries; exits of open picks still run so nothing is held overnight.
            </span>
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}
