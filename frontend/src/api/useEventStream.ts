import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { qk } from "./queries";

export type StreamState = "connecting" | "open" | "closed";

/** Which caches each server-sent event invalidates. */
const INVALIDATES: Record<string, QueryKey[]> = {
  evaluation: [["evaluations"], qk.rules],
  order: [["orders"], qk.account, qk.positions, qk.settings, qk.rules],
  settings: [qk.settings, qk.rules, qk.picks],
  // {session_date,...} on publish/evaluation, {id,status} per pick, {model, progress|status},
  // {review, version} after a weekly engine review (qk.picks also covers candidates + engine).
  picks: [qk.picks],
};

/** Events that carry `{id, ...}` of a job: refresh that job and the list. */
function onJobEvent(qc: QueryClient, name: "recommendation" | "backtest", data: string) {
  let id: string | undefined;
  try {
    const parsed = JSON.parse(data) as { id?: unknown };
    id = typeof parsed.id === "string" ? parsed.id : undefined;
  } catch {
    /* ignore */
  }
  const list = name === "recommendation" ? qk.recommendations : qk.backtests;
  void qc.invalidateQueries({ queryKey: list, exact: !!id });
  if (id)
    void qc.invalidateQueries({
      queryKey: name === "recommendation" ? qk.recommendation(id) : qk.backtest(id),
    });
}

const MAX_BACKOFF_MS = 30_000;

/**
 * Subscribes to GET /api/stream and invalidates TanStack Query caches on each event.
 * Reconnects with exponential backoff; on (re)connect everything is refetched, since
 * events may have been missed while disconnected.
 */
export function useEventStream(enabled: boolean): StreamState {
  const qc = useQueryClient();
  const [state, setState] = useState<StreamState>("connecting");

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let timer: number | undefined;
    let attempt = 0;
    let disposed = false;
    let connectedOnce = false;

    const connect = () => {
      if (disposed) return;
      setState("connecting");
      es = new EventSource("/api/stream", { withCredentials: true });
      es.addEventListener("hello", () => {
        attempt = 0;
        setState("open");
        if (connectedOnce) void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
        connectedOnce = true;
      });
      for (const [name, keys] of Object.entries(INVALIDATES)) {
        es.addEventListener(name, () => {
          for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
        });
      }
      es.addEventListener("backtest", (e) => onJobEvent(qc, "backtest", (e as MessageEvent<string>).data));
      es.addEventListener("recommendation", (e) =>
        onJobEvent(qc, "recommendation", (e as MessageEvent<string>).data),
      );
      es.onerror = () => {
        es?.close();
        es = null;
        setState("closed");
        const delay = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** attempt) * (0.75 + Math.random() / 2);
        attempt += 1;
        // A dead stream may mean the session expired; re-check it (401 → login).
        void qc.invalidateQueries({ queryKey: qk.me });
        timer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      es?.close();
    };
  }, [enabled, qc]);

  return state;
}
