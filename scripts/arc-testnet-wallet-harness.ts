#!/usr/bin/env npx tsx
/**
 * Production-shaped Instant + Fair wallet harness (#16).
 * Same Factory / UserRouteExecutor ABIs and POST /quote body as the Next app.
 * Instant: POST /launch/authorize → launchStandard → POST /quote → UserRouteExecutor.
 * Fair: POST /launch/authorize → createFairLaunch → bid → finalize → claim.
 *
 * Refuses Arc Mainnet. Does not invent explorer success. Local Anvil is labeled
 * local-only (`--local`). LOCAL indexer authorize (no Turnstile) is not full PROD.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  EXPLORER,
  isAnvil0Key,
  productionQuoteBody,
  refuseMainnet,
} from "./arc-testnet-lib.ts";

const root = join(import.meta.dirname, "..");
const outPath = join(root, "deployments/arc-testnet-journey.json");

const launchAuthTuple =
  "(address factory,uint32 factoryVersion,address creator,address quote,uint8 quoteDecimals,uint8 mode,string ticker,string name,bytes32 metadataHash,uint256 virtualQuote0,bytes32 curveConfig,bytes32 authId,uint256 deadline)";

const launchAbi = parseAbi([
  `function launchStandard((string name,string symbol,uint8 decimals,uint256 supply,address quote,uint256 fdvQuoteRaw,uint256 devBuyQuote,string image,string description,string website,string twitter,string telegram) p, ${launchAuthTuple} a, bytes sig) returns (address token, bytes32 poolId)`,
  `function createFairLaunch((string name,string symbol,uint8 decimals,uint256 supply,address quote,uint64 duration,uint16 auctionBps,uint256 minRaise,string image,string description,string website,string twitter,string telegram) p, ${launchAuthTuple} a, bytes sig) returns (address token, uint256 fairId)`,
  "function bid(uint256 fairId, uint256 amount)",
  "function finalizeFairLaunch(uint256 fairId) returns (bytes32 poolId)",
  "function claimFairTokens(uint256 fairId, address to) returns (uint256)",
  "event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 supply)",
  "event BatchFairLaunchCreated(uint256 indexed fairId, address indexed token, uint64 startTime, uint64 endTime)",
]);

const routeAbi = parseAbi([
  "function buy(address token, uint256 usdcIn, (address adapter, address tokenIn, address tokenOut, uint256 minOut, bytes data)[] hops, uint256 minFinalOut, uint256 deadline) returns (uint256)",
  "function sell(address token, uint256 tokenIn, (address adapter, address tokenIn, address tokenOut, uint256 minOut, bytes data)[] hops, uint256 minQuoteOut, uint256 minFinalOut, uint256 deadline) returns (uint256)",
]);

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function mint(address to, uint256 amount)",
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
  claimedArcTestnet: boolean;
  network: "arc-public-testnet" | "local-anvil-not-testnet";
  chainId?: number;
  indexer?: string;
  authorizeEnv?: string;
  instantToken?: string;
  fairToken?: string;
  fairId?: string;
  steps: Step[];
  blockers: string[];
  note: string;
};

function argFlag(name: string): boolean {
  return process.argv.includes(name);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

function authTuple(auth: Record<string, unknown>) {
  return {
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
  };
}

async function indexerJson(url: string, path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(new URL(path, url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: json };
}

function finish(journey: Journey, code: number) {
  writeFileSync(outPath, JSON.stringify(journey, null, 2) + "\n");
  console.log(JSON.stringify(journey, null, 2));
  process.exit(code);
}

async function main() {
  const local = argFlag("--local");
  const skipFair = argFlag("--skip-fair");
  const ticker = process.env.ARC_HARNESS_TICKER ?? "RHRSL";
  const fairTicker = process.env.ARC_HARNESS_FAIR_TICKER ?? "RHRFL";
  const fairDuration = Number(process.env.ARC_HARNESS_FAIR_DURATION ?? 45);
  const journey: Journey = {
    at: new Date().toISOString(),
    claimedArcTestnet: false,
    network: local ? "local-anvil-not-testnet" : "arc-public-testnet",
    steps: [],
    blockers: [],
    authorizeEnv: process.env.REACTOR_ENV ?? "LOCAL (indexer process)",
    note: "Production Instant path: POST /launch/authorize → Factory.launchStandard → POST /quote (web trade-panel body) → UserRouteExecutor.buy/sell with nonzero minOut. Fair uses the same authorize path then Factory bid/finalize/claim. LOCAL authorize is not full PROD (no Turnstile / isolated signer).",
  };

  const dep = loadDeployment(local);
  const rpc = process.env.ARC_TESTNET_RPC ?? process.env.RPC_URL ?? (local ? dep.rpc : dep.rpc || "https://rpc.testnet.arc.network");
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
    finish(journey, 2);
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
    finish(journey, 2);
    return;
  }

  const pk = process.env.ARC_TESTNET_PK ?? process.env.HARNESS_PK ?? "";
  if (!pk || (isAnvil0Key(pk) && !local)) {
    journey.steps.push({
      id: "wallet",
      status: "blocked",
      detail: local
        ? "HARNESS_PK / ARC_TESTNET_PK unset — local Anvil can use a documented test key via HARNESS_PK"
        : "No funded disposable key. Anvil #0 is refused on public testnet.",
    });
    journey.blockers.push("no funded trader key");
    finish(journey, 2);
    return;
  }

  const account = privateKeyToAccount(pk as `0x${string}`);
  const wallet = createWalletClient({
    account,
    chain: client.chain,
    transport: http(rpc),
  });
  journey.steps.push({ id: "wallet", status: "ok", detail: account.address });

  async function authorize(input: {
    ticker: string;
    name: string;
    mode: "standard" | "fair";
    description: string;
    duration?: number;
  }) {
    return indexerJson(indexer, "/launch/authorize", {
      wallet: account.address,
      quote: usdc,
      ticker: input.ticker,
      name: input.name,
      mode: input.mode,
      factory,
      factoryVersion: 1,
      image: "",
      description: input.description,
      website: "",
      twitter: "",
      telegram: "",
      ...(input.duration != null ? { duration: input.duration } : {}),
    });
  }

  try {
    const need = 20_000_000n;
    const usdcBal = await client.readContract({ address: usdc!, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
    if (usdcBal < need) {
      const mintHash = await wallet.writeContract({
        address: usdc!,
        abi: erc20Abi,
        functionName: "mint",
        args: [account.address, need],
      });
      await client.waitForTransactionReceipt({ hash: mintHash });
      journey.steps.push({
        id: "mint_quote",
        status: "ok",
        detail: `Mock USDC-6 mint ${need} (labeled rehearsal quote, not canonical 0x3600…0000)`,
        tx: mintHash,
        explorer: `${EXPLORER}/tx/${mintHash}`,
      });
    } else {
      journey.steps.push({ id: "mint_quote", status: "ok", detail: `quote balance ${usdcBal}` });
    }

    const resumeToken = (process.env.ARC_HARNESS_RESUME_TOKEN ?? "") as `0x${string}` | "";
    let token: `0x${string}` = "0x";

    if (resumeToken && resumeToken.length === 42) {
      token = resumeToken;
      journey.instantToken = token;
      journey.steps.push({
        id: "instant_launch",
        status: "ok",
        detail: `resume ${token} (prior authorize launch)`,
        tx: process.env.ARC_HARNESS_RESUME_TX,
        explorer: process.env.ARC_HARNESS_RESUME_TX ? `${EXPLORER}/tx/${process.env.ARC_HARNESS_RESUME_TX}` : undefined,
      });
    } else {
    const admit = await authorize({
      ticker,
      name: "Rehearsal",
      mode: "standard",
      description: "issue 16 rehearsal — not a production token",
    });
    if (admit.status !== 200) {
      journey.steps.push({
        id: "launch_authorize",
        status: "blocked",
        detail: `POST /launch/authorize HTTP ${admit.status} ${JSON.stringify(admit.body).slice(0, 280)}`,
      });
      journey.blockers.push("launch authorize failed (Turnstile / signer / indexer down)");
      finish(journey, 2);
      return;
    }
    const auth = admit.body.auth as Record<string, unknown> | undefined;
    const sig = admit.body.signature as `0x${string}` | undefined;
    if (!auth || !sig) {
      journey.steps.push({ id: "launch_authorize", status: "blocked", detail: "authorize returned 200 without auth/signature" });
      finish(journey, 2);
      return;
    }
    journey.steps.push({
      id: "launch_authorize",
      status: "ok",
      detail: `ALLOW + EIP-712 (${String(admit.body.signer ?? "signer")} / ${ticker})`,
    });

    const hash = await wallet.writeContract({
      address: factory!,
      abi: launchAbi,
      functionName: "launchStandard",
      gas: 8_000_000n,
      args: [
        {
          name: "Rehearsal",
          symbol: ticker,
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
        authTuple(auth),
        sig,
      ],
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    const created = parseEventLogs({ abi: launchAbi, logs: receipt.logs, eventName: "TokenCreated" })[0];
    token = (created?.args.token ?? "0x") as `0x${string}`;
    journey.instantToken = token;
    journey.steps.push({
      id: "instant_launch",
      status: receipt.status === "success" && token !== "0x" ? "ok" : "failed",
      detail: `token ${token} ticker ${ticker}`,
      tx: hash,
      explorer: `${EXPLORER}/tx/${hash}`,
    });
    if (receipt.status !== "success" || token === "0x") {
      journey.blockers.push("instant launch failed");
      finish(journey, 2);
      return;
    }

    const indexerDb = process.env.INDEXER_DB;
    if (indexerDb && existsSync(indexerDb)) {
      try {
        const { DatabaseSync } = await import("node:sqlite");
        const db = new DatabaseSync(indexerDb);
        db.prepare(
          `INSERT INTO markets(token,quote,pool_id,stage,market_live,fair_id,bonding_bps,real_quote,grad_target,price_quote_x18,price_usd6,fdv_usd6,volume_24h_quote,volume_24h_usd6,trades_24h,lifetime_rewards,image,description,updated_ts)
           VALUES(?,?,?,?,?,?,?,?,?,'0','0','0','0','0',0,'0',?,?,?)
           ON CONFLICT(token) DO UPDATE SET quote=excluded.quote, stage=excluded.stage`,
        ).run(
          token.toLowerCase(),
          usdc!.toLowerCase(),
          "",
          "bonding",
          0,
          "0",
          0,
          "0",
          "0",
          "",
          "issue 16 rehearsal",
          Math.floor(Date.now() / 1000),
        );
        db.close();
        journey.steps.push({
          id: "index_market",
          status: "ok",
          detail: "LOCAL INDEXER_DB bonding row (public RPC getLogs is topic-limited)",
        });
      } catch (e) {
        journey.steps.push({
          id: "index_market",
          status: "skipped",
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }
    }

    const curve = dep.addresses.InstantCurve as `0x${string}` | undefined;
    if (curve) {
      const appr = await wallet.writeContract({ address: usdc!, abi: erc20Abi, functionName: "approve", args: [curve, 2_000_000n] });
      await client.waitForTransactionReceipt({ hash: appr });
    }
    const apprR = await wallet.writeContract({ address: usdc!, abi: erc20Abi, functionName: "approve", args: [router!, 2_000_000n] });
    await client.waitForTransactionReceipt({ hash: apprR });
    journey.steps.push({ id: "approve_quote", status: "ok", detail: "USDC approve InstantCurve + UserRouteExecutor (quote sim + buy)" });

    let quoteBuy = { status: 0, body: {} as Record<string, unknown> };
    let minBuy = 0n;
    for (let i = 0; i < 20; i++) {
      quoteBuy = await indexerJson(
        indexer,
        "/quote",
        productionQuoteBody({
          side: "BUY",
          token,
          usdc: usdc!,
          amountIn: "1000000",
          slippageBps: 100,
          recipient: account.address,
        }),
      );
      minBuy = BigInt(String((quoteBuy.body.minOut ?? quoteBuy.body.minFinalOut ?? 0) as string));
      if (quoteBuy.status === 200 && minBuy > 1n) break;
      await sleep(2_500);
    }
    if (quoteBuy.status !== 200 || minBuy <= 1n) {
      journey.steps.push({
        id: "quote_buy",
        status: "blocked",
        detail: `POST /quote BUY HTTP ${quoteBuy.status} ${JSON.stringify(quoteBuy.body).slice(0, 220)} — refuse minOut≤1`,
      });
      journey.blockers.push("quote BUY unavailable");
      finish(journey, 2);
      return;
    }
    journey.steps.push({ id: "quote_buy", status: "ok", detail: `minOut ${minBuy}` });
    if (process.env.ARC_HARNESS_SKIP_BUY === "1") {
      journey.steps.push({
        id: "buy",
        status: "ok",
        detail: "skip buy — already executed",
        tx: process.env.ARC_HARNESS_RESUME_BUY_TX,
        explorer: process.env.ARC_HARNESS_RESUME_BUY_TX ? `${EXPLORER}/tx/${process.env.ARC_HARNESS_RESUME_BUY_TX}` : undefined,
      });
    } else {
    const buyHash = await wallet.writeContract({
      address: router!,
      abi: routeAbi,
      functionName: "buy",
      gas: 4_000_000n,
      args: [token, 1_000_000n, [], minBuy, BigInt(Math.floor(Date.now() / 1000) + 180)],
    });
    const buyRcpt = await client.waitForTransactionReceipt({ hash: buyHash });
    journey.steps.push({
      id: "buy",
      status: buyRcpt.status === "success" ? "ok" : "failed",
      detail: "UserRouteExecutor.buy exact-in, nonzero minOut, empty hops (USDC Instant)",
      tx: buyHash,
      explorer: `${EXPLORER}/tx/${buyHash}`,
    });
    if (buyRcpt.status !== "success") {
      journey.blockers.push("buy failed");
      finish(journey, 2);
      return;
    }
    }

    const bal = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
    const sellAmt = bal / 4n;
    if (curve) {
      const apprTok = await wallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [curve, sellAmt] });
      await client.waitForTransactionReceipt({ hash: apprTok });
    }
    const quoteSell = await indexerJson(
      indexer,
      "/quote",
      productionQuoteBody({
        side: "SELL",
        token,
        usdc: usdc!,
        amountIn: sellAmt.toString(),
        slippageBps: 100,
        recipient: account.address,
      }),
    );
    const minQuoteOut = BigInt(String((quoteSell.body.minQuoteOut ?? 0) as string));
    const minFinalOut = BigInt(String((quoteSell.body.minOut ?? quoteSell.body.minFinalOut ?? 0) as string));
    if (quoteSell.status !== 200 || minQuoteOut <= 1n || minFinalOut <= 1n) {
      journey.steps.push({
        id: "quote_sell",
        status: "blocked",
        detail: `POST /quote SELL HTTP ${quoteSell.status} ${JSON.stringify(quoteSell.body).slice(0, 240)} — refuse zero floors`,
      });
      journey.blockers.push("quote SELL unavailable");
      finish(journey, 2);
      return;
    }
    journey.steps.push({ id: "quote_sell", status: "ok", detail: `minQuoteOut ${minQuoteOut} minOut ${minFinalOut}` });
    await wallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [router!, sellAmt] });
    const sellHash = await wallet.writeContract({
      address: router!,
      abi: routeAbi,
      functionName: "sell",
      gas: 4_000_000n,
      args: [token, sellAmt, [], minQuoteOut, minFinalOut, BigInt(Math.floor(Date.now() / 1000) + 180)],
    });
    const sellRcpt = await client.waitForTransactionReceipt({ hash: sellHash });
    journey.steps.push({
      id: "sell",
      status: sellRcpt.status === "success" ? "ok" : "failed",
      detail: "UserRouteExecutor.sell with minQuoteOut + minFinalOut",
      tx: sellHash,
      explorer: `${EXPLORER}/tx/${sellHash}`,
    });
    if (sellRcpt.status !== "success") journey.blockers.push("sell failed");

    if (skipFair) {
      journey.steps.push({ id: "fair", status: "skipped", detail: "--skip-fair" });
    } else {
      const fairAdmit = await authorize({
        ticker: fairTicker,
        name: "Rehearsal Fair",
        mode: "fair",
        description: "issue 16 fair rehearsal — not a production token",
        duration: fairDuration,
      });
      if (fairAdmit.status !== 200 || !fairAdmit.body.auth || !fairAdmit.body.signature) {
        journey.steps.push({
          id: "fair_authorize",
          status: "blocked",
          detail: `POST /launch/authorize fair HTTP ${fairAdmit.status} ${JSON.stringify(fairAdmit.body).slice(0, 220)}`,
        });
        journey.blockers.push("fair authorize failed");
      } else {
        journey.steps.push({ id: "fair_authorize", status: "ok", detail: `ALLOW + EIP-712 ${fairTicker}` });
        const fairHash = await wallet.writeContract({
          address: factory!,
          abi: launchAbi,
          functionName: "createFairLaunch",
          gas: 8_000_000n,
          args: [
            {
              name: "Rehearsal Fair",
              symbol: fairTicker,
              decimals: 18,
              supply: 0n,
              quote: usdc!,
              duration: BigInt(fairDuration),
              auctionBps: 5_000,
              minRaise: 0n,
              image: "",
              description: "issue 16 fair rehearsal — not a production token",
              website: "",
              twitter: "",
              telegram: "",
            },
            authTuple(fairAdmit.body.auth as Record<string, unknown>),
            fairAdmit.body.signature as `0x${string}`,
          ],
        });
        const fairRcpt = await client.waitForTransactionReceipt({ hash: fairHash });
        const fairCreated = parseEventLogs({
          abi: launchAbi,
          logs: fairRcpt.logs,
          eventName: "BatchFairLaunchCreated",
        })[0];
        const fairToken = fairCreated?.args.token;
        const fairId = fairCreated?.args.fairId;
        journey.fairToken = fairToken;
        journey.fairId = fairId?.toString();
        journey.steps.push({
          id: "fair_create",
          status: fairRcpt.status === "success" ? "ok" : "failed",
          detail: `token ${fairToken} fairId ${fairId} ticker ${fairTicker}`,
          tx: fairHash,
          explorer: `${EXPLORER}/tx/${fairHash}`,
        });
        if (fairRcpt.status === "success" && fairId != null) {
          const bidAmt = 5_000_000n;
          const bidAppr = await wallet.writeContract({ address: usdc!, abi: erc20Abi, functionName: "approve", args: [factory!, bidAmt] });
          await client.waitForTransactionReceipt({ hash: bidAppr });
          const bidHash = await wallet.writeContract({
            address: factory!,
            abi: launchAbi,
            functionName: "bid",
            args: [fairId, bidAmt],
          });
          const bidRcpt = await client.waitForTransactionReceipt({ hash: bidHash });
          journey.steps.push({
            id: "fair_bid",
            status: bidRcpt.status === "success" ? "ok" : "failed",
            detail: `bid ${bidAmt}`,
            tx: bidHash,
            explorer: `${EXPLORER}/tx/${bidHash}`,
          });
          await sleep((fairDuration + 5) * 1000);
          const finHash = await wallet.writeContract({
            address: factory!,
            abi: launchAbi,
            functionName: "finalizeFairLaunch",
            gas: 6_000_000n,
            args: [fairId],
          });
          const finRcpt = await client.waitForTransactionReceipt({ hash: finHash });
          journey.steps.push({
            id: "fair_finalize",
            status: finRcpt.status === "success" ? "ok" : "failed",
            detail: "finalizeFairLaunch",
            tx: finHash,
            explorer: `${EXPLORER}/tx/${finHash}`,
          });
          const claimHash = await wallet.writeContract({
            address: factory!,
            abi: launchAbi,
            functionName: "claimFairTokens",
            args: [fairId, account.address],
          });
          const claimRcpt = await client.waitForTransactionReceipt({ hash: claimHash });
          journey.steps.push({
            id: "fair_claim",
            status: claimRcpt.status === "success" ? "ok" : "failed",
            detail: "claimFairTokens",
            tx: claimHash,
            explorer: `${EXPLORER}/tx/${claimHash}`,
          });
        } else {
          journey.blockers.push("fair create failed");
        }
      }
    }
  } catch (e) {
    journey.steps.push({ id: "journey", status: "failed", detail: e instanceof Error ? e.message : String(e) });
    journey.blockers.push(e instanceof Error ? e.message : String(e));
  }

  if (local) {
    journey.note += " This run used --local (Anvil). Not Arc Public Testnet. claimedArcTestnet remains false.";
    journey.claimedArcTestnet = false;
  } else {
    const okSteps = journey.steps.filter((s) => s.status === "ok" && s.tx);
    const failed = journey.steps.some((s) => s.status === "failed" || s.status === "blocked") || journey.blockers.length > 0;
    journey.claimedArcTestnet = Boolean(dep.claimedArcTestnet && !failed && okSteps.length >= 3);
  }

  writeFileSync(outPath, JSON.stringify(journey, null, 2) + "\n");
  console.log(JSON.stringify(journey, null, 2));
  if (journey.blockers.length || journey.steps.some((s) => s.status === "failed" || s.status === "blocked")) {
    process.exit(2);
  }
}

void main();
