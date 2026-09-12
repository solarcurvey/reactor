"use client";

import { useOfficialChain } from "./use-official-chain";
import { restrictedHref, writeCtaLabel } from "./operator-policy";
import { useOperatorPolicy } from "@/components/operator-policy-provider";

export function useOperatedWrites() {
  const chain = useOfficialChain();
  const policy = useOperatorPolicy();
  const policyAllows = policy.writesAllowed;
  const policyBlocked = policy.kind !== "allow" && policy.kind !== "pending";
  const writeBlockMessage = policyBlocked
    ? policy.userMessage
    : !chain.matched
      ? chain.mismatchMessage
      : undefined;
  return {
    ...chain,
    policy,
    writesEnabled: chain.writesEnabled && policyAllows,
    policyBlocked,
    writeBlockMessage,
    restrictedHref: restrictedHref(policy.kind),
    writeButtonLabel: (fallback: string) => {
      if (!chain.matched && chain.isConnected) return "Wrong network";
      if (policyBlocked) return writeCtaLabel(policy.kind, fallback);
      return fallback;
    },
  };
}
