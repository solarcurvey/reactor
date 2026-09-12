"use client";

import { useEffect, useRef, useState } from "react";
import { explorerTx } from "@/lib/utils";
import { subscribeReactorStream } from "@/lib/sse";
import {
  isLiveAfterHead,
  LIVE_TOAST_MS,
  mergeLiveToasts,
  toastFromLiveEvent,
  type LiveToast,
} from "@/lib/live-toasts";

export function LiveToasts() {
  const headRef = useRef<number | null>(null);
  const [toasts, setToasts] = useState<LiveToast[]>([]);

  useEffect(() => {
    return subscribeReactorStream((ev) => {
      if (ev.type === "hello") {
        const next = Number(ev.data.head ?? ev.data.last ?? 0);
        headRef.current = Number.isFinite(next) ? next : 0;
        return;
      }
      if (ev.type === "error") return;
      const head = headRef.current;
      if (head == null || !isLiveAfterHead(ev.id, head)) return;
      const toast = toastFromLiveEvent(ev);
      if (toast) setToasts((rows) => mergeLiveToasts(rows, toast));
    });
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      window.setTimeout(() => {
        setToasts((rows) => rows.filter((row) => row.id !== t.id));
      }, LIVE_TOAST_MS),
    );
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div
      data-testid="live-toast-stack"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2"
      aria-live="polite"
      aria-relevant="additions"
    >
      {toasts.map((t) => (
        <article
          key={t.id}
          data-testid="live-toast"
          data-kind={t.kind}
          role="status"
          className="pointer-events-auto rounded-2xl border border-cyan-300/25 bg-[#121418]/95 px-3.5 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-md"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-200/80">
                {t.kind === "core" ? "CORE" : "Top-10"} · confirmed
              </p>
              <h2 className="mt-0.5 text-[13px] font-medium text-white">{t.title}</h2>
              <p className="mt-0.5 text-[12px] leading-4 text-zinc-400">{t.body}</p>
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              className="rounded-full px-1.5 text-[14px] text-zinc-500 hover:text-white"
              onClick={() => setToasts((rows) => rows.filter((row) => row.id !== t.id))}
            >
              ×
            </button>
          </div>
          <a
            href={explorerTx(t.tx)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-[11px] uppercase tracking-wider text-cyan-200 hover:underline"
          >
            View tx
          </a>
        </article>
      ))}
    </div>
  );
}
