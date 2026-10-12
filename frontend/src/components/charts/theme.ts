import { ColorType, type DeepPartial, type ChartOptions } from "lightweight-charts";

/** navigator.language, unless Intl rejects it (lightweight-charts would throw). */
export function safeLocale(): string {
  const lang = typeof navigator !== "undefined" ? navigator.language : "en-US";
  try {
    new Intl.NumberFormat(lang);
    return lang;
  } catch {
    return "en-US";
  }
}

export function chartTheme(dark: boolean): DeepPartial<ChartOptions> {
  const text = dark ? "#a3a3a3" : "#525252";
  const grid = dark ? "#262626" : "#f0f0f0";
  const border = dark ? "#404040" : "#d4d4d4";
  return {
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: text,
      fontSize: 11,
    },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    rightPriceScale: { borderColor: border },
    timeScale: { borderColor: border },
  };
}

export const SERIES_COLORS = {
  up: "#16a34a",
  down: "#dc2626",
  highN: "#f59e0b",
  sma50: "#3b82f6",
  sma200: "#a855f7",
  tier: "#f97316",
  tierFilled: "#16a34a",
  fill: "#2563eb",
  rule: "#2563eb",
  baseline: "#a3a3a3",
};
