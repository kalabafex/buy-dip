import { LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type SeriesMarker, type Time } from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { Schemas } from "@/api/client";
import { Legend } from "@/components/charts/Legend";
import { SERIES_COLORS as C } from "@/components/charts/theme";
import { useChart } from "@/components/charts/useChart";
import { fmtNum, fmtPrice, tierLabel } from "@/lib/format";

type Series = {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  highN: ISeriesApi<"Line">;
  sma50: ISeriesApi<"Line">;
  sma200: ISeriesApi<"Line">;
};

const line = { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false } as const;

function setup(chart: IChartApi): Series {
  return {
    chart,
    candles: chart.addCandlestickSeries({
      upColor: C.up,
      downColor: C.down,
      borderUpColor: C.up,
      borderDownColor: C.down,
      wickUpColor: C.up,
      wickDownColor: C.down,
    }),
    highN: chart.addLineSeries({ ...line, color: C.highN, lineStyle: LineStyle.Dotted, lineWidth: 2 }),
    sma50: chart.addLineSeries({ ...line, color: C.sma50 }),
    sma200: chart.addLineSeries({ ...line, color: C.sma200 }),
  };
}

const points = (pts: Schemas["ChartPoint"][]) => pts.map((p) => ({ time: p.time as Time, value: Number(p.value) }));

/** Candlesticks + N-day high / SMA50 / SMA200, tier trigger price lines and fill markers. */
export function RuleChart({ data, lookbackDays }: { data: Schemas["ChartOut"]; lookbackDays?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const s = useChart(container, setup);
  const priceLines = useRef<{ owner: ISeriesApi<"Candlestick">; lines: IPriceLine[] } | null>(null);

  useEffect(() => {
    if (!s) return;
    s.candles.setData(
      data.bars.map((b) => ({
        time: b.time as Time,
        open: Number(b.open),
        high: Number(b.high),
        low: Number(b.low),
        close: Number(b.close),
      })),
    );
    s.highN.setData(points(data.high_n));
    s.sma50.setData(points(data.sma50));
    s.sma200.setData(points(data.sma200));

    if (priceLines.current?.owner === s.candles) {
      for (const pl of priceLines.current.lines) s.candles.removePriceLine(pl);
    }
    const lines = data.tier_prices
      .filter((t) => t.trigger_price !== null)
      .map((t) =>
        s.candles.createPriceLine({
          price: Number(t.trigger_price),
          color: t.filled ? C.tierFilled : C.tier,
          lineWidth: t.filled ? 2 : 1,
          lineStyle: t.filled ? LineStyle.Solid : LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${tierLabel(t.index)} -${fmtNum(t.drop_pct, 2)}%${t.filled ? " filled" : ""}`,
        }),
      );
    priceLines.current = { owner: s.candles, lines };

    const markers: SeriesMarker<Time>[] = [...data.fills]
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((f) => ({
        time: f.time as Time,
        position: "belowBar",
        color: C.fill,
        shape: "arrowUp",
        text: `${tierLabel(f.tier)} ${fmtNum(f.qty)} @ ${fmtPrice(f.price)}`,
      }));
    s.candles.setMarkers(markers);
    s.chart.timeScale().fitContent();
  }, [s, data]);

  return (
    <div className="grid grid-cols-1 gap-2">
      <div ref={container} className="h-[320px] w-full sm:h-[420px]" />
      <Legend
        items={[
          { label: `${lookbackDays ?? "N"}-day high`, color: C.highN, dashed: true },
          { label: "SMA50", color: C.sma50 },
          { label: "SMA200", color: C.sma200 },
          { label: "Tier trigger", color: C.tier, dashed: true },
          { label: "Tier filled", color: C.tierFilled },
          { label: "Fill ▲", color: C.fill },
        ]}
      />
    </div>
  );
}
