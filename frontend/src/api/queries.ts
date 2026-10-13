import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, isApiError, type QueryOf, type Schemas } from "./client";

export const qk = {
  me: ["me"] as const,
  health: ["health"] as const,
  settings: ["settings"] as const,
  account: ["account"] as const,
  positions: ["positions"] as const,
  rules: ["rules"] as const,
  rule: (id: string) => ["rules", id] as const,
  rulePreview: (id: string) => ["rules", id, "preview"] as const,
  ruleChart: (id: string, days: number) => ["rules", id, "chart", days] as const,
  paramsPreview: (json: string) => ["preview", json] as const,
  orders: (q: OrdersQuery) => ["orders", q] as const,
  evaluations: (q: EvaluationsQuery) => ["evaluations", q] as const,
  backtests: ["backtests"] as const,
  backtest: (id: string) => ["backtests", id] as const,
  recommendations: ["recommendations"] as const,
  recommendation: (id: string) => ["recommendations", id] as const,
};

export type OrdersQuery = QueryOf<"/api/orders", "get">;
export type EvaluationsQuery = QueryOf<"/api/evaluations", "get">;

/** Current user, or null when not signed in. */
export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async ({ signal }): Promise<Schemas["MeOut"] | null> => {
      try {
        return await api.get("/api/auth/me", { signal });
      } catch (e) {
        if (isApiError(e, 401)) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function isElevated(me: Schemas["MeOut"] | null | undefined, now = Date.now()): boolean {
  return !!me?.elevated_until && new Date(me.elevated_until).getTime() > now + 5_000;
}

export function useHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: ({ signal }) => api.get("/api/health", { signal }),
    refetchInterval: 30_000,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: qk.settings,
    queryFn: ({ signal }) => api.get("/api/settings", { signal }),
  });
}

// Account/position snapshots are written by the worker without an SSE event, so poll.
export function useAccount() {
  return useQuery({
    queryKey: qk.account,
    queryFn: ({ signal }) => api.get("/api/account", { signal }),
    refetchInterval: 60_000,
  });
}

export function usePositions() {
  return useQuery({
    queryKey: qk.positions,
    queryFn: ({ signal }) => api.get("/api/positions", { signal }),
    refetchInterval: 60_000,
  });
}

export function useRules() {
  return useQuery({
    queryKey: qk.rules,
    queryFn: ({ signal }) => api.get("/api/rules", { signal }),
  });
}

export function useRule(id: string | undefined) {
  return useQuery({
    queryKey: qk.rule(id ?? ""),
    queryFn: ({ signal }) => api.get("/api/rules/{rule_id}", { path: { rule_id: id! }, signal }),
    enabled: !!id,
  });
}

export function useRulePreview(id: string | undefined) {
  return useQuery({
    queryKey: qk.rulePreview(id ?? ""),
    queryFn: ({ signal }) => api.get("/api/rules/{rule_id}/preview", { path: { rule_id: id! }, signal }),
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useRuleChart(id: string | undefined, days: number) {
  return useQuery({
    queryKey: qk.ruleChart(id ?? "", days),
    queryFn: ({ signal }) =>
      api.get("/api/rules/{rule_id}/chart", {
        path: { rule_id: id! },
        query: { days },
        signal,
      }),
    enabled: !!id,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useOrders(q: OrdersQuery) {
  return useQuery({
    queryKey: qk.orders(q),
    queryFn: ({ signal }) => api.get("/api/orders", { query: q, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useEvaluations(q: EvaluationsQuery) {
  return useQuery({
    queryKey: qk.evaluations(q),
    queryFn: ({ signal }) => api.get("/api/evaluations", { query: q, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useBacktests() {
  return useQuery({
    queryKey: qk.backtests,
    queryFn: ({ signal }) => api.get("/api/backtests", { signal }),
  });
}

const FINISHED: Schemas["BacktestStatus"][] = ["DONE", "FAILED"];

export function useBacktest(id: string | null) {
  return useQuery({
    queryKey: qk.backtest(id ?? ""),
    queryFn: ({ signal }) => api.get("/api/backtests/{backtest_id}", { path: { backtest_id: id! }, signal }),
    enabled: !!id,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s && FINISHED.includes(s) ? false : 2_000;
    },
  });
}

export function useRecommendations() {
  return useQuery({
    queryKey: qk.recommendations,
    queryFn: ({ signal }) => api.get("/api/recommendations", { signal }),
    // Fallback while any run is in flight (SSE also invalidates this list).
    refetchInterval: (query) => (query.state.data?.some((r) => !FINISHED.includes(r.status)) ? 5_000 : false),
  });
}

/** One run; polled every 2 s while QUEUED/RUNNING as a fallback to SSE progress events. */
export function useRecommendation(id: string | null) {
  return useQuery({
    queryKey: qk.recommendation(id ?? ""),
    queryFn: ({ signal }) => api.get("/api/recommendations/{rec_id}", { path: { rec_id: id! }, signal }),
    enabled: !!id,
    staleTime: (query) => {
      const s = query.state.data?.status;
      return s && FINISHED.includes(s) ? 5 * 60_000 : 0;
    },
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s && FINISHED.includes(s) ? false : 2_000;
    },
  });
}
