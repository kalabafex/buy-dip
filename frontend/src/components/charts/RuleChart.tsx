import { LineStyle, type IChartApi, type ISeriesApi, type SeriesMarker, type Time } from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";
import type { Schemas } from "@/api/client";
import { Legend } from "@/components/charts/Legend";
import type { ChartColors } from "@/components/charts/theme";
import { useChart, useCrosshairTime } from "@/components/charts/useChart";
import { fmtDay, fmtNum, fmtPct, fmtPrice, tierLabel } from "@/lib/format";

type Series = {
  chart: IChartApi;
  colors: ChartColors;
  candles: ISeriesApi<"Candlestick">;
  highN: ISeriesApi<"Line">;
  sma50: ISeriesApi<"Line">;
  sma200: ISeriesApi<"Line">;
};

const line = {
  lineWidth: 2,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
} as const;

function setup(chart: IChartApi, c: ChartColors): Series {
  return {
    chart,
    colors: c,
    candles: chart.addCandlestickSeries({
      upColor: c.up,
      downColor: c.down,
      borderUpColor: c.up,
      borderDownColor: c.down,
      wickUpColor: c.up,
      wickDownColor: c.down,
    }),
    highN: chart.addLineSeries({ ...line, color: c.series2, lineStyle: LineStyle.Dotted }),
    sma50: chart.addLineSeries({ ...line, color: c.series1 }),
    sma200: chart.addLineSeries({ ...line, color: c.series3 }),
  };
}

const points = (pts: Schemas["ChartPoint"][]) =>
  pts.map((p) => ({ time: p.time as Time, value: Number(p.value) }));

/** Candlesticks + N-day high / SMA50 / SMA200, tier trigger price lines and fill markers. */
export function RuleChart({ data, lookbackDays }: { data: Schemas["ChartOut"]; lookbackDays?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const s = useChart(container, setup);

  useEffect(() => {
    if (!s) return;
    const { candles, colors: c } = s;
    candles.setData(
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

    const lines = data.tier_prices
      .filter((t) => t.trigger_price !== null)
      .map((t) =>
        candles.createPriceLine({
          price: Number(t.trigger_price),
          color: t.filled ? c.good : c.text,
          lineWidth: 1,
          lineStyle: t.filled ? LineStyle.Solid : LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${tierLabel(t.index)} −${fmtNum(t.drop_pct, 2)}%${t.filled ? " filled" : ""}`,
        }),
      );

    const markers: SeriesMarker<Time>[] = [...data.fills]
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((f) => ({
        time: f.time as Time,
        position: "belowBar",
        color: c.ink,
        shape: "arrowUp",
        text: tierLabel(f.tier),
      }));
    candles.setMarkers(markers);
    s.chart.timeScale().fitContent();
    return () => {
      for (const pl of lines) candles.removePriceLine(pl);
    };
  }, [s, data]);

  const hovered = useCrosshairTime(s?.chart);
  const lookup = useMemo(() => {
    const m = (pts: Schemas["ChartPoint"][]) => new Map(pts.map((p) => [p.time, p.value]));
    return {
      bars: new Map(data.bars.map((b) => [b.time, b])),
      high: m(data.high_n),
      sma50: m(data.sma50),
      sma200: m(data.sma200),
    };
  }, [data]);
  const lastBar = data.bars[data.bars.length - 1];
  const t = typeof hovered === "string" ? hovered : lastBar?.time;
  const bar = t ? lookup.bars.get(t) : undefined;
  const prevClose = useMemo(() => {
    if (!t) return null;
    const i = data.bars.findIndex((b) => b.time === t);
    return i > 0 ? Number(data.bars[i - 1]!.close) : null;
  }, [data.bars, t]);
  const change = bar && prevClose ? ((Number(bar.close) - prevClose) / prevClose) * 100 : null;
  const c = s?.colors;

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="num flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t ? fmtDay(t) : "—"}</span>
        {bar && (
          <>
            <span>
              O <span className="text-foreground">{fmtPrice(bar.open)}</span>
            </span>
            <span>
              H <span className="text-foreground">{fmtPrice(bar.high)}</span>
            </span>
            <span>
              L <span className="text-foreground">{fmtPrice(bar.low)}</span>
            </span>
            <span>
              C <span className="font-semibold text-foreground">{fmtPrice(bar.close)}</span>
            </span>
            {change !== null && (
              <span className={change >= 0 ? "text-gain" : "text-loss"}>{fmtPct(change, 2, true)}</span>
            )}
          </>
        )}
      </div>
      <div ref={container} className="h-[300px] w-full sm:h-[420px]" />
      <Legend
        items={[
          {
            label: `${lookbackDays ?? "N"}-day high`,
            color: c?.series2 ?? "currentColor",
            dashed: true,
            value: t ? fmtPrice(lookup.high.get(t)) : undefined,
          },
          {
            label: "SMA50",
            color: c?.series1 ?? "currentColor",
            value: t ? fmtPrice(lookup.sma50.get(t)) : undefined,
          },
          {
            label: "SMA200",
            color: c?.series3 ?? "currentColor",
            value: t ? fmtPrice(lookup.sma200.get(t)) : undefined,
          },
          { label: "Tier trigger", color: c?.text ?? "currentColor", dashed: true },
          { label: "Tier filled", color: c?.good ?? "currentColor" },
          { label: "Fill", color: c?.ink ?? "currentColor", marker: "arrow" },
        ]}
      />
    </div>
  );
}
