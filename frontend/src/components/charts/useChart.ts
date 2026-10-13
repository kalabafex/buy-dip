import { createChart, type IChartApi, type MouseEventParams, type Time } from "lightweight-charts";
import { useEffect, useRef, useState, type RefObject } from "react";
import { chartColors, chartOptions, type ChartColors } from "@/components/charts/theme";
import { useDarkMode } from "@/lib/hooks";

/**
 * Creates a lightweight-charts instance in `container` (auto-sized), rebuilt when the theme
 * changes so every series picks up the mode's colors, and disposed on unmount.
 * `setup` adds series; its return value is kept in state (null until created).
 */
export function useChart<T>(
  container: RefObject<HTMLDivElement | null>,
  setup: (chart: IChartApi, colors: ChartColors) => T,
  { interactive = true }: { interactive?: boolean } = {},
): T | null {
  const dark = useDarkMode();
  const [state, setState] = useState<T | null>(null);
  const setupRef = useRef(setup);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const colors = chartColors(dark);
    const chart = createChart(el, { ...chartOptions(colors, interactive), autoSize: true });
    setState(setupRef.current(chart, colors));
    // Keep the whole series in view when the container changes size (autoSize alone keeps
    // the bar spacing, which crops the right edge if data arrived before layout settled).
    let lastWidth = 0;
    let disposed = false;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry?.contentRect.width ?? 0);
      if (w && w !== lastWidth) {
        lastWidth = w;
        requestAnimationFrame(() => !disposed && chart.timeScale().fitContent());
      }
    });
    ro.observe(el);
    return () => {
      disposed = true;
      ro.disconnect();
      setState(null);
      chart.remove();
    };
  }, [container, dark, interactive]);

  return state;
}

/** Time under the crosshair (null when the pointer leaves the plot). */
export function useCrosshairTime(chart: IChartApi | null | undefined): Time | null {
  const [time, setTime] = useState<Time | null>(null);
  useEffect(() => {
    if (!chart) return;
    const on = (p: MouseEventParams<Time>) => setTime(p.time ?? null);
    chart.subscribeCrosshairMove(on);
    return () => chart.unsubscribeCrosshairMove(on);
  }, [chart]);
  return time;
}
