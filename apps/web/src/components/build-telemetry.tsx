"use client";

import { useEffect } from "react";
import {
  reportReleaseOnce,
  releaseInfo,
  reportFailure,
  isUserRejection,
  shouldPageOperator,
} from "@/lib/obs";
import { WebVitalsCollector } from "./web-vitals";

function reviewFixturesEnabled(): boolean {
  return process.env.NEXT_PUBLIC_REVIEW_FIXTURES === "1";
}

/** One boot event per tab + document markers so operators can match a live SHA + chain. */
export function BuildTelemetry() {
  useEffect(() => {
    const rel = releaseInfo();
    try {
      const w = window as unknown as {
        __REACTOR_RELEASE__?: string;
        __REACTOR_OBS__?: {
          reportFailure: typeof reportFailure;
          isUserRejection: typeof isUserRejection;
          shouldPageOperator: typeof shouldPageOperator;
        };
      };
      w.__REACTOR_RELEASE__ = rel.release;
      document.documentElement.dataset.release = rel.release;
      document.documentElement.dataset.buildSha = rel.buildSha;
      document.documentElement.dataset.reactorEnv = rel.reactorEnv;
      document.documentElement.dataset.chainId = String(rel.chainId);
      document.documentElement.dataset.chainName = rel.chainName;
      if (rel.buildTimestamp) document.documentElement.dataset.buildTime = rel.buildTimestamp;
      if (reviewFixturesEnabled()) {
        w.__REACTOR_OBS__ = { reportFailure, isUserRejection, shouldPageOperator };
      }
    } catch {
      /* ignore */
    }
    reportReleaseOnce();
  }, []);
  return <WebVitalsCollector />;
}
