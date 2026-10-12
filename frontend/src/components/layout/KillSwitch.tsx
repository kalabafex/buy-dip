import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorText } from "@/api/client";
import { qk, useSettings } from "@/api/queries";
import { useElevatedAction } from "@/components/auth/elevation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Switch } from "@/components/ui/switch";
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
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: (on: boolean) => api.post("/api/kill-switch", { body: { on } }),
    onSuccess: (s) => {
      qc.setQueryData(qk.settings, s);
      setError(null);
    },
  });

  const on = settings.data?.kill_switch ?? false;

  const turnOff = async () => {
    setError(null);
    try {
      await runElevated(() => m.mutateAsync(false), "Resuming trading requires re-authentication.");
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <label
        htmlFor="kill-switch"
        className={cn(
          "select-none text-xs font-semibold uppercase tracking-wide",
          on ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
        )}
        title={error ?? (on ? "Trading halted" : "Trading active")}
      >
        {on ? "Halted" : "Kill switch"}
      </label>
      <Switch
        id="kill-switch"
        checked={on}
        disabled={!settings.data || m.isPending}
        className="data-[state=checked]:bg-red-600"
        onCheckedChange={(next) => (next ? setConfirmOn(true) : void turnOff())}
        aria-label="Kill switch"
      />
      {error && (
        <span className="max-w-[12rem] truncate text-xs text-red-600" title={error}>
          {error}
        </span>
      )}
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
