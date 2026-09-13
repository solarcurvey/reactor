"use client";

import type { QaState } from "@/lib/qa-inject";

const COPY: Record<"tx-pending" | "tx-confirmed" | "tx-reverted", { title: string; body: string; testid: string }> = {
  "tx-pending": {
    title: "Transaction pending",
    body: "Waiting for the local chain receipt. Do not resubmit.",
    testid: "tx-pending",
  },
  "tx-confirmed": {
    title: "Transaction confirmed",
    body: "tx 0x1111111111111111111111111111111111111111111111111111111111111111",
    testid: "tx-confirmed",
  },
  "tx-reverted": {
    title: "Transaction reverted",
    body: "Incomplete fill or slippage. Exact-in reverted. No leftover ticket.",
    testid: "tx-reverted",
  },
};

export function TxStatus({ state }: { state: QaState | null }) {
  if (state !== "tx-pending" && state !== "tx-confirmed" && state !== "tx-reverted") return null;
  const copy = COPY[state];
  const alert = state === "tx-reverted";
  return (
    <div
      data-testid={copy.testid}
      role={alert ? "alert" : "status"}
      aria-live={alert ? "assertive" : "polite"}
      className={`mt-3 rounded-xl border px-3 py-2 text-[13px] ${
        alert ? "border-red-500/30 bg-red-500/10 text-red-50" : "border-cyan-300/25 bg-cyan-300/10 text-cyan-50"
      }`}
    >
      <p className="font-medium">{copy.title}</p>
      <p className="mt-0.5 break-all font-mono text-[11px]">{copy.body}</p>
    </div>
  );
}
