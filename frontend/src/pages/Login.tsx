import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogIn } from "lucide-react";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate, type Location } from "react-router-dom";
import { z } from "zod";
import { api, isApiError } from "@/api/client";
import { qk, useMe } from "@/api/queries";
import { totpSchema } from "@/components/auth/totp";
import { ErrorBox, Spinner } from "@/components/common";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BrandMark } from "@/components/layout/Brand";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_50%_-10%,hsl(var(--primary)/0.12),transparent)]"
      />
      <div className="absolute right-3 top-3">
        <ThemeToggle />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark className="h-11 w-11" />
          <h1 className="mt-3 text-xl font-semibold tracking-tight">Dip Buyer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with your password and authenticator code.
          </p>
        </div>
        <Card className="shadow-pop">
          <CardContent className="pt-5 sm:pt-5">
            <form className="grid grid-cols-1 gap-4" onSubmit={form.handleSubmit((v) => login.mutate(v))}>
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
                  className="font-mono tracking-[0.3em]"
                  {...form.register("totp")}
                />
              </FormField>
              {err &&
                (isApiError(err, 401) ? (
                  <ErrorBox error={new Error("Invalid username, password or code.")} />
                ) : (
                  <ErrorBox error={err} />
                ))}
              <Button type="submit" size="lg" disabled={login.isPending}>
                {login.isPending ? <Spinner /> : <LogIn />} Sign in
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
