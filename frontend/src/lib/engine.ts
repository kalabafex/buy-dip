/**
 * Picks-engine helpers: saved "why this pick" reasons, the projection waterfall, weekly-review
 * parameters (per-setup multipliers, suspensions, certainty recalibration) in plain words.
 */
import {
  Anchor,
  ChartColumn,
  Crosshair,
  Gauge,
  Route,
  Scale,
  SlidersHorizontal,
  UserRound,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Schemas } from "@/api/client";
import { fmtPct, humanize } from "@/lib/format";

export type Reason = Schemas["PickReason"];
export type Contribution = Schemas["PickContribution"];
export type Candidate = Schemas["PickCandidateOut"];
export type EngineOut = Schemas["EngineOut"];
export type EngineVersion = Schemas["EngineVersionOut"];
export type EngineParams = Schemas["EngineParamsOut"];
export type Review = Schemas["EngineReviewOut"];
export type ReviewStats = Schemas["ReviewStats"];
export type ReviewChange = Schemas["ReviewChange"];

/** Icon + short label per saved-reason kind (see backend select.build_reasons). */
export const REASON_META: Record<string, { icon: LucideIcon; label: string }> = {
  setup: { icon: Zap, label: "Setup" },
  setup_history: { icon: ChartColumn, label: "Setup history" },
  stock_history: { icon: UserRound, label: "This stock" },
  base: { icon: Anchor, label: "Starting point" },
  factor: { icon: SlidersHorizontal, label: "Factor" },
  engine: { icon: Scale, label: "Weekly review" },
  plan: { icon: Route, label: "Exit plan" },
  certainty: { icon: Gauge, label: "Certainty" },
  projection: { icon: Crosshair, label: "Projection" },
};

export function reasonMeta(kind: string) {
  return REASON_META[kind] ?? { icon: Zap, label: humanize(kind) };
}

/** Reasons whose impact is a change in percentage points (vs. a level such as the base). */
export function isDeltaReason(r: Reason): boolean {
  return r.kind === "factor" || r.kind === "engine";
}

/** The weekly review marks a suspended setup with an `engine` reason (eligible=false). */
export function isSuspendedByReasons(reasons: Reason[]): boolean {
  return reasons.some((r) => r.kind === "engine" && /suspended/i.test(r.text));
}

const SETUP_LABELS: Record<string, string> = {
  GAP_DOWN_REVERSAL: "Gap-down reversal",
  GAP_UP_MOMENTUM: "Gap-up momentum",
  RSI2_OVERSOLD: "Short-term oversold (RSI-2)",
  PULLBACK_UPTREND: "Pullback in an uptrend",
  BREAKOUT_20D: "20-day breakout",
};

export function setupLabel(family: string, labels?: Record<string, string>): string {
  return labels?.[family] ?? SETUP_LABELS[family] ?? humanize(family);
}

export const SETUP_ORDER = Object.keys(SETUP_LABELS);

// --- certainty recalibration -----------------------------------------------------------

/** What the active calibration turns a raw certainty (0–1) into: σ(a·logit(p) + b). */
export function calibrate(p: number, a: number, b: number): number {
  const q = Math.min(Math.max(p, 1e-4), 1 - 1e-4);
  const z = a * Math.log(q / (1 - q)) + b;
  return 1 / (1 + Math.exp(-z));
}

export function isIdentityCalibration(a: number, b: number): boolean {
  return Math.abs(a - 1) < 1e-6 && Math.abs(b) < 1e-6;
}

/** One sentence on what the a/b pair does to certainties. */
export function certaintyInWords(a: number, b: number): string {
  if (isIdentityCalibration(a, b)) {
    return "Certainties are used as the models compute them — no live recalibration yet.";
  }
  const parts: string[] = [];
  if (a < 0.97) parts.push("pulls certainties toward 50% (they were overconfident)");
  else if (a > 1.03) parts.push("spreads certainties away from 50% (they were too timid)");
  if (b < -0.03) parts.push("shifts them down (fewer plans ended positive than predicted)");
  else if (b > 0.03) parts.push("shifts them up (more plans ended positive than predicted)");
  if (!parts.length) return "Certainties are adjusted only slightly.";
  const s = parts.join(" and ");
  return `The live calibration ${s}.`;
}

// --- version diffs -----------------------------------------------------------------------

export type ParamDiff = { kind: "multiplier" | "suspend" | "unsuspend" | "certainty"; family?: string; text: string };

/** Differences between two engine parameter sets, for the version history. */
export function diffParams(
  before: EngineParams | null,
  after: EngineParams,
  labels?: Record<string, string>,
): ParamDiff[] {
  if (!before) return [];
  const out: ParamDiff[] = [];
  const fams = new Set([...Object.keys(before.family_multiplier), ...Object.keys(after.family_multiplier)]);
  for (const f of fams) {
    const a = before.family_multiplier[f] ?? 1;
    const b = after.family_multiplier[f] ?? 1;
    if (Math.abs(a - b) >= 0.005)
      out.push({ kind: "multiplier", family: f, text: `${setupLabel(f, labels)} ×${a.toFixed(2)} → ×${b.toFixed(2)}` });
  }
  for (const f of after.suspended)
    if (!before.suspended.includes(f)) out.push({ kind: "suspend", family: f, text: `${setupLabel(f, labels)} suspended` });
  for (const f of before.suspended)
    if (!after.suspended.includes(f)) out.push({ kind: "unsuspend", family: f, text: `${setupLabel(f, labels)} reinstated` });
  if (Math.abs(before.certainty_a - after.certainty_a) >= 0.005 || Math.abs(before.certainty_b - after.certainty_b) >= 0.005)
    out.push({ kind: "certainty", text: "Certainty recalibrated" });
  return out;
}

/** `{a, b}` objects in certainty changes; numbers in multiplier changes. */
export function changeValue(v: unknown): { a: number; b: number } | number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "a" in v && "b" in v) {
    const o = v as { a: unknown; b: unknown };
    if (typeof o.a === "number" && typeof o.b === "number") return { a: o.a, b: o.b };
  }
  return null;
}

/** 0–1 rate as "57%". */
export function pct01(r: number | null | undefined, digits = 0): string {
  return r == null ? "—" : `${(r * 100).toFixed(digits)}%`;
}

const FEATURE_UNITS: Record<string, string> = {
  gap_pct: "%",
  atr_pct: "%",
  rsi2: "",
  trend50_pct: "%",
  trend200_pct: "%",
  down_streak: "",
  volume_ratio: "×",
  dist_high20_pct: "%",
};

/** Today's value of a factor: "−3.1%", "1.4×", "6". */
export function fmtFeatureValue(feature: string, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  const unit = FEATURE_UNITS[feature] ?? "";
  const digits = unit === "%" || unit === "×" ? 1 : 0;
  const s = Math.abs(v).toFixed(digits);
  return `${v < 0 ? "−" : ""}${s}${unit}`;
}

/** Range ends: two decimals below 1% so a small negative never reads "−0.0%". */
export function fmtRangePct(v: number): string {
  return fmtPct(v, Math.abs(v) < 1 ? 2 : 1, true);
}
