import { z } from "zod";

/**
 * Shape of BacktestOut.results (backend backtest/__init__.py BacktestResult.to_json).
 * The OpenAPI schema types it as a free-form object, so it is validated at runtime here.
 */
const dec = z.string();

const metrics = z.object({
  total_invested: dec,
  final_value: dec,
  final_equity: dec,
  return_pct: dec,
  max_drawdown_pct: dec,
  num_buys: z.number(),
  avg_cost: dec.nullable(),
});

export const backtestResultsSchema = z.object({
  symbol: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  starting_cash: dec,
  rule: metrics,
  baseline: metrics,
  /** Buy and hold the same dollars from the first open; absent in older results. */
  hold: metrics.optional(),
  equity_curve: z.array(z.object({ date: z.string(), rule: dec, baseline: dec, hold: dec.optional() })),
  trades: z.array(
    z.object({
      session_date: z.string(),
      placed_date: z.string(),
      /** 1-based (unlike tier_index elsewhere in the API). */
      tier: z.number(),
      qty: dec,
      limit_price: dec,
      fill_price: dec.nullable(),
      cost: dec.nullable(),
      status: z.string(),
    }),
  ),
  decisions: z.record(z.number()),
});

export type BacktestResults = z.infer<typeof backtestResultsSchema>;
export type BacktestMetrics = z.infer<typeof metrics>;
