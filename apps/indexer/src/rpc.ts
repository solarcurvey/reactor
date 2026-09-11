import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { defineChain } from "viem";

export function buildRpcClient(opts: { chainId: number; primary: string; fallbackUrl?: string; name?: string }): PublicClient {
  const chain = defineChain({
    id: opts.chainId,
    name: opts.name ?? "reactor",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [opts.primary] } },
  });
  const transports = [http(opts.primary, { timeout: 8_000, retryCount: 1 })];
  if (opts.fallbackUrl && opts.fallbackUrl !== opts.primary) {
    transports.push(http(opts.fallbackUrl, { timeout: 8_000, retryCount: 1 }));
  }
  return createPublicClient({
    chain,
    transport: transports.length > 1 ? fallback(transports, { rank: false }) : transports[0]!,
  });
}

export function rpcFromEnv(chainId: number, primary: string) {
  return buildRpcClient({
    chainId,
    primary: process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? primary,
    fallbackUrl: process.env.RPC_URL_FALLBACK,
  });
}
