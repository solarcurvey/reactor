"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";

type Candle = { t: number; o: string; h: string; l: string; c: string; n: number };

export function OhlcvChart({ candles }: { candles: Candle[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let disposed = false;
    let chart: IChartApi | undefined;
    (async () => {
      const lc = await import("lightweight-charts");
      if (disposed || !ref.current) return;
      const created = lc.createChart(ref.current, {
        height: 320,
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: "#9aa4ad" },
        grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false },
      });
      chart = created;
      const series = created.addSeries(lc.CandlestickSeries, {
        upColor: "#3dcc8a",
        downColor: "#e85d4c",
        borderVisible: false,
        wickUpColor: "#3dcc8a",
        wickDownColor: "#e85d4c",
      });
      series.setData(
        candles
          .map((c) => ({
            time: c.t as UTCTimestamp,
            open: Number(c.o) / 1e18,
            high: Number(c.h) / 1e18,
            low: Number(c.l) / 1e18,
            close: Number(c.c) / 1e18,
          }))
          .filter((c) => c.close > 0),
      );
    })();
    return () => {
      disposed = true;
      chart?.remove();
    };
  }, [candles]);
  return <div ref={ref} className="h-72 w-full sm:h-80" />;
}
