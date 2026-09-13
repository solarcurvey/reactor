"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import { shortAddress } from "@/lib/utils";
import { arcLocal } from "@/lib/chain";
import { useQaInject, useQaState } from "./qa-inject-provider";
import { FAILURE_COPY } from "@/lib/qa-inject";

export function WalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const inject = useQaInject();
  const state = useQaState();
  const [menu, setMenu] = useState(false);
  const [reject, setReject] = useState<string | null>(null);
  // Wagmi reconnects from the injected provider after a full navigation.
  // Keep the first client paint on the SSR "Connect wallet" tree unless the
  // QA fixture URL already opted into a connected chrome (React 418).
  const [hydrated, setHydrated] = useState(false);

  const fixtureConnected = state === "wallet-menu" || state === "wallet-connected";
  const shownAddress = address ?? (fixtureConnected ? "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" : undefined);
  const shownConnected = fixtureConnected || (hydrated && isConnected);

  useEffect(() => {
    setHydrated(true);
    if (state === "wallet-menu") setMenu(true);
    if (inject === "wallet-reject") setReject(FAILURE_COPY["wallet-reject"].body);
    if (inject === "wallet-revert") setReject(FAILURE_COPY["wallet-revert"].body);
  }, [state, inject]);

  if (!shownConnected) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          size="sm"
          data-testid="wallet-connect"
          onClick={() => {
            if (inject === "wallet-reject") {
              setReject(FAILURE_COPY["wallet-reject"].body);
              return;
            }
            connect({ connector: connectors[0] });
          }}
          disabled={isPending || (connectors.length === 0 && !inject)}
        >
          {connectors.length === 0 && !inject ? "No wallet" : isPending ? "Connecting…" : "Connect wallet"}
        </Button>
        {reject ? (
          <p role="alert" data-testid="failure-wallet-reject" className="max-w-[16rem] text-right text-[11px] text-red-300">
            {reject}
          </p>
        ) : null}
      </div>
    );
  }

  if (hydrated && isConnected && chainId !== arcLocal.id) {
    return (
      <Button
        size="sm"
        variant="danger"
        data-testid="wallet-switch"
        onClick={() => switchChain({ chainId: arcLocal.id })}
      >
        Switch to {arcLocal.name}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden font-mono text-xs text-zinc-400 sm:inline">{shortAddress(shownAddress)}</span>
      <Modal
        open={menu}
        onOpenChange={setMenu}
        title="Account"
        trigger={
          <Button size="sm" variant="outline" data-testid="wallet-menu-trigger">
            Account
          </Button>
        }
      >
        <dl className="space-y-2 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-400">Address</dt>
            <dd className="font-mono text-white">{shortAddress(shownAddress)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-400">Chain</dt>
            <dd className="font-mono text-white">5042002 · local</dd>
          </div>
        </dl>
        {isConnected ? (
          <Button size="sm" variant="outline" className="mt-3" data-testid="wallet-disconnect" onClick={() => disconnect()}>
            Disconnect
          </Button>
        ) : null}
        {inject === "wallet-reject" || inject === "wallet-revert" ? (
          <p role="alert" data-testid={`failure-${inject}`} className="mt-3 text-sm text-red-300">
            {FAILURE_COPY[inject].body}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
