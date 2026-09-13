/** In-process ingest limiter for `POST /api/telemetry`. Not a global WAF. */

export const TELEMETRY_RATE_WINDOW_MS = 10_000;
export const TELEMETRY_RATE_MAX_PROD = 40;
export const TELEMETRY_RATE_MAX_REVIEW = 10_000;

const hits = new Map<string, number[]>();

export function telemetryRateMax(
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (env.NEXT_PUBLIC_REVIEW_FIXTURES === "1" || env.REACTOR_TELEMETRY_RELAXED === "1") {
    return TELEMETRY_RATE_MAX_REVIEW;
  }
  return TELEMETRY_RATE_MAX_PROD;
}

export function allowTelemetryIngest(
  ip: string,
  now = Date.now(),
  max = telemetryRateMax(),
): boolean {
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < TELEMETRY_RATE_WINDOW_MS);
  if (arr.length >= max) {
    hits.set(ip, arr);
    return false;
  }
  arr.push(now);
  hits.set(ip, arr);
  return true;
}

export function resetTelemetryIngestRateForTests(): void {
  hits.clear();
}
