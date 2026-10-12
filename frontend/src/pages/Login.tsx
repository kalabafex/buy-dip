import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate, type Location } from "react-router-dom";
import { z } from "zod";
import { api, isApiError } from "@/api/client";
import { qk, useMe } from "@/api/queries";
import { totpSchema } from "@/components/auth/totp";
import { ErrorBox, Spinner } from "@/components/common";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const schema = z.object({
  username: z.string().trim().min(1, "Required"),
  password: z.string().min(1, "Required"),
  totp: totpSchema,
});
type Values = z.infer<typeof schema>;

export function LoginPage() {
  const qc = useQueryClient();
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location } | null)?.from?.pathname ?? "/";

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "", totp: "" },
  });
  const login = useMutation({
    mutationFn: (v: Values) => api.post("/api/auth/login", { body: v }),
    onSuccess: (data) => {
      qc.setQueryData(qk.me, data);
      navigate(from === "/login" ? "/" : from, { replace: true });
    },
    onError: () => form.resetField("totp"),
  });

  if (me.data) return <Navigate to={from} replace />;

  const { errors } = form.formState;
  const err = login.error;
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">Dip Buyer</CardTitle>
          <CardDescription>Sign in with your password and authenticator code.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 gap-3" onSubmit={form.handleSubmit((v) => login.mutate(v))}>
            <FormField id="username" label="Username" error={errors.username?.message}>
              <Input id="username" autoComplete="username" autoFocus {...form.register("username")} />
            </FormField>
            <FormField id="password" label="Password" error={errors.password?.message}>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...form.register("password")}
              />
            </FormField>
            <FormField id="totp" label="Authenticator code" error={errors.totp?.message}>
              <Input
                id="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                {...form.register("totp")}
              />
            </FormField>
            {err &&
              (isApiError(err, 401) ? (
                <ErrorBox error={new Error("Invalid username, password or code.")} />
              ) : (
                <ErrorBox error={err} />
              ))}
            <Button type="submit" disabled={login.isPending}>
              {login.isPending && <Spinner />} Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
