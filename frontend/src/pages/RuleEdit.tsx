import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { FormProvider, useForm, type FieldPath } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, isApiError, type Schemas } from "@/api/client";
import { qk, useRule } from "@/api/queries";
import { ErrorBox, PageHeader, PageSkeleton, Spinner } from "@/components/common";
import { RuleFormFields } from "@/components/rules/RuleFormFields";
import { FormRulePreview, SavedRulePreview } from "@/components/rules/RulePreviewPanel";
import {
  DEFAULT_RULE,
  fromRule,
  ruleSchema,
  toRuleParams,
  type RuleFormValues,
} from "@/components/rules/ruleSchema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/lib/toast";

/** Create (/rules/new) or edit (/rules/:id/edit) a rule. */
export function RuleEditPage() {
  const { id } = useParams();
  const rule = useRule(id);
  if (id && rule.isPending) return <PageSkeleton />;
  if (id && rule.isError) return <ErrorBox error={rule.error} />;
  return <RuleEditor key={id ?? "new"} rule={rule.data} />;
}

function RuleEditor({ rule }: { rule: Schemas["RuleOut"] | undefined }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<RuleFormValues>({
    resolver: zodResolver(ruleSchema),
    defaultValues: rule ? fromRule(rule) : DEFAULT_RULE,
    mode: "onTouched",
  });

  // Keep the form in sync if the saved rule changes underneath (e.g. SSE refetch) while pristine.
  useEffect(() => {
    if (rule && !form.formState.isDirty) form.reset(fromRule(rule));
  }, [rule, form]);

  const save = useMutation({
    mutationFn: (v: RuleFormValues) => {
      const body = toRuleParams(v);
      return rule
        ? api.put("/api/rules/{rule_id}", { path: { rule_id: rule.id }, body })
        : api.post("/api/rules", { body });
    },
    onSuccess: (saved) => {
      qc.setQueryData(qk.rule(saved.id), saved);
      void qc.invalidateQueries({ queryKey: qk.rules });
      toast.success(
        rule ? `Saved ${saved.symbol}` : `Created rule ${saved.symbol}`,
        saved.enabled ? "Enabled." : "Disabled until you enable it.",
      );
      navigate(`/rules/${saved.id}`);
    },
    onError: (e) => {
      toast.error("Could not save the rule", e);
      if (isApiError(e, 422)) {
        for (const [path, msg] of Object.entries(e.fieldErrors)) {
          if (path) form.setError(path as FieldPath<RuleFormValues>, { message: msg });
        }
      }
    },
  });

  const dirty = form.formState.isDirty;
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        title={rule ? `Edit ${rule.symbol}` : "New rule"}
        subtitle={
          rule
            ? "Changes apply from the worker's next evaluation."
            : "Define the trigger, the tier ladder and the limits. New rules start disabled unless you enable them here."
        }
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link to={rule ? `/rules/${rule.id}` : "/rules"}>
              <ArrowLeft /> Back
            </Link>
          </Button>
        }
      />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardContent className="pt-5 sm:pt-5">
            <FormProvider {...form}>
              <form
                className="grid grid-cols-1 gap-6"
                onSubmit={form.handleSubmit((v) => save.mutate(v))}
                noValidate
              >
                <RuleFormFields />
                <ErrorBox error={save.error} />
                <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                  <Button variant="outline" asChild>
                    <Link to={rule ? `/rules/${rule.id}` : "/rules"}>Cancel</Link>
                  </Button>
                  <Button type="submit" disabled={save.isPending || (!!rule && !dirty)}>
                    {save.isPending && <Spinner />} {rule ? "Save changes" : "Create rule"}
                  </Button>
                </div>
              </form>
            </FormProvider>
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 content-start gap-4 lg:sticky lg:top-20">
          {rule && !dirty ? (
            <SavedRulePreview id={rule.id} triggerType={rule.trigger_type} />
          ) : (
            <FormRulePreview
              control={form.control}
              description={
                rule
                  ? "Unsaved changes. Tier prices use the current N-day high and ignore any active cycle."
                  : "Updates as you edit (needs market data)."
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
