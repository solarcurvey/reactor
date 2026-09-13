"use client";

import { useEffect, useState } from "react";
import { useIndexerHealth } from "@/lib/hooks";

export type SurfaceKind = "loading" | "empty" | "error" | "offline";

export function useBrowserOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}

export function useSurfaceFlags(opts: {
  isLoading?: boolean;
  isError?: boolean;
  empty?: boolean;
  error?: unknown;
}) {
  const online = useBrowserOnline();
  const health = useIndexerHealth();
  const indexerDown = health.data ? health.data.ok === false : false;
  const queryOffline = opts.error instanceof Error && Boolean((opts.error as Error & { offline?: boolean }).offline);
  const offline = !online || queryOffline;
  return {
    online,
    indexerDown,
    offline,
    kind: (!online || queryOffline
      ? "offline"
      : opts.isLoading
        ? "loading"
        : opts.isError
          ? "error"
          : opts.empty
            ? "empty"
            : null) as SurfaceKind | null,
  };
}

export function SurfaceState({
  kind,
  title,
  body,
  onRetry,
  testId,
}: {
  kind: SurfaceKind;
  title?: string;
  body?: string;
  onRetry?: () => void;
  testId?: string;
}) {
  if (kind === "loading") {
    return (
      <div className="mt-6 space-y-3" aria-busy="true" data-state="loading" data-testid={testId}>
        <p className="text-sm text-zinc-400">{title ?? "Loading…"}</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-[4px] border border-white/6 bg-white/[0.04]" />
          ))}
        </div>
      </div>
    );
  }

  const palette =
    kind === "error"
      ? "border-red-500/30 bg-red-500/10 text-red-50"
      : kind === "offline"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-50"
        : "border-white/10 bg-white/[0.03] text-zinc-200";

  return (
    <div className={`mt-6 rounded-[4px] border px-4 py-6 ${palette}`} data-state={kind} data-testid={testId}>
      <p className="text-[11px] uppercase tracking-[0.22em] opacity-70">{kind}</p>
      <h2 className="mt-1 text-lg font-medium">{title ?? defaultTitle(kind)}</h2>
      <p className="mt-1 max-w-xl text-[13px] opacity-80">{body ?? defaultBody(kind)}</p>
      {onRetry && kind !== "empty" ? (
        <button type="button" className="mt-3 text-[13px] underline" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

function defaultTitle(kind: SurfaceKind): string {
  if (kind === "offline") return "You’re offline";
  if (kind === "error") return "This surface failed";
  return "Nothing here yet";
}

function defaultBody(kind: SurfaceKind): string {
  if (kind === "offline") return "The browser or the indexer is unreachable. Onchain truth is unchanged — reconnect to resume the board.";
  if (kind === "error") return "The indexer or chain read failed. Retry. Do not invent ranks, marks, or fees.";
  return "No rows match this query. Launch a market or clear the search.";
}
