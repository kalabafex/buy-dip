import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Schemas } from "@/api/client";
import { qk } from "@/api/queries";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";

/** PATCH /api/rules/{id}/enabled with an optimistic update of the rules list. */
export function EnabledToggle({
  rule,
  showLabel = false,
}: {
  rule: Schemas["RuleOut"];
  showLabel?: boolean;
}) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (enabled: boolean) =>
      api.patch("/api/rules/{rule_id}/enabled", { path: { rule_id: rule.id }, body: { enabled } }),
    onMutate: async (enabled) => {
      await qc.cancelQueries({ queryKey: qk.rules, exact: true });
      const prev = qc.getQueryData<Schemas["RuleOut"][]>(qk.rules);
      qc.setQueryData<Schemas["RuleOut"][]>(qk.rules, (old) =>
        old?.map((r) => (r.id === rule.id ? { ...r, enabled } : r)),
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.rules, ctx.prev);
      toast.error(`Could not update ${rule.symbol}`, e);
    },
    onSuccess: (saved) => {
      qc.setQueryData(qk.rule(saved.id), saved);
      toast.success(`${saved.symbol} ${saved.enabled ? "enabled" : "disabled"}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.rules }),
  });
  return (
    <span className="inline-flex items-center gap-2">
      <Switch
        checked={rule.enabled ?? false}
        disabled={m.isPending}
        onCheckedChange={(v) => m.mutate(v)}
        aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.symbol}`}
      />
      {showLabel && (
        <span className="text-xs text-muted-foreground">{rule.enabled ? "Enabled" : "Disabled"}</span>
      )}
    </span>
  );
}
