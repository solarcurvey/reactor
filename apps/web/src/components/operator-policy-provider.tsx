"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import {
  isOperatorPolicyReason,
  launchpadUxFromView,
  parseWritePolicyError,
  type PublicOperatorPolicyView,
  type RestrictedUxKind,
} from "@/lib/operator-policy";
import { fetchWalletProofMessage, type WalletProofHeader } from "@/lib/wallet-proof";

export type OperatorPolicyUx = {
  kind: RestrictedUxKind;
  decision: PublicOperatorPolicyView["decision"] | "pending";
  reason: PublicOperatorPolicyView["reason"] | "";
  userMessage: string;
  writesAllowed: boolean;
  disclaimer: string;
  loading: boolean;
  applyWriteError: (body: unknown) => boolean;
  refresh: () => Promise<void>;
  ensureProof: () => Promise<WalletProofHeader | undefined>;
};

const pending: OperatorPolicyUx = {
  kind: "pending",
  decision: "pending",
  reason: "",
  userMessage: "",
  writesAllowed: false,
  disclaimer: "",
  loading: true,
  applyWriteError: () => false,
  refresh: async () => undefined,
  ensureProof: async () => undefined,
};

const OperatorPolicyContext = createContext<OperatorPolicyUx>(pending);

type CachedProof = { address: string; header: string; exp: number };

function viewToUx(
  view: PublicOperatorPolicyView,
  extras: Pick<OperatorPolicyUx, "applyWriteError" | "refresh" | "ensureProof">,
): OperatorPolicyUx {
  const ux = launchpadUxFromView(view);
  return {
    kind: ux.kind,
    decision: ux.decision,
    reason: view.reason,
    userMessage: ux.error,
    writesAllowed: ux.writesAllowed,
    disclaimer: view.disclaimer,
    loading: false,
    ...extras,
  };
}

export function OperatorPolicyProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [view, setView] = useState<PublicOperatorPolicyView | null>(null);
  const proofRef = useRef<CachedProof | null>(null);

  const ensureProof = useCallback(async (): Promise<WalletProofHeader | undefined> => {
    if (!isConnected || !address) return undefined;
    const now = Math.floor(Date.now() / 1000);
    const cached = proofRef.current;
    if (cached && cached.address === address.toLowerCase() && cached.exp - 20 > now) {
      return { "x-reactor-wallet-proof": cached.header };
    }
    try {
      const challenge = await fetchWalletProofMessage();
      const signature = await signMessageAsync({ message: challenge.message });
      const header = JSON.stringify({ token: challenge.token, signature });
      proofRef.current = {
        address: address.toLowerCase(),
        header,
        exp: challenge.exp ?? now + 90,
      };
      return { "x-reactor-wallet-proof": header };
    } catch {
      proofRef.current = null;
      return undefined;
    }
  }, [address, isConnected, signMessageAsync]);

  const refresh = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (isConnected && address) {
        const proof = await ensureProof();
        if (proof) Object.assign(headers, proof);
      }
      const pageFixture =
        typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("fixture") : null;
      const qs =
        pageFixture && isOperatorPolicyReason(pageFixture)
          ? `?fixture=${encodeURIComponent(pageFixture)}`
          : "";
      const res = await fetch(`/api/operator-policy${qs}`, { cache: "no-store", headers });
      const json: unknown = await res.json();
      const parsed = parseWritePolicyError(json);
      if (parsed) {
        setView({ ...parsed, source: parsed.source === "write-error" ? "indexer" : parsed.source });
        return;
      }
    } catch {
      /* fail closed: keep writes disabled */
    }
    setView((prev) =>
      prev ?? {
        ok: false,
        decision: "unavailable",
        reason: "UNAVAILABLE_POLICY_REQUIRED",
        kind: "unavailable",
        error: "Required access checks are temporarily unavailable.",
        disclaimer:
          "REACTOR-operated services only. Public contracts remain callable onchain. Not a legal or OFAC-compliance opinion.",
        policy: "reactor-operator-policy-v1",
        writesAllowed: false,
        source: "stub",
      },
    );
  }, [address, ensureProof, isConnected]);

  const applyWriteError = useCallback((body: unknown) => {
    const parsed = parseWritePolicyError(body);
    if (!parsed || parsed.reason === "ALLOW") return false;
    setView(parsed);
    return true;
  }, []);

  useEffect(() => {
    if (!isConnected || !address) proofRef.current = null;
    void refresh();
  }, [address, isConnected, refresh]);

  const value = useMemo<OperatorPolicyUx>(() => {
    if (!view) return { ...pending, refresh, applyWriteError, ensureProof };
    return viewToUx(view, { refresh, applyWriteError, ensureProof });
  }, [view, refresh, applyWriteError, ensureProof]);

  return <OperatorPolicyContext.Provider value={value}>{children}</OperatorPolicyContext.Provider>;
}

export function useOperatorPolicy(): OperatorPolicyUx {
  return useContext(OperatorPolicyContext);
}
