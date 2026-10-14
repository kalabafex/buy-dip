import { LineStyle, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";
import type { ChartColors } from "@/components/charts/theme";
import { useChart, useCrosshairTime } from "@/components/charts/useChart";
import { fmtDay } from "@/lib/format";
import { cn } from "@/lib/utils";

export type CumPoint = { date: string; value: number };

type Series = { chart: IChartApi; colors: ChartColors; line: ISeriesApi<"Baseline"> };

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * One cumulative series against a zero baseline (single series: the card title names it, so
 * no legend box). Above zero reads gain, below loss; the readout follows the crosshair.
 */
export function CumulativeChart({
  points,
  format,
  label,
  className,
}: {
  points: CumPoint[];
  format: (v: number) => string;
  /** Accessible name / readout label, e.g. "Plan return, cumulative". */
  label: string;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const formatRef = useRef(format);
  formatRef.current = format;
  const s = useChart(container, (chart, colors): Series => {
    const line = chart.addBaselineSeries({
      baseValue: { type: "price", price: 0 },
      lineWidth: 2,
      topLineColor: colors.up,
      bottomLineColor: colors.down,
      topFillColor1: hexA(colors.up, 0.12),
      topFillColor2: hexA(colors.up, 0.02),
      bottomFillColor1: hexA(colors.down, 0.02),
      bottomFillColor2: hexA(colors.down, 0.12),
      priceLineVisible: false,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: colors.surface,
      crosshairMarkerBorderWidth: 2,
      priceFormat: { type: "custom", formatter: (v: number) => formatRef.current(v), minMove: 0.01 },
    });
    line.createPriceLine({
      price: 0,
      color: colors.axis,
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: false,
      title: "",
    });
    return { chart, colors, line };
  });

  useEffect(() => {
    if (!s) return;
    s.line.setData(points.map((p) => ({ time: p.date as Time, value: p.value })));
    s.chart.timeScale().fitContent();
  }, [s, points]);

  const byDate = useMemo(() => new Map(points.map((p) => [p.date, p])), [points]);
  const hovered = useCrosshairTime(s?.chart);
  const shown = (typeof hovered === "string" ? byDate.get(hovered) : undefined) ?? points[points.length - 1];

  return (
    <div className={cn("grid grid-cols-1 gap-2", className)}>
      <div className="flex min-h-[1.25rem] flex-wrap items-baseline gap-x-2 text-xs" aria-live="polite">
        {shown && (
          <>
            <span
              className={cn(
                "num text-sm font-semibold",
                shown.value > 0 ? "text-gain" : shown.value < 0 ? "text-loss" : "text-foreground",
              )}
            >
              {format(shown.value)}
            </span>
            <span className="text-muted-foreground">
              {label} · {hovered ? fmtDay(shown.date) : `through ${fmtDay(shown.date)}`}
            </span>
          </>
        )}
      </div>
      <div ref={container} className="h-[240px] w-full sm:h-[300px]" role="img" aria-label={label} />
    </div>
  );
}
