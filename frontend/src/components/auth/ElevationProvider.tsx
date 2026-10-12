import { useCallback, useRef, useState, type ReactNode } from "react";
import { ElevationContext } from "@/components/auth/elevation";
import { ReauthForm } from "@/components/auth/ReauthForm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ElevationProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | undefined>();
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpen(false);
  };

  const request = useCallback((why?: string) => {
    resolver.current?.(false);
    setReason(why);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  return (
    <ElevationContext.Provider value={request}>
      {children}
      <Dialog open={open} onOpenChange={(o) => !o && finish(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-authentication required</DialogTitle>
            <DialogDescription>
              {reason ?? "This action needs a recent sign-in."} Enter your password and
              authenticator code; the elevated session lasts 5 minutes.
            </DialogDescription>
          </DialogHeader>
          {open && <ReauthForm onSuccess={() => finish(true)} onCancel={() => finish(false)} />}
        </DialogContent>
      </Dialog>
    </ElevationContext.Provider>
  );
}
