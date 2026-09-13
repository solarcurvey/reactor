import { reportFailure } from "./telemetry";
import { classifyUrl, safePath, type FailureKind } from "./kinds";
import { newTraceId } from "./correlate";

export type ReactorFetchInit = RequestInit & {
  kind?: FailureKind;
  /** Report HTTP !ok (default true). */
  reportHttpError?: boolean;
  /** Correlation id sent as x-request-id and attached to failure events. */
  traceId?: string;
};

export async function reactorFetch(input: string | URL, init: ReactorFetchInit = {}): Promise<Response> {
  const { kind: kindOpt, reportHttpError, traceId: tidOpt, ...rest } = init;
  const url = String(input);
  const kind = kindOpt ?? classifyUrl(url);
  const path = safePath(url);
  const method = (rest.method ?? "GET").toUpperCase();
  const traceId = tidOpt ?? newTraceId();
  const headers = new Headers(rest.headers);
  if (!headers.has("x-request-id")) headers.set("x-request-id", traceId);
  try {
    const res = await fetch(input, { ...rest, headers });
    const responseId = res.headers.get("x-request-id") ?? traceId;
    if (!res.ok && reportHttpError !== false) {
      reportFailure(kind, new Error(`${method} ${path} ${res.status}`), {
        status: res.status,
        method,
        path,
        traceId: responseId,
      });
    }
    return res;
  } catch (err) {
    reportFailure(kind, err, { method, path, traceId });
    throw err;
  }
}

export async function reactorFetchCatch(input: string | URL, init: ReactorFetchInit = {}): Promise<Response | null> {
  try {
    return await reactorFetch(input, init);
  } catch {
    return null;
  }
}
