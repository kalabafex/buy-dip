import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorText, type Schemas } from "@/api/client";
import { qk } from "@/api/queries";
import { Switch } from "@/components/ui/switch";

/** PATCH /api/rules/{id}/enabled with an optimistic update of the rules list. */
export function EnabledToggle({ rule }: { rule: Schemas["RuleOut"] }) {
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
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.rules, ctx.prev);
    },
    onSuccess: (saved) => {
      qc.setQueryData(qk.rule(saved.id), saved);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.rules }),
  });
  return (
    <span className="inline-flex items-center gap-2" title={m.error ? errorText(m.error) : undefined}>
      <Switch
        checked={rule.enabled ?? false}
        disabled={m.isPending}
        onCheckedChange={(v) => m.mutate(v)}
        aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.symbol}`}
      />
      {m.error && <span className="text-xs text-red-600">failed</span>}
    </span>
  );
}
