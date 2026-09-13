"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "./ui/button";
import { formatSupportRef, reportFailure, shortSha, releaseInfo, type TelemetryEvent } from "@/lib/obs";

export function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const [event, setEvent] = useState<TelemetryEvent | null>(null);
  useEffect(() => {
    setEvent(reportFailure("ui", error, { route: pathname, digest: error.digest, boundary: "route" }));
  }, [error, pathname]);

  const rel = releaseInfo();
  return (
    <div className="mx-auto max-w-lg py-16">
      <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/80">This route failed</p>
      <h1 className="mt-2 text-2xl font-semibold text-white">Something broke on this page</h1>
      <p className="mt-3 text-sm text-zinc-400">
        Trading, quotes, and wallet state on other routes are unchanged. Economics are not affected. This screen is an
        error boundary — not a protocol pause.
      </p>
      <p className="mt-3 font-mono text-[12px] text-zinc-500">
        {pathname} · {rel.release} · {shortSha()}
        {error.digest ? ` · digest ${error.digest}` : ""}
        {event ? ` · ${formatSupportRef(event)}` : ""}
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={() => reset()}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href="/">Discover</Link>
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/docs">Docs</Link>
        </Button>
      </div>
    </div>
  );
}

export function AppErrorFallback({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [event, setEvent] = useState<TelemetryEvent | null>(null);
  useEffect(() => {
    setEvent(reportFailure("ui", error, { digest: error.digest, boundary: "app" }));
  }, [error]);
  const rel = releaseInfo();
  return (
    <div className="mx-auto max-w-lg py-20">
      <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/80">Application error</p>
      <h1 className="mt-2 text-2xl font-semibold text-white">REACTOR could not render this view</h1>
      <p className="mt-3 text-sm text-zinc-400">
        No funds moved. Retry or return to Discover. Release {rel.release}.
      </p>
      {event ? <p className="mt-2 font-mono text-[12px] text-zinc-500">{formatSupportRef(event)}</p> : null}
      <div className="mt-6 flex gap-2">
        <Button onClick={() => reset()}>Reload view</Button>
        <Button variant="outline" asChild>
          <Link href="/">Home</Link>
        </Button>
      </div>
    </div>
  );
}
