import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { inPicksWindow } from "@/lib/picks";
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
  /** Prefix of every daily-picks query (SSE `picks` events invalidate all of them). */
  picks: ["picks"] as const,
  picksDay: (date: string | null) => ["picks", "day", date ?? "today"] as const,
  picksDays: (limit: number) => ["picks", "days", limit] as const,
  picksPerformance: ["picks", "performance"] as const,
  picksModel: ["picks", "model"] as const,
  picksSettings: ["picks", "settings"] as const,
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

// --- Daily picks -------------------------------------------------------------------------

const CALIBRATING: Schemas["BacktestStatus"][] = ["QUEUED", "RUNNING"];

/**
 * One day's picks (default: today in New York). Polled every 5 s while a calibration is
 * running and every 30 s around market hours, as a fallback to SSE `picks` events.
 */
export function usePicksDay(date: string | null) {
  return useQuery({
    queryKey: qk.picksDay(date),
    queryFn: ({ signal }) => api.get("/api/picks/day", { query: { date }, signal }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      if (query.state.data?.calibration_in_progress) return 5_000;
      return inPicksWindow(Date.now()) ? 30_000 : false;
    },
  });
}

export function usePicksDays(limit = 60) {
  return useQuery({
    queryKey: qk.picksDays(limit),
    queryFn: ({ signal }) => api.get("/api/picks/days", { query: { limit }, signal }),
    staleTime: 60_000,
  });
}

export function usePicksPerformance() {
  return useQuery({
    queryKey: qk.picksPerformance,
    queryFn: ({ signal }) => api.get("/api/picks/performance", { signal }),
    staleTime: 60_000,
  });
}

/** Latest calibration (any status); polled every 5 s while queued/running. */
export function usePicksModel() {
  return useQuery({
    queryKey: qk.picksModel,
    queryFn: ({ signal }) => api.get("/api/picks/model", { signal }),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s && CALIBRATING.includes(s) ? 5_000 : false;
    },
  });
}
