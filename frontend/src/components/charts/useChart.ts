import { createChart, type IChartApi } from "lightweight-charts";
import { useEffect, useRef, useState, type RefObject } from "react";
import { chartTheme, safeLocale } from "@/components/charts/theme";
import { useDarkMode } from "@/lib/hooks";

/**
 * Creates a lightweight-charts instance in `container` (auto-resized with the container
 * via ResizeObserver), follows the color scheme, and disposes it on unmount.
 * `setup` runs once after creation to add series; its return value is kept in state.
 */
export function useChart<T>(
  container: RefObject<HTMLDivElement | null>,
  setup: (chart: IChartApi) => T,
): T | null {
  const dark = useDarkMode();
  const [state, setState] = useState<T | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const setupRef = useRef(setup);
  const darkRef = useRef(dark);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const chart = createChart(el, {
      ...chartTheme(darkRef.current),
      autoSize: true,
      localization: { locale: safeLocale() },
      crosshair: { mode: 0 },
      timeScale: { ...chartTheme(darkRef.current).timeScale, rightOffset: 3 },
    });
    chartRef.current = chart;
    setState(setupRef.current(chart));
    return () => {
      chartRef.current = null;
      setState(null);
      chart.remove();
    };
  }, [container]);

  useEffect(() => {
    darkRef.current = dark;
    chartRef.current?.applyOptions(chartTheme(dark));
  }, [dark]);

  return state;
}
