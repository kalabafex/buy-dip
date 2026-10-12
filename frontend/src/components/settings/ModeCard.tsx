import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Schemas } from "@/api/client";
import { isElevated, qk, useMe } from "@/api/queries";
import { ModeBadge } from "@/components/badges";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LiveModeDialog } from "@/components/settings/LiveModeDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/format";
import { useNow } from "@/lib/hooks";

export function ModeCard({ settings }: { settings: Schemas["SettingsOut"] }) {
  const qc = useQueryClient();
  const me = useMe();
  const now = useNow(10_000);
  const [liveOpen, setLiveOpen] = useState(false);
  const [paperOpen, setPaperOpen] = useState(false);
  const toPaper = useMutation({
    mutationFn: () => api.post("/api/mode", { body: { mode: "PAPER", confirm: "" } }),
    onSuccess: (s) => qc.setQueryData(qk.settings, s),
  });
  const live = settings.trading_mode === "LIVE";
  const elevated = isElevated(me.data, now);

  return (
    <Card className={live ? "border-red-400 dark:border-red-800" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Trading mode <ModeBadge mode={settings.trading_mode} />
        </CardTitle>
        <CardDescription>
          {live
            ? "Orders are placed on your live brokerage account."
            : "Orders are placed on the paper (simulated) account."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        {live ? (
          <Button variant="outline" className="w-fit" onClick={() => setPaperOpen(true)}>
            Switch to PAPER
          </Button>
        ) : (
          <div className="grid grid-cols-1 gap-1.5">
            <Button
              variant="destructive"
              className="w-fit"
              disabled={!settings.live_keys_configured}
              onClick={() => setLiveOpen(true)}
            >
              Switch to LIVE…
            </Button>
            {!settings.live_keys_configured && (
              <p className="text-xs text-muted-foreground">
                Live trading is unavailable: live broker API keys are not configured on the server
                (ALPACA_LIVE_KEY_ID / ALPACA_LIVE_SECRET).
              </p>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {elevated && me.data?.elevated_until
            ? `Elevated session active until ${fmtDateTime(me.data.elevated_until)}.`
            : "Switching to LIVE or turning the kill switch off requires re-authentication."}
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
