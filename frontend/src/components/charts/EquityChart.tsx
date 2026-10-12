import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { Legend } from "@/components/charts/Legend";
import { SERIES_COLORS as C } from "@/components/charts/theme";
import { useChart } from "@/components/charts/useChart";

export type EquityPoint = { date: string; rule: string; baseline: string };

type Series = { chart: IChartApi; rule: ISeriesApi<"Line">; baseline: ISeriesApi<"Line"> };

function setup(chart: IChartApi): Series {
  return {
    chart,
    baseline: chart.addLineSeries({ color: C.baseline, lineWidth: 2, priceLineVisible: false, title: "DCA" }),
    rule: chart.addLineSeries({ color: C.rule, lineWidth: 2, priceLineVisible: false, title: "Rule" }),
  };
}

/** Rule equity vs monthly-DCA baseline equity over the backtest. */
export function EquityChart({ curve }: { curve: EquityPoint[] }) {
  const container = useRef<HTMLDivElement>(null);
  const s = useChart(container, setup);

  useEffect(() => {
    if (!s) return;
    s.rule.setData(curve.map((p) => ({ time: p.date as Time, value: Number(p.rule) })));
    s.baseline.setData(curve.map((p) => ({ time: p.date as Time, value: Number(p.baseline) })));
    s.chart.timeScale().fitContent();
  }, [s, curve]);

  return (
    <div className="grid grid-cols-1 gap-2">
      <div ref={container} className="h-[280px] w-full sm:h-[340px]" />
      <Legend
        items={[
          { label: "Rule equity", color: C.rule },
          { label: "Monthly DCA baseline equity", color: C.baseline },
        ]}
      />
    </div>
  );
}
