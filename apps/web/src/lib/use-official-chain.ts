"use client";

import { useAccount } from "wagmi";
import { chainMismatchMessage, isOfficialChain, officialChainId } from "./tx-guard";

export function useOfficialChain() {
  const { address, chainId, isConnected } = useAccount();
  const expected = officialChainId();
  const matched = !isConnected || isOfficialChain(chainId);
  return {
    address,
    chainId,
    expected,
    isConnected,
    matched,
    writesEnabled: isConnected && isOfficialChain(chainId),
    mismatchMessage: chainMismatchMessage(chainId),
  };
}
