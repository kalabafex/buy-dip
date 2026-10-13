import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, isApiError } from "@/api/client";
import { isElevated, qk, useMe } from "@/api/queries";
import { ReauthForm } from "@/components/auth/ReauthForm";
import { ErrorBox, Spinner } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";

/** Two-step switch to LIVE: re-auth (if not elevated), then type "LIVE" to confirm. */
export function LiveModeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-loss">Switch to LIVE trading</DialogTitle>
          <DialogDescription>
            The worker will place real orders with real money using your live broker account.
          </DialogDescription>
        </DialogHeader>
        {open && <LiveModeSteps onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function LiveModeSteps({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const me = useMe();
  const [forceReauth, setForceReauth] = useState(false);
  const [confirm, setConfirm] = useState("");
  const elevated = isElevated(me.data) && !forceReauth;

  const m = useMutation({
    mutationFn: () => api.post("/api/mode", { body: { mode: "LIVE", confirm } }),
    onSuccess: (s) => {
      qc.setQueryData(qk.settings, s);
      toast.success("LIVE trading enabled", "The worker now places real orders.");
      onDone();
    },
    onError: (e) => {
      if (isApiError(e, 403)) setForceReauth(true);
    },
  });

  if (!elevated) {
    return (
      <div className="grid grid-cols-1 gap-3">
        <p className="text-sm">
          {forceReauth ? "Your elevated session expired. " : "Step 1 of 2: "}confirm your identity.
        </p>
        <ReauthForm onSuccess={() => setForceReauth(false)} onCancel={onDone} submitLabel="Continue" />
      </div>
    );
  }

  return (
    <form
      className="grid grid-cols-1 gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm === "LIVE") m.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-1.5">
        <Label htmlFor="live-confirm">
          Step 2 of 2: type <span className="font-mono font-bold text-foreground">LIVE</span> to confirm
        </Label>
        <Input
          id="live-confirm"
          autoComplete="off"
          autoFocus
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="LIVE"
        />
      </div>
      <ErrorBox error={m.isError && !isApiError(m.error, 403) ? m.error : null} />
      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={m.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={confirm !== "LIVE" || m.isPending}>
          {m.isPending && <Spinner />} Enable LIVE trading
        </Button>
      </DialogFooter>
    </form>
  );
}
