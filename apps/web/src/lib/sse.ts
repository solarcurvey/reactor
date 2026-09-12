"use client";

import { useEffect, useState } from "react";
import { INDEXER_URL } from "./chain";
import { streamEndpoint } from "./live-toasts";

export type LiveEvent = { type: string; data: Record<string, unknown>; id?: number };

const STREAM_TYPES = ["trade", "launch", "bonding", "graduation", "rewards", "burn", "top10", "core", "hello"] as const;

type Listener = (ev: LiveEvent) => void;

let es: EventSource | null = null;
let refs = 0;
let lastEventId = 0;
const listeners = new Set<Listener>();
let healthPoll: ReturnType<typeof setInterval> | undefined;

function emit(ev: LiveEvent) {
  for (const fn of listeners) fn(ev);
}

function openStream() {
  if (es) return;
  try {
    es = new EventSource(streamEndpoint(INDEXER_URL, lastEventId));
    const on = (type: string) => (ev: MessageEvent) => {
      try {
        const data = JSON.parse(String(ev.data)) as Record<string, unknown>;
        const id = Number(ev.lastEventId || 0);
        if (Number.isFinite(id) && id > lastEventId) lastEventId = id;
        emit({ type, data, id: Number.isFinite(id) ? id : undefined });
      } catch {
        /* ignore */
      }
    };
    for (const t of STREAM_TYPES) es.addEventListener(t, on(t));
    es.onerror = () => {
      emit({ type: "error", data: { ok: false } });
      es?.close();
      es = null;
      if (healthPoll) clearInterval(healthPoll);
      const retryMs = Number((window as unknown as { __reactorSseRetryMs?: number }).__reactorSseRetryMs);
      healthPoll = setInterval(async () => {
        const res = await fetch(`${INDEXER_URL}/health`).catch(() => null);
        if (!res?.ok) return;
        if (healthPoll) {
          clearInterval(healthPoll);
          healthPoll = undefined;
        }
        if (refs > 0) openStream();
      }, Number.isFinite(retryMs) && retryMs > 0 ? retryMs : 8_000);
    };
  } catch {
    emit({ type: "error", data: { ok: false } });
  }
}

function closeStream() {
  es?.close();
  es = null;
  if (healthPoll) {
    clearInterval(healthPoll);
    healthPoll = undefined;
  }
}

export function subscribeReactorStream(fn: Listener): () => void {
  listeners.add(fn);
  refs += 1;
  openStream();
  return () => {
    listeners.delete(fn);
    refs -= 1;
    if (refs <= 0) {
      refs = 0;
      closeStream();
    }
  };
}

export function useReactorStream() {
  const [last, setLast] = useState<LiveEvent | null>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    return subscribeReactorStream((ev) => {
      if (ev.type === "error") {
        setOk(false);
        return;
      }
      if (ev.type === "hello") setOk(true);
      else if (ev.type !== "ping") setOk(true);
      setLast(ev);
    });
  }, []);
  return { last, ok };
}
