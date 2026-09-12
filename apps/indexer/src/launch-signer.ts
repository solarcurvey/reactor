/**
 * Isolated launch signer. No LaunchAuthorization without a verified ALLOW receipt.
 * FAIL closed if key missing or durable store unavailable. Anvil key only when REACTOR_ENV=LOCAL.
 */
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "node:crypto";
import { createPublicClient, http, parseAbi } from "viem";
import { defineChain } from "viem";
import deployment from "./deployment.json" with { type: "json" };
import { launchBlockedByValuation } from "../../../packages/reactor/src/pricing.ts";
import { normalizeTicker } from "../../../packages/reactor/src/ticker.ts";
import {
  INSTANT_CURVE_V1,
  LAUNCH_AUTH_TYPES,
  MODE_FAIR,
  MODE_REWARDS,
  MODE_STANDARD,
  hashMetadata,
  authMode,
  fairCurveConfig,
  launchConfigHash,
  resolveFairParams,
} from "../../../packages/reactor/src/launch-auth.ts";
import { consumeIssuanceToken, consumeReceipt, verifyReceipt } from "./admission.ts";
import { openStore, type Store } from "./db.ts";
import { loadValuationService } from "./valuation-store.ts";
import { ANVIL0_PK, isLocalEnv } from "./prod-gates.ts";
import { ARC_NATIVE_GAS } from "./arc-chain.ts";

/** Isolated signer must not mint LaunchAuthorization without durable receipt + bucket state. */
export const SIGNER_STORE_UNAVAILABLE = "SIGNER_STORE_UNAVAILABLE";

export function requireDurableStore(store: Store | undefined | null): asserts store is Store {
  if (!store) throw new Error(SIGNER_STORE_UNAVAILABLE);
}

/** Open the durable store. Never coerce failure to undefined. */
export async function openSignerStore(open: () => Promise<Store> = openStore): Promise<Store> {
  try {
    const store = await open();
    requireDurableStore(store);
    return store;
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith(SIGNER_STORE_UNAVAILABLE)) throw cause;
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${SIGNER_STORE_UNAVAILABLE}: ${detail}`);
  }
}

/**
 * Atomic receipt consume + signed-auth issuance bucket. Fail closed if the
 * receipt has no durable id or either consume cannot complete.
 */
export async function consumeDurableAdmission(store: Store, rec: Record<string, unknown>): Promise<void> {
  if (!rec.id) throw new Error("INVALID_ADMISSION_RECEIPT");
  const consumed = await consumeReceipt(store, String(rec.id));
  if (!consumed) throw new Error("ADMISSION_RECEIPT_CONSUMED");
  const bucket = await consumeIssuanceToken(store);
  if (!bucket.ok) throw new Error("LAUNCH_ISSUANCE_THROTTLED");
}

/** Map signer errors. Store / key unavailability is 503, not 403. */
export function signerHttpStatus(error: unknown): number {
  const msg = error instanceof Error ? error.message : "sign failed";
  if (msg.includes("UNAVAILABLE") || msg.includes("cannot price")) return 503;
  if (msg.includes("ADMISSION") || msg.includes("SIGNER_") || msg.includes("LAUNCH_ISSUANCE")) return 403;
  return 500;
}

const LOCAL = isLocalEnv();
const ANVIL0 = ANVIL0_PK;
const addrs = deployment.addresses as Record<string, string>;

export function resolveSignerKey(): `0x${string}` {
  const env = process.env.PRICING_SIGNER_PK;
  if (env && env.length >= 10) {
    if (!LOCAL && env.toLowerCase() === ANVIL0) {
      throw new Error("PRICING_SIGNER_UNAVAILABLE: Anvil #0 key forbidden outside LOCAL");
    }
    return env as `0x${string}`;
  }
  if (LOCAL && deployment.chainId === 5042002) return ANVIL0;
  throw new Error("PRICING_SIGNER_UNAVAILABLE");
}

const factoryAbi = parseAbi([
  "function virtualQuote0ForUsd(address quote, uint256 quoteUsd6) view returns (uint256)",
  "function instantCurveConfig() view returns (bytes32)",
]);
const erc20Abi = parseAbi(["function decimals() view returns (uint8)"]);

const chain = defineChain({
  id: deployment.chainId,
  name: "reactor",
  nativeCurrency: { ...ARC_NATIVE_GAS },
  rpcUrls: { default: { http: [process.env.RPC_URL ?? deployment.rpc] } },
});
const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });

export type SignRequest = {
  quote?: string;
  creator?: string;
  ticker?: string;
  mode?: string;
  name?: string;
  image?: string;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  receipt?: string;
  factory?: string;
  factoryVersion?: number;
  supply?: string | number;
  decimals?: number;
  duration?: number;
  auctionBps?: number;
  minRaise?: string | number;
};

export function assertInternalOrReceipt(opts: {
  receipt?: string;
  internalToken?: string;
  remoteAddress?: string;
}): { ok: true; receipt: Record<string, unknown> } | { ok: false; error: string } {
  const expected = process.env.SIGNER_INTERNAL_TOKEN;
  const loopback = !opts.remoteAddress || opts.remoteAddress === "127.0.0.1" || opts.remoteAddress === "::1" || opts.remoteAddress === ":ffff:127.0.0.1";
  const internalOk = Boolean(expected && opts.internalToken && opts.internalToken === expected && loopback);
  if (!opts.receipt) {
    return { ok: false, error: "SIGNER_REQUIRES_ADMISSION" };
  }
  const parsed = verifyReceipt(opts.receipt);
  if (!parsed) return { ok: false, error: "INVALID_ADMISSION_RECEIPT" };
  if (!internalOk && !loopback && process.env.REACTOR_ENV?.toUpperCase() === "PROD") {
    return { ok: false, error: "SIGNER_NOT_PUBLIC" };
  }
  return { ok: true, receipt: parsed };
}

export async function signAuthorized(
  store: Store | undefined,
  body: SignRequest,
  gate: { receipt?: string; internalToken?: string; remoteAddress?: string },
) {
  const authz = assertInternalOrReceipt(gate);
  if (!authz.ok) throw new Error(authz.error);
  requireDurableStore(store);
  const rec = authz.receipt;
  await consumeDurableAdmission(store, rec);

  const key = resolveSignerKey();
  if (process.env.KEEPER_PRIVATE_KEY && process.env.KEEPER_PRIVATE_KEY === key) {
    throw new Error("launch signer must not reuse keeper key");
  }
  const quote = (body.quote ?? rec.quote) as `0x${string}`;
  const creator = ((body.creator ?? rec.creator) || "0x0000000000000000000000000000000000000000") as `0x${string}`;
  if (!quote || !/^0x[0-9a-fA-F]{40}$/.test(quote)) throw new Error("quote required");
  const ticker = normalizeTicker(String(body.ticker ?? rec.ticker ?? ""));
  if (rec.ticker && String(rec.ticker).toUpperCase() !== ticker) throw new Error("receipt ticker mismatch");
  if (rec.creator && String(rec.creator) && String(rec.creator) !== creator.toLowerCase()) {
    throw new Error("receipt creator mismatch");
  }
  const registry = addrs.TickerRegistry as `0x${string}` | undefined;
  if (!registry) throw new Error("TickerRegistry missing");

  const quoteDecimals = Number(await client.readContract({ address: quote, abi: erc20Abi, functionName: "decimals" }));
  const now = Math.floor(Date.now() / 1000);

  const svc = await loadValuationService(store);
  const valued = svc.quoteUsd6(quote);
  const blocked = launchBlockedByValuation(valued);
  if (blocked) throw new Error(blocked);

  const virtualQuote0 = await client.readContract({
    address: addrs.ReactorFactory as `0x${string}`,
    abi: factoryAbi,
    functionName: "virtualQuote0ForUsd",
    args: [quote, valued.usd6],
  });
  const path = body.mode === "fair" ? "fair" : body.mode === "standard" ? "standard" : "rewards";
  const fair = resolveFairParams({
    supply: body.supply,
    decimals: body.decimals,
    duration: body.duration,
    auctionBps: body.auctionBps,
    minRaise: body.minRaise,
  });
  const curveConfig = path === "fair"
    ? fairCurveConfig(fair.supply, fair.decimals, fair.duration, fair.auctionBps, fair.minRaise)
    : INSTANT_CURVE_V1;
  const mode = authMode(path);
  const name = String(body.name ?? rec.name ?? ticker);
  const metadataHash = hashMetadata(
    String(body.image ?? ""),
    String(body.description ?? ""),
    String(body.website ?? ""),
    String(body.twitter ?? ""),
    String(body.telegram ?? ""),
  );
  const factory = (addrs.ReactorFactory ?? body.factory) as `0x${string}`;
  const expectedHash = launchConfigHash({
    creator: creator.toLowerCase(),
    ticker,
    name,
    metadataHash,
    quote: quote.toLowerCase(),
    mode,
    factory: factory.toLowerCase(),
    factoryVersion: Number(body.factoryVersion ?? rec.factoryVersion ?? 1),
    curveConfig,
  });
  if (rec.launchConfigHash && String(rec.launchConfigHash).toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error("receipt launchConfigHash mismatch");
  }
  const account = privateKeyToAccount(key);
  const deadline = BigInt(now + 5 * 60);
  const authId = (`0x${randomBytes(32).toString("hex")}`) as `0x${string}`;
  const signature = await account.signTypedData({
    domain: { name: "REACTOR", version: "1", chainId: deployment.chainId, verifyingContract: registry },
    types: LAUNCH_AUTH_TYPES,
    primaryType: "LaunchAuthorization",
    message: {
      factory,
      factoryVersion: 1,
      creator,
      quote,
      quoteDecimals,
      mode,
      ticker,
      name,
      metadataHash,
      virtualQuote0: path === "fair" ? 0n : virtualQuote0,
      curveConfig,
      authId,
      deadline,
      chainId: BigInt(deployment.chainId),
    },
  });

  return {
    needsAuth: true,
    ticker,
    auth: {
      factory,
      factoryVersion: 1,
      creator,
      quote,
      quoteDecimals,
      mode,
      ticker,
      name,
      metadataHash,
      virtualQuote0: (path === "fair" ? 0n : virtualQuote0).toString(),
      curveConfig,
      authId,
      deadline: deadline.toString(),
    },
    signature,
    signer: account.address,
    quoteUsd6: valued.usd6.toString(),
    ancestry: valued.ancestry,
    ttlSec: 300,
    trust:
      "Isolated Launch Signer. Full launch identity bound. Admission receipt required. Not an onchain USD oracle. Every launch including USDC.",
  };
}

export { MODE_FAIR, MODE_REWARDS, MODE_STANDARD };
