"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  parseWritePolicyError,
  type PublicOperatorPolicyView,
  type RestrictedUxKind,
} from "@/lib/operator-policy";

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
};

const OperatorPolicyContext = createContext<OperatorPolicyUx>(pending);

function viewToUx(
  view: PublicOperatorPolicyView,
  extras: Pick<OperatorPolicyUx, "applyWriteError" | "refresh">,
): OperatorPolicyUx {
  return {
    kind: view.kind,
    decision: view.decision,
    reason: view.reason,
    userMessage: view.error,
    writesAllowed: view.writesAllowed,
    disclaimer: view.disclaimer,
    loading: false,
    ...extras,
  };
}

export function OperatorPolicyProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<PublicOperatorPolicyView | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/operator-policy", { cache: "no-store" });
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
  }, []);

  const applyWriteError = useCallback((body: unknown) => {
    const parsed = parseWritePolicyError(body);
    if (!parsed || parsed.reason === "ALLOW") return false;
    setView(parsed);
    return true;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<OperatorPolicyUx>(() => {
    if (!view) return { ...pending, refresh, applyWriteError };
    return viewToUx(view, { refresh, applyWriteError });
  }, [view, refresh, applyWriteError]);

  return <OperatorPolicyContext.Provider value={value}>{children}</OperatorPolicyContext.Provider>;
}

export function useOperatorPolicy(): OperatorPolicyUx {
  return useContext(OperatorPolicyContext);
}
