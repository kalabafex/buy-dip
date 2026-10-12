import { z } from "zod";
import type { Schemas } from "@/api/client";

/** Mirrors backend RuleParams validation (domain/models.py). */

export const TRIGGER_TYPES = [
  "PULLBACK_FROM_HIGH",
  "RSI_OVERSOLD",
  "BELOW_MA",
] as const satisfies readonly Schemas["TriggerType"][];

export const TREND_FILTERS = ["NONE", "ABOVE_200DMA"] as const satisfies readonly Schemas["TrendFilter"][];

export const TRIGGER_LABELS: Record<Schemas["TriggerType"], string> = {
  PULLBACK_FROM_HIGH: "Pullback from N-day high",
  RSI_OVERSOLD: "RSI(14) oversold",
  BELOW_MA: "Close below moving average",
};

export const TREND_LABELS: Record<Schemas["TrendFilter"], string> = {
  NONE: "None",
  ABOVE_200DMA: "Only above 200-day SMA",
};

const num = (msg = "Must be a number") =>
  z.number({ required_error: "Required", invalid_type_error: msg });
const int = (min: number, max: number) =>
  num().int("Must be a whole number").min(min, `Min ${min}`).max(max, `Max ${max}`);

export const tierSchema = z.object({
  drop_pct: num().min(1, "Min 1%").max(60, "Max 60%"),
  amount_usd: num().positive("Must be > 0"),
});

export const ruleSchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .min(1, "Required")
      .max(12, "Max 12 characters")
      .regex(/^[A-Z0-9.-]+$/, "Uppercase letters, digits, '.' or '-'"),
    enabled: z.boolean(),
    trigger_type: z.enum(TRIGGER_TYPES),
    lookback_days: int(5, 250),
    tiers: z.array(tierSchema).min(1, "At least one tier").max(5, "At most 5 tiers"),
    // Range-checked below only when the trigger type needs them.
    rsi_threshold: num().nullable(),
    ma_period: num().nullable(),
    trend_filter: z.enum(TREND_FILTERS),
    confirm_evals: int(1, 10),
    max_position_usd: num().positive("Must be > 0"),
    cooldown_days: int(0, 60),
    limit_offset_pct: num().min(0, "Min 0").max(2, "Max 2"),
  })
  .superRefine((v, ctx) => {
    v.tiers.forEach((t, i) => {
      const prev = v.tiers[i - 1];
      if (i > 0 && prev && !(t.drop_pct > prev.drop_pct)) {
        ctx.addIssue({
          code: "custom",
          path: ["tiers", i, "drop_pct"],
          message: "Must be greater than the previous tier",
        });
      }
    });
    if (v.trigger_type === "RSI_OVERSOLD") {
      const r = v.rsi_threshold;
      if (r === null) {
        ctx.addIssue({ code: "custom", path: ["rsi_threshold"], message: "Required for RSI trigger" });
      } else if (r < 5 || r > 50) {
        ctx.addIssue({ code: "custom", path: ["rsi_threshold"], message: "Must be 5–50" });
      }
    }
    if (v.trigger_type === "BELOW_MA") {
      const p = v.ma_period;
      if (p === null) {
        ctx.addIssue({ code: "custom", path: ["ma_period"], message: "Required for MA trigger" });
      } else if (!Number.isInteger(p) || p < 10 || p > 250) {
        ctx.addIssue({ code: "custom", path: ["ma_period"], message: "Whole number 10–250" });
      }
    }
    const sum = v.tiers.reduce((acc, t) => acc + (Number.isFinite(t.amount_usd) ? t.amount_usd : 0), 0);
    if (v.max_position_usd < sum - 1e-9) {
      ctx.addIssue({
        code: "custom",
        path: ["max_position_usd"],
        message: `Must be ≥ sum of tier amounts ($${sum.toLocaleString()})`,
      });
    }
  });

export type RuleFormValues = z.infer<typeof ruleSchema>;
export type RuleParamsBody = Schemas["RuleParams"];

export const DEFAULT_RULE: RuleFormValues = {
  symbol: "",
  enabled: false,
  trigger_type: "PULLBACK_FROM_HIGH",
  lookback_days: 20,
  tiers: [
    { drop_pct: 5, amount_usd: 100 },
    { drop_pct: 10, amount_usd: 200 },
  ],
  rsi_threshold: null,
  ma_period: null,
  trend_filter: "ABOVE_200DMA",
  confirm_evals: 2,
  max_position_usd: 1000,
  cooldown_days: 5,
  limit_offset_pct: 0.3,
};

/** Form values → API body. Decimals are sent as strings to avoid float artifacts. */
export function toRuleParams(v: RuleFormValues): RuleParamsBody {
  return {
    symbol: v.symbol.trim().toUpperCase(),
    enabled: v.enabled,
    trigger_type: v.trigger_type,
    lookback_days: v.lookback_days,
    tiers: v.tiers.map((t) => ({ drop_pct: String(t.drop_pct), amount_usd: String(t.amount_usd) })),
    rsi_threshold:
      v.trigger_type === "RSI_OVERSOLD" && v.rsi_threshold !== null ? String(v.rsi_threshold) : null,
    ma_period: v.trigger_type === "BELOW_MA" ? v.ma_period : null,
    trend_filter: v.trend_filter,
    confirm_evals: v.confirm_evals,
    max_position_usd: String(v.max_position_usd),
    cooldown_days: v.cooldown_days,
    limit_offset_pct: String(v.limit_offset_pct),
  };
}

/** Saved rule (decimal strings) → form values. */
export function fromRule(r: Schemas["RuleOut"]): RuleFormValues {
  return {
    symbol: r.symbol,
    enabled: r.enabled ?? false,
    trigger_type: r.trigger_type ?? "PULLBACK_FROM_HIGH",
    lookback_days: r.lookback_days ?? 20,
    tiers: r.tiers.map((t) => ({ drop_pct: Number(t.drop_pct), amount_usd: Number(t.amount_usd) })),
    rsi_threshold: r.rsi_threshold != null ? Number(r.rsi_threshold) : null,
    ma_period: r.ma_period ?? null,
    trend_filter: r.trend_filter ?? "ABOVE_200DMA",
    confirm_evals: r.confirm_evals ?? 2,
    max_position_usd: Number(r.max_position_usd),
    cooldown_days: r.cooldown_days ?? 5,
    limit_offset_pct: Number(r.limit_offset_pct ?? "0.3"),
  };
}

/** Same as fromRule but from a backtest's `rule_snapshot` (untyped JSON). */
export function fromSnapshot(snap: Record<string, unknown>): RuleFormValues | null {
  const parsed = ruleSchema.safeParse({
    ...DEFAULT_RULE,
    ...snap,
    tiers: Array.isArray(snap.tiers)
      ? (snap.tiers as { drop_pct: unknown; amount_usd: unknown }[]).map((t) => ({
          drop_pct: Number(t.drop_pct),
          amount_usd: Number(t.amount_usd),
        }))
      : DEFAULT_RULE.tiers,
    rsi_threshold: snap.rsi_threshold != null ? Number(snap.rsi_threshold) : null,
    max_position_usd: Number(snap.max_position_usd),
    limit_offset_pct: Number(snap.limit_offset_pct ?? 0.3),
  });
  return parsed.success ? parsed.data : null;
}

/** "-5%/$100 · -10%/$200" */
export function tiersSummary(tiers: { drop_pct: string | number; amount_usd: string | number }[]): string {
  return tiers
    .map((t) => `-${Number(t.drop_pct)}%/$${Number(t.amount_usd).toLocaleString()}`)
    .join(" · ");
}

export function triggerSummary(r: {
  trigger_type?: Schemas["TriggerType"];
  lookback_days?: number;
  rsi_threshold?: string | number | null;
  ma_period?: number | null;
}): string {
  switch (r.trigger_type ?? "PULLBACK_FROM_HIGH") {
    case "PULLBACK_FROM_HIGH":
      return `Pullback from ${r.lookback_days ?? 20}d high`;
    case "RSI_OVERSOLD":
      return `RSI14 ≤ ${Number(r.rsi_threshold)}`;
    case "BELOW_MA":
      return `Below SMA${r.ma_period ?? "?"}`;
  }
}
