import { createContext, useCallback, useContext } from "react";
import { isApiError } from "@/api/client";

export type RequestElevation = (reason?: string) => Promise<boolean>;

export const ElevationContext = createContext<RequestElevation | null>(null);

/** Opens the re-auth dialog; resolves true once the session is elevated. */
export function useRequestElevation(): RequestElevation {
  const ctx = useContext(ElevationContext);
  if (!ctx) throw new Error("useRequestElevation must be used inside <ElevationProvider>");
  return ctx;
}

/**
 * Runs `fn`; if the API answers 403 (re-authentication required), prompts for
 * password + TOTP and retries once. Resolves `undefined` if the user cancels.
 */
export function useElevatedAction() {
  const request = useRequestElevation();
  return useCallback(
    async <T,>(fn: () => Promise<T>, reason?: string): Promise<T | undefined> => {
      try {
        return await fn();
      } catch (e) {
        if (!isApiError(e, 403)) throw e;
        if (!(await request(reason))) return undefined;
        return await fn();
      }
    },
    [request],
  );
}
