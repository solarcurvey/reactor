"use client";

import { useEffect, useState } from "react";
import { INDEXER_URL } from "./chain";

export type LiveEvent = { type: string; data: Record<string, unknown> };

export function useReactorStream() {
  const [last, setLast] = useState<LiveEvent | null>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | undefined;
    const on = (type: string) => (ev: MessageEvent) => {
      try {
        setLast({ type, data: JSON.parse(String(ev.data)) });
        setOk(true);
      } catch {
        /* ignore */
      }
    };
    try {
      es = new EventSource(`${INDEXER_URL}/stream`);
      for (const t of ["trade", "launch", "bonding", "graduation", "rewards", "burn", "top10", "core", "hello"]) {
        es.addEventListener(t, on(t));
      }
      es.onerror = () => {
        setOk(false);
        es?.close();
        es = null;
        poll = setInterval(async () => {
          const res = await fetch(`${INDEXER_URL}/health`).catch(() => null);
          if (res?.ok) setOk(true);
        }, 8_000);
      };
    } catch {
      setOk(false);
    }
    return () => {
      es?.close();
      if (poll) clearInterval(poll);
    };
  }, []);
  return { last, ok };
}
