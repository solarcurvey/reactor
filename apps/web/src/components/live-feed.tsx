import type { LiveEvent } from "@/lib/sse";

export function LiveFeed({ last, ok }: { last: LiveEvent | null; ok: boolean }) {
  return (
    <p className="text-[11px] tabular-nums text-zinc-400" aria-live="polite">
      <span className={ok ? "text-rx-ember" : "text-zinc-400"}>{ok ? "live" : "polling"}</span>
      {last ? (
        <span className="ml-2 text-zinc-400">
          {last.type}
          {typeof last.data.symbol === "string" ? ` · $${last.data.symbol}` : ""}
          {typeof last.data.token === "string" ? ` · ${String(last.data.token).slice(0, 8)}` : ""}
        </span>
      ) : (
        <span className="ml-2">SSE /health fallback — not RPC-polled tables</span>
      )}
    </p>
  );
}
