import { ColorType, CrosshairMode, LineStyle, type ChartOptions, type DeepPartial } from "lightweight-charts";

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

/**
 * Chart palette (dataviz reference palette, validated for light/dark surfaces):
 * categorical slots 1–3 (blue, orange, aqua) for overlays, gray for the de-emphasized
 * comparison series, semantic gain/loss for candles. Text never uses series colors.
 */
export type ChartColors = {
  text: string;
  muted: string;
  grid: string;
  axis: string;
  crosshair: string;
  series1: string;
  series2: string;
  series3: string;
  context: string;
  up: string;
  down: string;
  good: string;
  ink: string;
  surface: string;
};

export function chartColors(dark: boolean): ChartColors {
  return dark
    ? {
        text: "#c3c2b7",
        muted: "#898781",
        grid: "#232326",
        axis: "#38383d",
        crosshair: "#6b6a66",
        series1: "#3987e5",
        series2: "#d95926",
        series3: "#199e70",
        context: "#8a8a92",
        up: "#22b55a",
        down: "#e66767",
        good: "#0ca30c",
        ink: "#f0efec",
        surface: "#141416",
      }
    : {
        text: "#52514e",
        muted: "#898781",
        grid: "#ececf0",
        axis: "#d4d4da",
        crosshair: "#9a9994",
        series1: "#2a78d6",
        series2: "#eb6834",
        series3: "#1baf7a",
        context: "#9a9aa3",
        up: "#16a34a",
        down: "#dc2626",
        good: "#0ca30c",
        ink: "#0b0b0b",
        surface: "#ffffff",
      };
}

export function chartOptions(c: ChartColors, interactive: boolean): DeepPartial<ChartOptions> {
  return {
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: c.muted,
      fontSize: 11,
      fontFamily: '"Inter Variable", system-ui, sans-serif',
    },
    grid: { vertLines: { visible: false }, horzLines: { color: c.grid, style: LineStyle.Solid } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
    timeScale: { borderColor: c.axis, rightOffset: 2, fixLeftEdge: true, fixRightEdge: true },
    crosshair: {
      mode: CrosshairMode.Magnet,
      vertLine: { color: c.crosshair, width: 1, style: LineStyle.Solid, labelBackgroundColor: c.text },
      horzLine: { color: c.crosshair, width: 1, style: LineStyle.Dotted, labelBackgroundColor: c.text },
    },
    handleScroll: interactive,
    handleScale: interactive,
    localization: { locale: safeLocale() },
  };
}
