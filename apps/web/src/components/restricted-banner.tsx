"use client";

import Link from "next/link";
import { restrictedHref } from "@/lib/operator-policy";
import { useOperatorPolicy } from "./operator-policy-provider";

export function RestrictedBanner() {
  const policy = useOperatorPolicy();
  if (policy.kind === "allow" || policy.kind === "pending") return null;
  const label =
    policy.kind === "wallet"
      ? "REACTOR-operated services are not available for this account."
      : policy.kind === "geo"
        ? "REACTOR-operated services are not available for this request location."
        : "Required access checks are temporarily unavailable. Operated writes are paused.";
  return (
    <div
      data-testid="restricted-banner"
      data-kind={policy.kind}
      className="border-b border-amber-400/25 bg-amber-400/10 px-4 py-2 text-center text-[12px] text-amber-50"
    >
      {label}{" "}
      <Link href={restrictedHref(policy.kind)} className="underline decoration-amber-200/50 underline-offset-2">
        Learn more
      </Link>
    </div>
  );
}
