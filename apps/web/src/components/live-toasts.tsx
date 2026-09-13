"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { explorerTx } from "@/lib/utils";
import { REVIEW_FIXTURES } from "@/lib/review-fixtures";
import { subscribeReactorStream } from "@/lib/sse";
import {
  clockExpired,
  createToastClock,
  ingestLiveEvent,
  LIVE_TOAST_MS,
  markSeen,
  pauseToastClock,
  prefersReducedMotion,
  pushVisibleToast,
  resumeToastClock,
  toastFromLiveEvent,
  type LiveToast,
  type ToastClock,
} from "@/lib/live-toasts";
import { useQaInject, useQaState } from "./qa-inject-provider";
import { FAILURE_COPY } from "@/lib/qa-inject";

const DEMO_CORE_TX = `0x${"ab".repeat(32)}`;
const DEMO_TOP_TX = `0x${"cd".repeat(32)}`;
const DEMO_CHAIN = 5042002;

function demoToasts(which: string): LiveToast[] {
  const rows: LiveToast[] = [];
  if (which === "core" || which === "both") {
    const t = toastFromLiveEvent({
      type: "core",
      data: {
        name: "BuybackExecuted",
        eventKind: "BuybackExecuted",
        tx: DEMO_CORE_TX,
        chainId: DEMO_CHAIN,
        logIndex: 1,
        quoteIn: "2500000",
        coreOut: "1000000000000000000",
        confirmed: true,
      },
    });
    if (t) rows.push(t);
  }
  if (which === "top10" || which === "both") {
    const t = toastFromLiveEvent({
      type: "burn",
      data: {
        name: "Top10Buy",
        eventKind: "Top10Buy",
        tx: DEMO_TOP_TX,
        token: `0x${"11".repeat(20)}`,
        chainId: DEMO_CHAIN,
        logIndex: 2,
        amount: "4000000",
        burned: "2000000000000000000",
        confirmed: true,
      },
    });
    if (t) rows.push(t);
  }
  return rows;
}

type QaToast = { id: string; tone: "status" | "alert"; title: string; body?: string };

export function LiveToasts() {
  const clocksRef = useRef(new Map<string, ToastClock>());
  const holdRef = useRef(false);
  const ttlRef = useRef(LIVE_TOAST_MS);
  const [toasts, setToasts] = useState<LiveToast[]>([]);
  const [qaToasts, setQaToasts] = useState<QaToast[]>([]);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const inject = useQaInject();
  const state = useQaState();

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(prefersReducedMotion(mq));
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!REVIEW_FIXTURES) return;
    const q = new URLSearchParams(window.location.search);
    const ms = Number(q.get("toastMs") ?? 0);
    if (Number.isFinite(ms) && ms > 0) ttlRef.current = ms;
    const which = q.get("demoToast");
    if (!which) return;
    const seeded = demoToasts(which);
    if (!seeded.length) return;
    holdRef.current = q.get("toastMs") == null;
    const now = Date.now();
    for (const t of seeded) {
      clocksRef.current.set(t.id, createToastClock(now, ttlRef.current));
    }
    setToasts((rows) => {
      let next = rows;
      for (const t of seeded) {
        markSeen(t.id);
        next = pushVisibleToast(next, t);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const next: QaToast[] = [];
    if (state === "toast") {
      next.push({
        id: "qa-live-toast",
        tone: "status",
        title: "CORE buy+burn",
        body: "Keeper confirmed a fee-exempt CORE burn. 0.5% pot — not Instant.",
      });
    }
    if (inject === "sse") {
      next.push({ id: "sse-disconnect", tone: "alert", title: FAILURE_COPY.sse.title, body: FAILURE_COPY.sse.body });
      next.push({
        id: "sse-reconnect",
        tone: "status",
        title: "Live feed reconnected",
        body: "Same event id — no duplicate toast.",
      });
    }
    setQaToasts(next);
  }, [inject, state]);

  useEffect(() => {
    if (inject === "sse") return;
    return subscribeReactorStream((ev) => {
      const toast = ingestLiveEvent(ev);
      if (!toast) return;
      clocksRef.current.set(toast.id, createToastClock(Date.now(), ttlRef.current));
      setToasts((rows) => pushVisibleToast(rows, toast));
    });
  }, [inject]);

  useEffect(() => {
    const now = Date.now();
    const clocks = clocksRef.current;
    for (const [id, clock] of clocks) {
      clocks.set(id, paused ? pauseToastClock(clock, now) : resumeToastClock(clock, now));
    }
  }, [paused]);

  useEffect(() => {
    if (toasts.length === 0 || holdRef.current) return;
    const tick = () => {
      const now = Date.now();
      const dead = toasts.filter((t) => {
        const clock = clocksRef.current.get(t.id);
        return clock ? clockExpired(clock, now) : false;
      });
      if (dead.length === 0) return;
      setToasts((rows) => rows.filter((row) => !dead.some((d) => d.id === row.id)));
    };
    const id = window.setInterval(tick, 200);
    tick();
    return () => window.clearInterval(id);
  }, [toasts, paused]);

  if (toasts.length === 0 && qaToasts.length === 0) return null;

  return (
    <div
      data-testid="live-toast-stack"
      data-paused={paused ? "1" : "0"}
      data-reduced-motion={reduced ? "1" : "0"}
      data-safe-area="1"
      tabIndex={-1}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(ev) => {
        if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setPaused(false);
      }}
      className={`pointer-events-none fixed z-50 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2 ${
        reduced ? "" : "live-toast-motion"
      }`}
      style={{
        bottom: "max(1rem, env(safe-area-inset-bottom, 0px))",
        right: "max(1rem, env(safe-area-inset-right, 0px))",
      }}
      aria-live="polite"
      aria-relevant="additions"
    >
      {qaToasts.map((t) => (
        <div
          key={t.id}
          data-testid={`toast-${t.id}`}
          role={t.tone === "alert" ? "alert" : "status"}
          aria-live={t.tone === "alert" ? "assertive" : "polite"}
          className={`pointer-events-auto rounded-xl border px-3 py-2 text-[13px] ${
            t.tone === "alert"
              ? "border-red-500/30 bg-red-500/10 text-red-50"
              : "border-cyan-300/25 bg-cyan-300/10 text-cyan-50"
          }`}
        >
          <p className="font-medium">{t.title}</p>
          {t.body ? <p className="mt-0.5 text-[12px] text-current/80">{t.body}</p> : null}
        </div>
      ))}
      {toasts.map((t) => (
        <article
          key={t.id}
          data-testid="live-toast"
          data-kind={t.kind}
          data-identity={t.id}
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
              className="rounded-full px-1.5 text-[14px] text-zinc-400 hover:text-white"
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

/** Layout wrapper so QA inject is in the same tree as the #43 toast stack. */
export function LiveToastProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <LiveToasts />
    </>
  );
}
