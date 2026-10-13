import { useMutation, useQueryClient } from "@tanstack/react-query";
import { OctagonX } from "lucide-react";
import { useState } from "react";
import { api } from "@/api/client";
import { qk, useSettings } from "@/api/queries";
import { useElevatedAction } from "@/components/auth/elevation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Kill switch toggle. ON (halt) is immediate after a confirm; OFF (resume) may require
 * re-authentication (the API answers 403 unless the session is elevated).
 */
export function KillSwitch({ className }: { className?: string }) {
  const qc = useQueryClient();
  const settings = useSettings();
  const runElevated = useElevatedAction();
  const [confirmOn, setConfirmOn] = useState(false);

  const m = useMutation({
    mutationFn: (on: boolean) => api.post("/api/kill-switch", { body: { on } }),
    onSuccess: (s) => {
      qc.setQueryData(qk.settings, s);
      if (s.kill_switch)
        toast.success("Kill switch on", "Trading halted. Open orders are canceled on the next tick.");
      else toast.success("Kill switch off", "Trading resumed.");
    },
  });

  const on = settings.data?.kill_switch ?? false;

  const turnOff = async () => {
    try {
      await runElevated(() => m.mutateAsync(false), "Resuming trading requires re-authentication.");
    } catch (e) {
      toast.error("Could not turn the kill switch off", e);
    }
  };

  return (
    <div
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 rounded-full border pl-2.5 pr-1.5 transition-colors",
        on ? "border-loss/40 bg-loss-soft" : "bg-card",
        className,
      )}
    >
      <label
        htmlFor="kill-switch"
        className={cn(
          "flex cursor-pointer select-none items-center gap-1.5 text-xs font-semibold",
          on ? "text-loss" : "text-muted-foreground",
        )}
        title={
          on ? "Trading halted. Turning it off requires re-authentication." : "Halt all trading immediately"
        }
      >
        <OctagonX className="h-3.5 w-3.5" aria-hidden />
        <span className={cn(!on && "hidden sm:inline")}>{on ? "HALTED" : "Kill switch"}</span>
      </label>
      <Switch
        id="kill-switch"
        checked={on}
        disabled={!settings.data || m.isPending}
        className="data-[state=checked]:bg-loss"
        onCheckedChange={(next) => (next ? setConfirmOn(true) : void turnOff())}
        aria-label={
          on
            ? "Kill switch is on (trading halted). Turn off to resume"
            : "Kill switch is off. Turn on to halt trading"
        }
      />
      <ConfirmDialog
        open={confirmOn}
        onOpenChange={setConfirmOn}
        title="Activate kill switch?"
        description="All trading halts immediately and open orders will be canceled. Turning it back off requires re-authentication."
        confirmLabel="Halt trading"
        destructive
        onConfirm={() => m.mutateAsync(true)}
      />
    </div>
  );
}
