#!/usr/bin/env npx tsx
/**
 * Production-shaped Instant launch + BUY/SELL wallet harness (#16).
 * Uses the same Factory / UserRouteExecutor ABIs as the Next app.
 * #35: no wallet-harness branch exists in this tree; this is the production
 * indexer (`POST /launch/authorize`, `POST /quote`) + viem EOA path from
 * CurrentArchitecture.t.sol.
 *
 * Refuses Arc Mainnet. Does not invent explorer success. Local Anvil is labeled
 * local-only (`--local`).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, http, parseAbi, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  EXPLORER,
  isAnvil0Key,
  refuseMainnet,
} from "./arc-testnet-lib.ts";

const root = join(import.meta.dirname, "..");
const outPath = join(root, "deployments/arc-testnet-journey.json");

const launchAuthTuple =
  "(address factory,uint32 factoryVersion,address creator,address quote,uint8 quoteDecimals,uint8 mode,string ticker,string name,bytes32 metadataHash,uint256 virtualQuote0,bytes32 curveConfig,bytes32 authId,uint256 deadline)";

const launchAbi = parseAbi([
  `function launchStandard((string name,string symbol,uint8 decimals,uint256 supply,address quote,uint256 fdvQuoteRaw,uint256 devBuyQuote,string image,string description,string website,string twitter,string telegram) p, ${launchAuthTuple} a, bytes sig) returns (address token, bytes32 poolId)`,
]);

const routeAbi = parseAbi([
  "function buy(address token, uint256 usdcIn, (address adapter, address tokenIn, address tokenOut, uint256 minOut, bytes data)[] hops, uint256 minFinalOut, uint256 deadline) returns (uint256)",
  "function sell(address token, uint256 tokenIn, (address adapter, address tokenIn, address tokenOut, uint256 minOut, bytes data)[] hops, uint256 minQuoteOut, uint256 minFinalOut, uint256 deadline) returns (uint256)",
]);

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

type Step = {
  id: string;
  status: "ok" | "skipped" | "blocked" | "failed";
  detail: string;
  tx?: string;
  explorer?: string;
};

type Journey = {
  at: string;
  claimedArcTestnet: false;
  network: "arc-public-testnet" | "local-anvil-not-testnet";
  chainId?: number;
  indexer?: string;
  steps: Step[];
  blockers: string[];
  note: string;
};

function argFlag(name: string): boolean {
  return process.argv.includes(name);
}

function loadDeployment(local: boolean): {
  rpc: string;
  chainId: number;
  claimedArcTestnet: boolean;
  addresses: Record<string, string>;
  source: string;
} {
  const testnetFile = join(root, "deployments/arc-testnet.json");
  const localFile = join(root, "deployments/local.json");
  const path = local ? localFile : existsSync(testnetFile) ? testnetFile : localFile;
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  const j = JSON.parse(readFileSync(path, "utf8")) as {
    rpc: string;
    chainId: number;
    claimedArcTestnet?: boolean;
    addresses: Record<string, string>;
  };
  return { ...j, claimedArcTestnet: Boolean(j.claimedArcTestnet), source: path };
}

async function indexerJson(url: string, path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(new URL(path, url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: json };
}

async function main() {
  const local = argFlag("--local");
  const journey: Journey = {
    at: new Date().toISOString(),
    claimedArcTestnet: false,
    network: local ? "local-anvil-not-testnet" : "arc-public-testnet",
    steps: [],
    blockers: [],
    note: "Production Instant path: admit/authorize → Factory.launchStandard → POST /quote → UserRouteExecutor.buy/sell with nonzero minOut.",
  };

  const dep = loadDeployment(local);
  const rpc = process.env.ARC_TESTNET_RPC ?? process.env.RPC_URL ?? (local ? dep.rpc : "https://rpc.testnet.arc.io");
  const indexer = process.env.INDEXER_URL ?? process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://127.0.0.1:43148";
  journey.indexer = indexer;

  const client = createPublicClient({
    chain: defineChain({
      id: local ? dep.chainId : ARC_TESTNET_CHAIN_ID,
      name: local ? "local-anvil" : "Arc Public Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [rpc] } },
    }),
    transport: http(rpc, { fetchOptions: { headers: { "user-agent": "reactor-arc-testnet-harness" } } }),
  });

  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch (e) {
    journey.blockers.push(`RPC ${rpc} failed: ${e instanceof Error ? e.message : String(e)}`);
    journey.steps.push({ id: "rpc", status: "blocked", detail: journey.blockers[0]! });
    writeFileSync(outPath, JSON.stringify(journey, null, 2) + "\n");
    console.log(JSON.stringify(journey, null, 2));
    process.exit(2);
    return;
  }
  journey.chainId = chainId;
  refuseMainnet(chainId);
  if (chainId === ARC_MAINNET_CHAIN_ID) throw new Error("unreachable");
  if (!local && chainId !== ARC_TESTNET_CHAIN_ID) {
    journey.blockers.push(`chain ${chainId} is not 5042002`);
  }
  if (local && dep.claimedArcTestnet) {
    journey.blockers.push("local dump must not set claimedArcTestnet");
  }

  const factory = dep.addresses.ReactorFactory as `0x${string}` | undefined;
  const router = dep.addresses.UserRouteExecutor as `0x${string}` | undefined;
  const usdc = dep.addresses.USDC as `0x${string}` | undefined;
  if (!factory || !router || !usdc) {
    journey.steps.push({ id: "addresses", status: "blocked", detail: "Factory / UserRouteExecutor / USDC missing from dump" });
    journey.blockers.push("incomplete address dump");
  } else if (!local) {
    const code = await client.getCode({ address: factory });
    if (!code || code === "0x") {
      journey.steps.push({
        id: "factory_code",
        status: "blocked",
        detail: `${factory} has no code on ${chainId}. ${dep.source} is ${dep.claimedArcTestnet ? "claimed" : "not a live testnet dump"}.`,
      });
      journey.blockers.push("ReactorFactory not deployed on Arc Public Testnet — cannot Instant launch");
    } else {
      journey.steps.push({ id: "factory_code", status: "ok", detail: `${factory} has code (${(code.length - 2) / 2} bytes)` });
    }
  } else {
    journey.steps.push({
      id: "factory_code",
      status: "skipped",
      detail: `local dump ${factory} — not Arc Public Testnet. claimedArcTestnet=false`,
    });
  }

  if (!local && journey.blockers.length) {
    journey.steps.push({
      id: "instant_launch",
      status: "blocked",
      detail: "Waiting for funded deploy + claimed addresses. Production Next env is in deployments/arc-testnet.env.example.",
    });
    journey.steps.push({ id: "buy", status: "blocked", detail: "depends on Instant launch" });
    journey.steps.push({ id: "sell", status: "blocked", detail: "depends on BUY" });
    writeFileSync(outPath, JSON.stringify(journey, null, 2) + "\n");
    console.log(JSON.stringify(journey, null, 2));
    process.exit(2);
    return;
  }

  const pk = process.env.ARC_TESTNET_PK ?? process.env.HARNESS_PK ?? "";
  if (!pk || isAnvil0Key(pk) && !local) {
    journey.steps.push({
      id: "wallet",
      status: "blocked",
      detail: local
        ? "HARNESS_PK / ARC_TESTNET_PK unset — local Anvil can use a documented test key via HARNESS_PK"
        : "No funded disposable key. Anvil #0 is refused on public testnet.",
    });
    journey.blockers.push("no funded trader key");
    writeFileSync(outPath, JSON.stringify(journey, null, 2) + "\n");
    console.log(JSON.stringify(journey, null, 2));
    process.exit(2);
    return;
  }

  const account = privateKeyToAccount(pk as `0x${string}`);
  const wallet = createWalletClient({
    account,
    chain: client.chain,
    transport: http(rpc),
  });
  journey.steps.push({ id: "wallet", status: "ok", detail: account.address });

  try {
    const admit = await indexerJson(indexer, "/launch/authorize", {
      wallet: account.address,
      quote: usdc,
      ticker: "RHRSL",
      name: "Rehearsal",
      mode: "standard",
      factory,
      factoryVersion: 1,
      image: "",
      description: "issue 16 rehearsal — not a production token",
      website: "",
      twitter: "",
      telegram: "",
    });
    if (admit.status !== 200) {
      journey.steps.push({
        id: "launch_authorize",
        status: "blocked",
        detail: `POST /launch/authorize HTTP ${admit.status} ${JSON.stringify(admit.body).slice(0, 280)}`,
      });
      journey.blockers.push("launch authorize failed (Turnstile / signer / indexer down)");
      writeFileSync(outPath, JSON.stringify(journey, null, 2) + "\n");
      console.log(JSON.stringify(journey, null, 2));
      process.exit(2);
      return;
    }
    const auth = admit.body.auth as Record<string, unknown> | undefined;
    const sig = admit.body.signature as `0x${string}` | undefined;
    if (!auth || !sig) {
      journey.steps.push({ id: "launch_authorize", status: "blocked", detail: "authorize returned 200 without auth/signature" });
      writeFileSync(outPath, JSON.stringify(journey, null, 2) + "\n");
      process.exit(2);
      return;
    }
    journey.steps.push({ id: "launch_authorize", status: "ok", detail: "ALLOW + EIP-712 signature" });

    const hash = await wallet.writeContract({
      address: factory!,
      abi: launchAbi,
      functionName: "launchStandard",
      args: [
        {
          name: "Rehearsal",
          symbol: "RHRSL",
          decimals: 18,
          supply: 0n,
          quote: usdc!,
          fdvQuoteRaw: 0n,
          devBuyQuote: 0n,
          image: "",
          description: "issue 16 rehearsal — not a production token",
          website: "",
          twitter: "",
          telegram: "",
        },
        {
          factory: auth.factory as `0x${string}`,
          factoryVersion: Number(auth.factoryVersion),
          creator: auth.creator as `0x${string}`,
          quote: auth.quote as `0x${string}`,
          quoteDecimals: Number(auth.quoteDecimals),
          mode: Number(auth.mode),
          ticker: String(auth.ticker),
          name: String(auth.name),
          metadataHash: auth.metadataHash as `0x${string}`,
          virtualQuote0: BigInt(String(auth.virtualQuote0)),
          curveConfig: auth.curveConfig as `0x${string}`,
          authId: auth.authId as `0x${string}`,
          deadline: BigInt(String(auth.deadline)),
        },
        sig,
      ],
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    const tokenLog = receipt.logs.find((l) => l.topics.length >= 2);
    const token = (tokenLog?.address ?? "0x") as `0x${string}`;
    journey.steps.push({
      id: "instant_launch",
      status: receipt.status === "success" ? "ok" : "failed",
      detail: `token ${token}`,
      tx: hash,
      explorer: `${EXPLORER}/tx/${hash}`,
    });

    const quoteBuy = await indexerJson(indexer, "/quote", {
      token,
      side: "BUY",
      amountIn: "1000000",
      slippageBps: 100,
    });
    const minBuy = BigInt(String((quoteBuy.body.minOut ?? quoteBuy.body.minFinalOut ?? 1) as string));
    if (quoteBuy.status !== 200 || minBuy === 0n) {
      journey.steps.push({
        id: "quote_buy",
        status: "blocked",
        detail: `POST /quote BUY HTTP ${quoteBuy.status} — refuse minOut=0`,
      });
      writeFileSync(outPath, JSON.stringify(journey, null, 2) + "\n");
      process.exit(2);
      return;
    }
    journey.steps.push({ id: "quote_buy", status: "ok", detail: `minFinalOut ${minBuy}` });

    await wallet.writeContract({ address: usdc!, abi: erc20Abi, functionName: "approve", args: [router!, 1_000_000n] });
    const buyHash = await wallet.writeContract({
      address: router!,
      abi: routeAbi,
      functionName: "buy",
      args: [token, 1_000_000n, [], minBuy, BigInt(Math.floor(Date.now() / 1000) + 120)],
    });
    await client.waitForTransactionReceipt({ hash: buyHash });
    journey.steps.push({
      id: "buy",
      status: "ok",
      detail: "UserRouteExecutor.buy exact-in, nonzero minOut",
      tx: buyHash,
      explorer: `${EXPLORER}/tx/${buyHash}`,
    });

    const bal = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
    const sellAmt = bal / 4n;
    const quoteSell = await indexerJson(indexer, "/quote", {
      token,
      side: "SELL",
      amountIn: sellAmt.toString(),
      slippageBps: 100,
    });
    const minQuoteOut = BigInt(String((quoteSell.body.minQuoteOut ?? 1) as string));
    const minFinalOut = BigInt(String((quoteSell.body.minFinalOut ?? quoteSell.body.minOut ?? 1) as string));
    if (minQuoteOut === 0n || minFinalOut === 0n) {
      journey.steps.push({ id: "quote_sell", status: "blocked", detail: "SELL floors were 0 — refuse" });
      writeFileSync(outPath, JSON.stringify(journey, null, 2) + "\n");
      process.exit(2);
      return;
    }
    await wallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [router!, sellAmt] });
    const sellHash = await wallet.writeContract({
      address: router!,
      abi: routeAbi,
      functionName: "sell",
      args: [token, sellAmt, [], minQuoteOut, minFinalOut, BigInt(Math.floor(Date.now() / 1000) + 120)],
    });
    await client.waitForTransactionReceipt({ hash: sellHash });
    journey.steps.push({
      id: "sell",
      status: "ok",
      detail: "UserRouteExecutor.sell with minQuoteOut + minFinalOut",
      tx: sellHash,
      explorer: `${EXPLORER}/tx/${sellHash}`,
    });
  } catch (e) {
    journey.steps.push({ id: "journey", status: "failed", detail: e instanceof Error ? e.message : String(e) });
    journey.blockers.push(e instanceof Error ? e.message : String(e));
  }

  if (local) {
    journey.note += " This run used --local (Anvil). Not Arc Public Testnet. claimedArcTestnet remains false.";
  }

  writeFileSync(outPath, JSON.stringify(journey, null, 2) + "\n");
  console.log(JSON.stringify(journey, null, 2));
  if (journey.blockers.length || journey.steps.some((s) => s.status === "failed" || s.status === "blocked")) {
    process.exit(2);
  }
}

void main();
