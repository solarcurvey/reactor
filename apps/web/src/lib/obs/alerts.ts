import { isUserRejection } from "./wallet-errors";
import type { FailureKind } from "./kinds";

/** Operator-pageable outage classes (issue #39 AC). */
export const OUTAGE_CLASSES = [
  "render",
  "api",
  "rpc",
  "quote",
  "sse",
  "simulation",
] as const;

export type OutageClass = (typeof OUTAGE_CLASSES)[number];

export type AlertThreshold = {
  /** Failures of this class inside the window that trigger a page. */
  count: number;
  windowMs: number;
  /** Consecutive failures (same class) that also page, even inside a quieter window. */
  consecutive: number;
};

/**
 * Default paging thresholds. Encode the runbook: page on clustered outages,
 * never on a single wallet 4001 or a lone quote miss.
 */
export const ALERT_THRESHOLDS: Record<OutageClass, AlertThreshold> = {
  render: { count: 3, windowMs: 5 * 60_000, consecutive: 2 },
  api: { count: 5, windowMs: 2 * 60_000, consecutive: 3 },
  rpc: { count: 5, windowMs: 2 * 60_000, consecutive: 3 },
  quote: { count: 8, windowMs: 2 * 60_000, consecutive: 5 },
  sse: { count: 4, windowMs: 3 * 60_000, consecutive: 3 },
  simulation: { count: 5, windowMs: 2 * 60_000, consecutive: 3 },
};

export function kindToOutageClass(kind: FailureKind): OutageClass | null {
  switch (kind) {
    case "ui":
      return "render";
    case "api":
      return "api";
    case "rpc":
      return "rpc";
    case "quote":
      return "quote";
    case "sse":
      return "sse";
    case "simulation":
      return "simulation";
    default:
      return null;
  }
}

export type PagingDecision = {
  page: boolean;
  reason: string;
  outageClass: OutageClass | null;
  suppressedUserRejection: boolean;
};

export type FailureSample = {
  kind: FailureKind;
  at: number;
  err?: unknown;
  /** Explicit override from the reporter (e.g. wallet connect). */
  page?: boolean;
};

/**
 * Decide whether this failure should page on-call.
 * Expected wallet 4001 is always suppressed.
 */
export function shouldPageOperator(
  sample: FailureSample,
  recent: FailureSample[] = [],
  now = sample.at,
): PagingDecision {
  if (sample.page === false) {
    return {
      page: false,
      reason: "reporter-suppressed",
      outageClass: kindToOutageClass(sample.kind),
      suppressedUserRejection: isUserRejection(sample.err),
    };
  }
  if (isUserRejection(sample.err)) {
    return {
      page: false,
      reason: "wallet-4001-user-rejection",
      outageClass: null,
      suppressedUserRejection: true,
    };
  }
  const outageClass = kindToOutageClass(sample.kind);
  if (!outageClass) {
    return {
      page: false,
      reason: "not-an-outage-class",
      outageClass: null,
      suppressedUserRejection: false,
    };
  }
  const threshold = ALERT_THRESHOLDS[outageClass];
  const windowStart = now - threshold.windowMs;
  const inWindow = [sample, ...recent].filter((s) => {
    if (s.at < windowStart) return false;
    if (isUserRejection(s.err) || s.page === false) return false;
    return kindToOutageClass(s.kind) === outageClass;
  });
  if (inWindow.length >= threshold.count) {
    return {
      page: true,
      reason: `${outageClass}-count-${inWindow.length}-gte-${threshold.count}`,
      outageClass,
      suppressedUserRejection: false,
    };
  }
  let consecutive = 0;
  const chronological = [sample, ...recent]
    .filter((s) => !isUserRejection(s.err) && s.page !== false)
    .sort((a, b) => b.at - a.at);
  for (const s of chronological) {
    if (kindToOutageClass(s.kind) !== outageClass) break;
    consecutive += 1;
  }
  if (consecutive >= threshold.consecutive) {
    return {
      page: true,
      reason: `${outageClass}-consecutive-${consecutive}-gte-${threshold.consecutive}`,
      outageClass,
      suppressedUserRejection: false,
    };
  }
  return {
    page: false,
    reason: `${outageClass}-below-threshold`,
    outageClass,
    suppressedUserRejection: false,
  };
}
