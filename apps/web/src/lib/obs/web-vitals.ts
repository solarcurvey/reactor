/** First-party Web Vitals (no npm web-vitals). Core-page collection only. */

export const WEB_VITAL_BUDGETS = {
  LCP: 2500,
  INP: 200,
  CLS: 0.1,
  FCP: 1800,
  TTFB: 800,
} as const;

export type VitalName = keyof typeof WEB_VITAL_BUDGETS;

export const CORE_PERF_PAGES = ["/", "/trade", "/launch", "/reactor", "/core"] as const;

export function isCorePerfPage(path: string): boolean {
  const p = path.split("?")[0] ?? path;
  if ((CORE_PERF_PAGES as readonly string[]).includes(p)) return true;
  return p.startsWith("/token/");
}

export type VitalRating = "good" | "needs-improvement" | "poor";

export function ratingFor(name: VitalName, value: number): VitalRating {
  const budget = WEB_VITAL_BUDGETS[name];
  if (name === "CLS") {
    if (value <= 0.1) return "good";
    if (value <= 0.25) return "needs-improvement";
    return "poor";
  }
  if (value <= budget) return "good";
  if (value <= budget * 1.6) return "needs-improvement";
  return "poor";
}

export function overBudget(name: VitalName, value: number): boolean {
  return value > WEB_VITAL_BUDGETS[name];
}

export type VitalSample = {
  name: VitalName;
  value: number;
  rating: VitalRating;
  overBudget: boolean;
  route: string;
  navigationType?: string;
};

export function buildVitalSample(name: VitalName, value: number, route: string, navigationType?: string): VitalSample {
  return {
    name,
    value: name === "CLS" ? Math.round(value * 1000) / 1000 : Math.round(value),
    rating: ratingFor(name, value),
    overBudget: overBudget(name, value),
    route,
    navigationType,
  };
}

export function ttfbFromNavigation(nav?: PerformanceNavigationTiming | null): number | null {
  if (!nav) return null;
  const v = nav.responseStart - nav.requestStart;
  return Number.isFinite(v) && v >= 0 ? v : null;
}

type VitalListener = (sample: VitalSample) => void;

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  try {
    return window.location.pathname || "/";
  } catch {
    return "/";
  }
}

/**
 * Observe LCP / INP / CLS / FCP / TTFB on core pages. Safe no-op without PerformanceObserver.
 * Dedupes per (name, route) until a worse value arrives (LCP/INP) or CLS accumulates.
 */
export function startWebVitals(onSample: VitalListener): () => void {
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") {
    return () => undefined;
  }
  const route = currentPath();
  if (!isCorePerfPage(route)) return () => undefined;

  const cleanups: Array<() => void> = [];
  const seen = new Map<VitalName, number>();

  const emit = (name: VitalName, value: number) => {
    if (!Number.isFinite(value) || value < 0) return;
    const prev = seen.get(name);
    if (name === "CLS") {
      seen.set(name, value);
    } else if (prev !== undefined && value <= prev) {
      return;
    } else {
      seen.set(name, value);
    }
    onSample(buildVitalSample(name, value, route));
  };

  const observe = (type: string, cb: (entry: PerformanceEntry) => void) => {
    try {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) cb(entry);
      });
      po.observe({ type, buffered: true } as PerformanceObserverInit);
      cleanups.push(() => {
        try {
          po.disconnect();
        } catch {
          /* ignore */
        }
      });
    } catch {
      /* unsupported */
    }
  };

  observe("largest-contentful-paint", (e) => {
    const v = "startTime" in e ? Number((e as PerformanceEntry).startTime) : 0;
    emit("LCP", v);
  });
  observe("first-contentful-paint", (e) => emit("FCP", e.startTime));
  observe("paint", (e) => {
    if (e.name === "first-contentful-paint") emit("FCP", e.startTime);
  });
  observe("event", (e) => {
    const dur = "duration" in e ? Number((e as PerformanceEntry).duration) : 0;
    if (dur > 0) emit("INP", dur);
  });
  let cls = 0;
  observe("layout-shift", (e) => {
    const ls = e as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
    if (ls.hadRecentInput) return;
    cls += Number(ls.value ?? 0);
    emit("CLS", cls);
  });

  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const ttfb = ttfbFromNavigation(nav);
    if (ttfb !== null) emit("TTFB", ttfb);
  } catch {
    /* ignore */
  }

  return () => {
    for (const c of cleanups) c();
  };
}
