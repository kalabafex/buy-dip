import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FlaskRound, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api, type Schemas } from "@/api/client";
import { isElevated, qk, useMe } from "@/api/queries";
import { ModeBadge } from "@/components/badges";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LiveModeDialog } from "@/components/settings/LiveModeDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeaderRow } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export function ModeCard({ settings }: { settings: Schemas["SettingsOut"] }) {
  const qc = useQueryClient();
  const me = useMe();
  const now = useNow(10_000);
  const [liveOpen, setLiveOpen] = useState(false);
  const [paperOpen, setPaperOpen] = useState(false);
  const toPaper = useMutation({
    mutationFn: () => api.post("/api/mode", { body: { mode: "PAPER", confirm: "" } }),
    onSuccess: (s) => {
      qc.setQueryData(qk.settings, s);
      toast.success("Switched to PAPER trading");
    },
  });
  const live = settings.trading_mode === "LIVE";
  const elevated = isElevated(me.data, now);

  return (
    <Card className={cn(live && "border-red-500/50 ring-1 ring-red-500/30")}>
      <CardHeaderRow
        title={
          <>
            Trading mode <ModeBadge mode={settings.trading_mode} />
          </>
        }
        description={
          live
            ? "Orders are placed on your live brokerage account."
            : "Orders are placed on the paper (simulated) account."
        }
      />
      <CardContent className="grid grid-cols-1 gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className={cn("rounded-lg border p-3.5", !live && "border-gain/40 bg-gain-soft/50")}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FlaskRound className="h-4 w-4 text-gain" aria-hidden /> Paper
              {!live && <span className="ml-auto text-2xs font-medium text-gain">Active</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Simulated fills with Alpaca's paper account. No real money.
            </p>
            {live && (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setPaperOpen(true)}>
                Switch to PAPER
              </Button>
            )}
          </div>
          <div className={cn("rounded-lg border p-3.5", live && "border-red-500/50 bg-loss-soft")}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldAlert className="h-4 w-4 text-loss" aria-hidden /> Live
              {live && <span className="ml-auto text-2xs font-medium text-loss">Active</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Real orders with real money on your live brokerage account.
            </p>
            {!live && (
              <Button
                variant="destructive"
                size="sm"
                className="mt-3"
                disabled={!settings.live_keys_configured}
                onClick={() => setLiveOpen(true)}
              >
                Switch to LIVE…
              </Button>
            )}
            {!live && !settings.live_keys_configured && (
              <p className="mt-2 text-2xs text-muted-foreground">
                Unavailable: live broker API keys are not configured on the server (ALPACA_LIVE_KEY_ID /
                ALPACA_LIVE_SECRET).
              </p>
            )}
          </div>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {elevated && me.data?.elevated_until
            ? `Elevated session active until ${fmtDateTime(me.data.elevated_until)}.`
            : "Switching to LIVE or turning the kill switch off requires re-authentication (password + code)."}
        </p>
      </CardContent>
      <LiveModeDialog open={liveOpen} onOpenChange={setLiveOpen} />
      <ConfirmDialog
        open={paperOpen}
        onOpenChange={setPaperOpen}
        title="Switch to PAPER trading?"
        description="The worker will stop using the live account and trade on paper."
        confirmLabel="Switch to PAPER"
        onConfirm={() => toPaper.mutateAsync()}
      />
    </Card>
  );
}
