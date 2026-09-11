import { defineChain } from "viem";
import { deployment } from "./addresses";

const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? deployment.rpc;
const explorer = process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://testnet.arcscan.app";

export const arcLocal = defineChain({
  id: deployment.chainId,
  name: deployment.claimedArcTestnet ? "Arc Public Testnet" : "REACTOR local (Arc-compatible)",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [rpc] },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: explorer },
  },
});

export const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://127.0.0.1:43148";
