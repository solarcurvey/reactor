"use client";

import { notFound } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  WALLET_USER_REJECTED,
  formatSupportRef,
  reportFailure,
  type FailureKind,
  type TelemetryEvent,
} from "@/lib/obs";
import { anvilAccount0Pk, anvilMnemonic } from "@/lib/obs/inject-sentinels";

const ANVIL_PK = anvilAccount0Pk();
const SIG = `0x${"ab".repeat(65)}`;
const MNEMONIC = anvilMnemonic();

function hidden(): boolean {
  if (process.env.NEXT_PUBLIC_REVIEW_FIXTURES === "1") return false;
  return (
    (process.env.NEXT_PUBLIC_REACTOR_ENV ?? process.env.REACTOR_ENV ?? "").toUpperCase() === "PROD" ||
    process.env.NODE_ENV === "production"
  );
}

function sentinelMessage(kind: string): string {
  return `${kind} inject pk=${ANVIL_PK} mnemonic=${MNEMONIC}`;
}

export default function ObsInjectPage() {
  if (hidden()) notFound();
  const [last, setLast] = useState<TelemetryEvent | null>(null);

  function inject(kind: FailureKind, err: unknown, extra?: Record<string, unknown>) {
    const ev = reportFailure(kind, err, {
      signature: SIG,
      turnstile: "cf-inject-secret",
      privateKey: ANVIL_PK,
      ...extra,
    });
    setLast(ev);
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold">Telemetry failure injection</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Review-fixtures / LOCAL only. Injects each outage class with secret sentinels. Hidden in genuine
        production (no <code>NEXT_PUBLIC_REVIEW_FIXTURES=1</code>). Not in public nav.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => inject("ui", new Error(sentinelMessage("render")))}>Inject render outage</Button>
        <Button variant="outline" onClick={() => inject("api", new Error(sentinelMessage("api")))}>
          Inject API outage
        </Button>
        <Button variant="outline" onClick={() => inject("rpc", new Error(sentinelMessage("rpc")))}>
          Inject RPC outage
        </Button>
        <Button variant="outline" onClick={() => inject("quote", new Error(sentinelMessage("quote")))}>
          Inject quote outage
        </Button>
        <Button variant="outline" onClick={() => inject("sse", new Error(sentinelMessage("sse")))}>
          Inject SSE outage
        </Button>
        <Button
          variant="outline"
          onClick={() => inject("simulation", new Error("eth_call simulation reverted pk=" + ANVIL_PK))}
        >
          Inject simulation outage
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            inject("wallet", Object.assign(new Error("User rejected the request"), { code: WALLET_USER_REJECTED }), {
              action: "connect",
            })
          }
        >
          Inject wallet 4001
        </Button>
      </div>
      {last && (
        <pre className="mt-4 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[11px] text-zinc-300">
          {JSON.stringify(
            {
              kind: last.kind,
              page: last.page,
              pagingReason: last.pagingReason,
              outageClass: last.outageClass,
              traceId: last.traceId,
              supportRef: formatSupportRef(last),
              chainId: last.chainId,
              chainName: last.chainName,
              reactorEnv: last.reactorEnv,
              buildTimestamp: last.buildTimestamp,
              release: last.release,
              message: last.message,
            },
            null,
            2,
          )}
        </pre>
      )}
    </div>
  );
}
