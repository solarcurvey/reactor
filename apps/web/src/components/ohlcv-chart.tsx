"use client";

import { useEffect, useRef } from "react";

type Candle = { t: number; o: string; h: string; l: string; c: string; n: number };

export function OhlcvChart({ candles }: { candles: Candle[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let disposed = false;
    let chart: { remove: () => void } | undefined;
    (async () => {
      const lc = await import("lightweight-charts");
      if (disposed || !ref.current) return;
      chart = lc.createChart(ref.current, {
        height: 320,
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: "#a1a1aa" },
        grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false },
      });
      const series = chart.addSeries(lc.CandlestickSeries, {
        upColor: "#7ee8ff",
        downColor: "#f43f5e",
        borderVisible: false,
        wickUpColor: "#7ee8ff",
        wickDownColor: "#f43f5e",
      });
      series.setData(
        candles
          .map((c) => ({
            time: c.t as number,
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
