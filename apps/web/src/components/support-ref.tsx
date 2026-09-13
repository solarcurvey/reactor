"use client";

import { formatSupportRef, type TelemetryEvent } from "@/lib/obs";

export function SupportRef({ event }: { event: TelemetryEvent | null | undefined }) {
  if (!event) return null;
  return <p className="mt-1 font-mono text-[11px] text-zinc-500">{formatSupportRef(event)}</p>;
}
