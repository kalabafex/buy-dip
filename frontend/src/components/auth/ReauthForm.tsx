import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api, type Schemas } from "@/api/client";
import { qk } from "@/api/queries";
import { totpSchema } from "@/components/auth/totp";
import { ErrorBox, Spinner } from "@/components/common";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const schema = z.object({
  password: z.string().min(1, "Required"),
  totp: totpSchema,
});
type Values = z.infer<typeof schema>;

/** Password + TOTP form for POST /api/auth/reauth (grants a 5-minute elevated session). */
export function ReauthForm({
  onSuccess,
  onCancel,
  submitLabel = "Confirm identity",
}: {
  onSuccess: (me: Schemas["MeOut"]) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const qc = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", totp: "" },
  });
  const m = useMutation({
    mutationFn: (v: Values) => api.post("/api/auth/reauth", { body: v }),
    onSuccess: (me) => {
      qc.setQueryData(qk.me, me);
      onSuccess(me);
    },
    onError: () => form.resetField("totp"),
  });
  const { errors } = form.formState;

  return (
    <form
      className="grid grid-cols-1 gap-3"
      onSubmit={form.handleSubmit((v) => m.mutate(v))}
      autoComplete="off"
    >
      <FormField id="reauth-password" label="Password" error={errors.password?.message}>
        <Input
          id="reauth-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          {...form.register("password")}
        />
      </FormField>
      <FormField id="reauth-totp" label="Authenticator code" error={errors.totp?.message}>
        <Input
          id="reauth-totp"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="123456"
          {...form.register("totp")}
        />
      </FormField>
      <ErrorBox error={m.error} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} disabled={m.isPending}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={m.isPending}>
          {m.isPending && <Spinner />} {submitLabel}
        </Button>
      </div>
    </form>
  );
}
