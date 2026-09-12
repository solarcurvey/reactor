/**
 * Authoritative current-architecture E2E against a live local deploy.
 * Foundry counterpart: contracts/test/integration/CurrentArchitecture.t.sol
 * Obsolete hookless / 3% / immediate-v4 demos are retired.
 */
import { createPublicClient, http, parseAbi } from "viem";
import { defineChain } from "viem";
import deployment from "./deployment.json" with { type: "json" };

const RPC = process.env.RPC_URL ?? deployment.rpc;
const chain = defineChain({
  id: deployment.chainId,
  name: "reactor-local",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

async function main() {
  const client = createPublicClient({ chain, transport: http(RPC) });
  const chainId = await client.getChainId();
  if (chainId === 5042) throw new Error("mainnet disabled");
  const A = deployment.addresses as Record<string, `0x${string}`>;
  const guardian = parseAbi([
    "function guardian() view returns (address)",
    "function keeper() view returns (address)",
    "function launchesPaused() view returns (bool)",
  ]);
  const core = parseAbi(["function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"]);
  const registry = parseAbi(["function isUsdPegOne(address) view returns (bool)", "function usdc() view returns (address)"]);
  const g = await client.readContract({ address: A.Guardian, abi: guardian, functionName: "guardian" });
  const k = await client.readContract({ address: A.Guardian, abi: guardian, functionName: "keeper" });
  const coreToken = (A.CoreToken ?? A.TestCORE) as `0x${string}`;
  const supply = await client.readContract({ address: coreToken, abi: core, functionName: "totalSupply" });
  const usdc = await client.readContract({ address: A.QuoteAssetRegistry, abi: registry, functionName: "usdc" });
  const peg = await client.readContract({
    address: A.QuoteAssetRegistry,
    abi: registry,
    functionName: "isUsdPegOne",
    args: [usdc],
  });
  if (supply !== 1_000_000_000n * 10n ** 18n) throw new Error("CORE supply");
  if (!peg) throw new Error("USDC must be usdPegOne");
  const deployerCore = await client.readContract({
    address: coreToken,
    abi: core,
    functionName: "balanceOf",
    args: [g],
  });
  if (deployerCore !== 0n) throw new Error("guardian CORE must be 0");
  console.log(
    JSON.stringify(
      {
        ok: true,
        architecture: "current",
        chainId,
        claimedArcTestnet: false,
        guardian: g,
        keeper: k,
        coreSupply: supply.toString(),
        usdPegOne: usdc,
        note: "On-chain walk is contracts/test/integration/CurrentArchitecture.t.sol. This script only probes a live deploy.",
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
