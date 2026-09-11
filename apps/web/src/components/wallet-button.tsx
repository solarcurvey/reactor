"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { Button } from "./ui/button";
import { shortAddress } from "@/lib/utils";
import { arcLocal } from "@/lib/chain";

export function WalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (!isConnected) {
    return (
      <Button
        size="sm"
        onClick={() => connect({ connector: connectors[0] })}
        disabled={isPending || connectors.length === 0}
      >
        {connectors.length === 0 ? "No wallet" : isPending ? "Connecting…" : "Connect wallet"}
      </Button>
    );
  }

  if (chainId !== arcLocal.id) {
    return (
      <Button size="sm" variant="danger" onClick={() => switchChain({ chainId: arcLocal.id })}>
        Switch to {arcLocal.name}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden font-mono text-xs text-zinc-400 sm:inline">{shortAddress(address)}</span>
      <Button size="sm" variant="outline" onClick={() => disconnect()}>
        Disconnect
      </Button>
    </div>
  );
}
