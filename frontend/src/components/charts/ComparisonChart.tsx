import { LineStyle, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";
import { Legend } from "@/components/charts/Legend";
import type { ChartColors } from "@/components/charts/theme";
import { useChart, useCrosshairTime } from "@/components/charts/useChart";
import { fmtDay } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ComparisonPoint = { date: string; rule: string; baseline: string };

type Series = {
  chart: IChartApi;
  colors: ChartColors;
  rule: ISeriesApi<"Line">;
  baseline: ISeriesApi<"Line">;
};

/**
 * Rule (accent) vs monthly-DCA baseline (gray context) on one shared axis.
 * Emphasis form: the rule is the subject, DCA is the reference.
 */
export function ComparisonChart({
  points,
  ruleLabel = "Rule",
  baselineLabel = "Monthly DCA",
  format,
  zeroLine = false,
  interactive = true,
  chartHeight = "h-[260px] sm:h-[320px]",
  className,
}: {
  points: ComparisonPoint[];
  ruleLabel?: string;
  baselineLabel?: string;
  format: (v: number) => string;
  zeroLine?: boolean;
  interactive?: boolean;
  /** Height classes for the plot (includes the time axis band). */
  chartHeight?: string;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const formatRef = useRef(format);
  const zeroRef = useRef(zeroLine);
  const s = useChart(
    container,
    (chart, colors): Series => {
      const priceFormat = {
        type: "custom" as const,
        formatter: (v: number) => formatRef.current(v),
        minMove: 0.01,
      };
      const common = {
        lineWidth: 2 as const,
        priceLineVisible: false,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: colors.surface,
        crosshairMarkerBorderWidth: 2,
        priceFormat,
      };
      const baseline = chart.addLineSeries({ ...common, color: colors.context, lastValueVisible: false });
      const rule = chart.addLineSeries({ ...common, color: colors.series1 });
      if (zeroRef.current) {
        rule.createPriceLine({
          price: 0,
          color: colors.axis,
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: false,
          title: "",
        });
      }
      return { chart, colors, baseline, rule };
    },
    { interactive },
  );

  const byDate = useMemo(() => new Map(points.map((p) => [p.date, p])), [points]);

  useEffect(() => {
    if (!s) return;
    s.rule.setData(points.map((p) => ({ time: p.date as Time, value: Number(p.rule) })));
    s.baseline.setData(points.map((p) => ({ time: p.date as Time, value: Number(p.baseline) })));
    s.chart.timeScale().fitContent();
  }, [s, points]);

  const hovered = useCrosshairTime(s?.chart);
  const shown = (typeof hovered === "string" ? byDate.get(hovered) : undefined) ?? points[points.length - 1];
  const colors = s?.colors;

  return (
    <div className={cn("grid grid-cols-1 gap-2", className)}>
      <Legend
        title={shown ? fmtDay(shown.date) : undefined}
        items={[
          {
            label: ruleLabel,
            color: colors?.series1 ?? "currentColor",
            value: shown ? format(Number(shown.rule)) : undefined,
          },
          {
            label: baselineLabel,
            color: colors?.context ?? "currentColor",
            value: shown ? format(Number(shown.baseline)) : undefined,
          },
        ]}
      />
      <div ref={container} className={cn("w-full", chartHeight)} />
    </div>
  );
}
