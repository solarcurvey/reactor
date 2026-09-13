"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { captureMessage, startWebVitals } from "@/lib/obs";

/** Core-page Web Vitals → kind `perf`. First-party PerformanceObserver. Rebinds on route. */
export function WebVitalsCollector() {
  const pathname = usePathname() || "/";
  useEffect(() => {
    return startWebVitals((sample) => {
      captureMessage("perf", `${sample.name} ${sample.value}`, {
        vital: sample.name,
        value: sample.value,
        rating: sample.rating,
        overBudget: sample.overBudget,
        route: sample.route,
        page: false,
      });
    });
  }, [pathname]);
  return null;
}
