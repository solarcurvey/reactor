#!/usr/bin/env npx tsx
/**
 * Instant + Fair smoke against a live Arc Public Testnet dump.
 * Signs LaunchAuthorization with the deployer (Guardian/pricingSigner fallback).
 * Never targets chain 5042.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseEventLogs,
  defineChain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  INSTANT_CURVE_V1,
  LAUNCH_AUTH_TYPES,
  MODE_FAIR,
  MODE_STANDARD,
  fairCurveConfig,
  hashMetadata,
} from "../packages/reactor/src/launch-auth.ts";
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID, EXPLORER, refuseMainnet } from "./arc-testnet-lib.ts";

const root = join(import.meta.dirname, "..");
const dumpPath = join(root, "deployments/arc-testnet.json");
const outPath = join(root, "deployments/arc-testnet-smoke.json");

const launchAuthTuple =
  "(address factory,uint32 factoryVersion,address creator,address quote,uint8 quoteDecimals,uint8 mode,string ticker,string name,bytes32 metadataHash,uint256 virtualQuote0,bytes32 curveConfig,bytes32 authId,uint256 deadline)";

const factoryAbi = parseAbi([
  `function launchStandard((string name,string symbol,uint8 decimals,uint256 supply,address quote,uint256 fdvQuoteRaw,uint256 devBuyQuote,string image,string description,string website,string twitter,string telegram) p, ${launchAuthTuple} a, bytes sig) returns (address token, bytes32 poolId)`,
  `function createFairLaunch((string name,string symbol,uint8 decimals,uint256 supply,address quote,uint64 duration,uint16 auctionBps,uint256 minRaise,string image,string description,string website,string twitter,string telegram) p, ${launchAuthTuple} a, bytes sig) returns (address token, uint256 fairId)`,
  "function bid(uint256 fairId, uint256 amount)",
  "function finalizeFairLaunch(uint256 fairId) returns (bytes32 poolId)",
  "function claimFairTokens(uint256 fairId, address to) returns (uint256)",
  "function expectedVirtualQuote0(address quote) view returns (uint256)",
  "function authDomain() view returns (bytes32)",
  "function launchCount() view returns (uint256)",
  "event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 supply)",
  "event BatchFairLaunchCreated(uint256 indexed fairId, address indexed token, uint64 startTime, uint64 endTime)",
]);

const curveAbi = parseAbi([
  "function buy(address token, uint256 quoteIn, uint256 minOut) returns (uint256)",
  "function sell(address token, uint256 tokenIn, uint256 minOut) returns (uint256)",
]);

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const pk = (process.env.ARC_TESTNET_PK ?? process.env.DEPLOYER_PK ?? "") as Hex;
  if (!pk || pk.length < 10) throw new Error("ARC_TESTNET_PK required");
  const dump = JSON.parse(readFileSync(dumpPath, "utf8")) as {
    rpc: string;
    chainId: number;
    addresses: Record<string, `0x${string}`>;
  };
  const rpc = process.env.ARC_TESTNET_RPC ?? dump.rpc;
  const chain = defineChain({
    id: ARC_TESTNET_CHAIN_ID,
    name: "Arc Public Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const chainId = await publicClient.getChainId();
  refuseMainnet(chainId);
  if (chainId === ARC_MAINNET_CHAIN_ID) throw new Error("blocked");
  if (chainId !== ARC_TESTNET_CHAIN_ID) throw new Error(`unexpected chain ${chainId}`);

  const A = dump.addresses;
  const factory = A.ReactorFactory;
  const curve = A.InstantCurve;
  const usdc = A.USDC;
  const steps: Record<string, unknown>[] = [];

  const vq0 = await publicClient.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "expectedVirtualQuote0",
    args: [usdc],
  });

  async function signAuth(input: {
    ticker: string;
    name: string;
    mode: number;
    curveConfig: `0x${string}`;
    virtualQuote0: bigint;
    metadataHash: `0x${string}`;
  }) {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
    const authId = (`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`) as Hex;
    const message = {
      factory,
      factoryVersion: 1,
      creator: account.address,
      quote: usdc,
      quoteDecimals: 6,
      mode: input.mode,
      ticker: input.ticker,
      name: input.name,
      metadataHash: input.metadataHash,
      virtualQuote0: input.virtualQuote0,
      curveConfig: input.curveConfig,
      authId,
      deadline,
      chainId: BigInt(ARC_TESTNET_CHAIN_ID),
    };
    const signature = await account.signTypedData({
      domain: {
        name: "REACTOR",
        version: "1",
        chainId: BigInt(ARC_TESTNET_CHAIN_ID),
        verifyingContract: A.TickerRegistry,
      },
      types: LAUNCH_AUTH_TYPES,
      primaryType: "LaunchAuthorization",
      message,
    });
    return { message, signature };
  }

  const instantMeta = hashMetadata("", "issue 16 instant smoke", "", "", "");
  const instant = await signAuth({
    ticker: "RHRSI",
    name: "Rehearsal Instant",
    mode: MODE_STANDARD,
    curveConfig: INSTANT_CURVE_V1,
    virtualQuote0: vq0,
    metadataHash: instantMeta,
  });
  const launchHash = await wallet.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: "launchStandard",
    gas: 8_000_000n,
    args: [
      {
        name: "Rehearsal Instant",
        symbol: "RHRSI",
        decimals: 18,
        supply: 0n,
        quote: usdc,
        fdvQuoteRaw: 0n,
        devBuyQuote: 0n,
        image: "",
        description: "issue 16 instant smoke",
        website: "",
        twitter: "",
        telegram: "",
      },
      instant.message,
      instant.signature,
    ],
  });
  const launchRcpt = await publicClient.waitForTransactionReceipt({ hash: launchHash });
  const instantCreated = parseEventLogs({
    abi: factoryAbi,
    logs: launchRcpt.logs,
    eventName: "TokenCreated",
  })[0];
  const instantToken = instantCreated?.args.token;
  steps.push({
    step: "instant_launch",
    tx: launchHash,
    explorer: `${EXPLORER}/tx/${launchHash}`,
    status: launchRcpt.status,
    token: instantToken,
  });
  if (launchRcpt.status !== "success" || !instantToken) throw new Error("instant launch failed");

  const buyIn = 10_000_000n; // 10 mock USDC-6
  const approveBuy = await wallet.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "approve",
    args: [curve, buyIn],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveBuy });
  const buyHash = await wallet.writeContract({
    address: curve,
    abi: curveAbi,
    functionName: "buy",
    args: [instantToken, buyIn, 1n],
  });
  const buyRcpt = await publicClient.waitForTransactionReceipt({ hash: buyHash });
  const tokBal = await publicClient.readContract({
    address: instantToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  steps.push({
    step: "instant_buy",
    tx: buyHash,
    explorer: `${EXPLORER}/tx/${buyHash}`,
    status: buyRcpt.status,
    tokensOut: tokBal.toString(),
  });

  const sellAmt = tokBal / 4n;
  const approveSell = await wallet.writeContract({
    address: instantToken,
    abi: erc20Abi,
    functionName: "approve",
    args: [curve, sellAmt],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveSell });
  const sellHash = await wallet.writeContract({
    address: curve,
    abi: curveAbi,
    functionName: "sell",
    args: [instantToken, sellAmt, 1n],
  });
  const sellRcpt = await publicClient.waitForTransactionReceipt({ hash: sellHash });
  steps.push({
    step: "instant_sell",
    tx: sellHash,
    explorer: `${EXPLORER}/tx/${sellHash}`,
    status: sellRcpt.status,
  });

  const fairDuration = 45;
  const fairCfg = fairCurveConfig(1_000_000_000n * 10n ** 18n, 18, fairDuration, 5_000, 0n);
  const fairMeta = hashMetadata("", "issue 16 fair smoke", "", "", "");
  const fair = await signAuth({
    ticker: "RHRFA",
    name: "Rehearsal Fair",
    mode: MODE_FAIR,
    curveConfig: fairCfg,
    virtualQuote0: 0n,
    metadataHash: fairMeta,
  });
  const fairHash = await wallet.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: "createFairLaunch",
    gas: 8_000_000n,
    args: [
      {
        name: "Rehearsal Fair",
        symbol: "RHRFA",
        decimals: 18,
        supply: 0n,
        quote: usdc,
        duration: BigInt(fairDuration),
        auctionBps: 5_000,
        minRaise: 0n,
        image: "",
        description: "issue 16 fair smoke",
        website: "",
        twitter: "",
        telegram: "",
      },
      fair.message,
      fair.signature,
    ],
  });
  const fairRcpt = await publicClient.waitForTransactionReceipt({ hash: fairHash });
  const fairCreated = parseEventLogs({
    abi: factoryAbi,
    logs: fairRcpt.logs,
    eventName: "BatchFairLaunchCreated",
  })[0];
  const fairToken = fairCreated?.args.token;
  const fairId = fairCreated?.args.fairId ?? (await publicClient.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "launchCount",
  }));
  steps.push({
    step: "fair_create",
    tx: fairHash,
    explorer: `${EXPLORER}/tx/${fairHash}`,
    status: fairRcpt.status,
    token: fairToken,
    fairId: fairId.toString(),
  });
  if (fairRcpt.status !== "success") throw new Error("fair create failed");

  const bidAmt = 5_000_000n;
  const approveBid = await wallet.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "approve",
    args: [factory, bidAmt],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveBid });
  const bidHash = await wallet.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: "bid",
    args: [fairId, bidAmt],
  });
  const bidRcpt = await publicClient.waitForTransactionReceipt({ hash: bidHash });
  steps.push({
    step: "fair_bid",
    tx: bidHash,
    explorer: `${EXPLORER}/tx/${bidHash}`,
    status: bidRcpt.status,
    fairId: fairId.toString(),
  });
  if (bidRcpt.status !== "success") throw new Error("fair bid failed");

  await sleep((fairDuration + 5) * 1000);
  const finHash = await wallet.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: "finalizeFairLaunch",
    gas: 6_000_000n,
    args: [fairId],
  });
  const finRcpt = await publicClient.waitForTransactionReceipt({ hash: finHash });
  steps.push({ step: "fair_finalize", tx: finHash, explorer: `${EXPLORER}/tx/${finHash}`, status: finRcpt.status });

  const claimHash = await wallet.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: "claimFairTokens",
    args: [fairId, account.address],
  });
  const claimRcpt = await publicClient.waitForTransactionReceipt({ hash: claimHash });
  steps.push({ step: "fair_claim", tx: claimHash, explorer: `${EXPLORER}/tx/${claimHash}`, status: claimRcpt.status });

  const report = {
    at: new Date().toISOString(),
    claimedArcTestnet: false,
    chainId,
    rpc,
    deployer: account.address,
    explorer: EXPLORER,
    steps,
    note: "Mock USDC-6 from Deploy.s.sol is the protocol quote (labeled). Canonical 0x3600… is not the Instant/Fair quote in this rehearsal. PoolManager is official v4-core BUSL non-production.",
  };
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (steps.some((s) => s.status && s.status !== "success")) process.exit(2);
}

void main();
