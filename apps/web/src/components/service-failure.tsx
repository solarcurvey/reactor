"use client";

import { Button } from "./ui/button";
import { FAILURE_COPY, type QaInjectKind } from "@/lib/qa-inject";

export function ServiceFailure({
  kind,
  detail,
  onRetry,
}: {
  kind: QaInjectKind;
  detail?: string;
  onRetry?: () => void;
}) {
  const copy = FAILURE_COPY[kind];
  return (
    <div
      role="alert"
      data-testid={`failure-${kind}`}
      className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4"
    >
      <h2 className="text-sm font-semibold text-red-50">{copy.title}</h2>
      <p className="mt-1 text-sm text-red-100/90">{copy.body}</p>
      {detail ? <p className="mt-2 font-mono text-[11px] text-red-200/80">{detail}</p> : null}
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
