import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "node:crypto";
import { arcLocal } from "@/lib/chain";
import { addresses } from "@/lib/addresses";
import { fdvQuoteRaw, readSqrtPriceX96 } from "@/lib/marketdata";
import { poolId } from "@/lib/pool";
import { valueQuoteUsd6, type QuoteNode } from "../../../../../packages/reactor/src/valuation.ts";

/**
 * Short-lived unique EIP-712 LaunchPricingAuthorization for non-usdPegOne quotes.
 * virtualQuote0 targets ~$5k USD-equivalent. No serial quote nonce.
 */
const ANVIL0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const factoryAbi = parseAbi([
  "function virtualQuote0ForUsd(address quote, uint256 quoteUsd6) view returns (uint256)",
  "function instantCurveConfig() view returns (bytes32)",
]);

const erc20Abi = parseAbi(["function decimals() view returns (uint8)"]);
const registryAbi = parseAbi([
  "function usdc() view returns (address)",
  "function isUsdPegOne(address) view returns (bool)",
  "function get(address) view returns (address token, string symbol, string name, uint8 decimals, string icon, uint8 category, bool enabled, bool exists, bool rewardsEnabled, bool buybackRouteEnabled, bool hopViaUsdc, bool reactorNative, bool usdPegOne)",
]);

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { quote?: string; creator?: string };
    const quote = body.quote as `0x${string}` | undefined;
    const creator = (body.creator ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;
    if (!quote || !/^0x[0-9a-fA-F]{40}$/.test(quote)) {
      return NextResponse.json({ error: "quote required" }, { status: 400 });
    }

    const client = createPublicClient({ chain: arcLocal, transport: http(arcLocal.rpcUrls.default.http[0]) });
    const peg = await client.readContract({
      address: addresses.QuoteAssetRegistry,
      abi: registryAbi,
      functionName: "isUsdPegOne",
      args: [quote],
    });
    if (peg) {
      return NextResponse.json({ needsAuth: false, reason: "usdPegOne — unsigned Instant is allowed" });
    }

    const asset = await client.readContract({
      address: addresses.QuoteAssetRegistry,
      abi: registryAbi,
      functionName: "get",
      args: [quote],
    });
    if (Number(asset[5]) === 4 && !Boolean(asset[12])) {
      // Stablecoins category is NOT $1 (EURC).
    }

    const quoteDecimals = Number(
      await client.readContract({ address: quote, abi: erc20Abi, functionName: "decimals" }),
    );
    const quoteUsd6 = await hopQuoteUsd6(client, quote, quoteDecimals);
    if (quoteUsd6 === 0n) {
      return NextResponse.json(
        { error: "cannot price quote — valuation unavailable, launch disabled for this quote", needsAuth: true },
        { status: 422 },
      );
    }

    const [virtualQuote0, curveConfig] = await Promise.all([
      client.readContract({
        address: addresses.ReactorFactory,
        abi: factoryAbi,
        functionName: "virtualQuote0ForUsd",
        args: [quote, quoteUsd6],
      }),
      client.readContract({
        address: addresses.ReactorFactory,
        abi: factoryAbi,
        functionName: "instantCurveConfig",
      }),
    ]);

    const pk = (process.env.PRICING_SIGNER_PK ?? ANVIL0) as `0x${string}`;
    const account = privateKeyToAccount(pk);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 5 * 60);
    const chainId = BigInt(arcLocal.id);
    const salt = (`0x${randomBytes(32).toString("hex")}`) as `0x${string}`;
    const auth = {
      factory: addresses.ReactorFactory,
      creator,
      quote,
      quoteDecimals,
      virtualQuote0: virtualQuote0.toString(),
      curveConfig,
      salt,
      deadline: deadline.toString(),
    };

    const signature = await account.signTypedData({
      domain: {
        name: "REACTOR",
        version: "1",
        chainId: Number(chainId),
        verifyingContract: addresses.ReactorFactory,
      },
      types: {
        LaunchPricingAuthorization: [
          { name: "factory", type: "address" },
          { name: "creator", type: "address" },
          { name: "quote", type: "address" },
          { name: "quoteDecimals", type: "uint8" },
          { name: "virtualQuote0", type: "uint256" },
          { name: "curveConfig", type: "bytes32" },
          { name: "salt", type: "bytes32" },
          { name: "deadline", type: "uint256" },
          { name: "chainId", type: "uint256" },
        ],
      },
      primaryType: "LaunchPricingAuthorization",
      message: {
        factory: addresses.ReactorFactory,
        creator,
        quote,
        quoteDecimals,
        virtualQuote0,
        curveConfig,
        salt,
        deadline,
        chainId,
      },
    });

    return NextResponse.json({
      needsAuth: true,
      auth,
      signature,
      signer: account.address,
      quoteUsd6: quoteUsd6.toString(),
      ttlSec: 300,
      trust: "Operational launch-pricing signer. Not an onchain USD oracle. Unique digest. usdPegOne-only $1 bypass.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "pricing sign failed", needsAuth: true },
      { status: 500 },
    );
  }
}

async function hopQuoteUsd6(
  client: ReturnType<typeof createPublicClient>,
  quote: `0x${string}`,
  qDec: number,
): Promise<bigint> {
  const usdc = addresses.USDC;
  const nodes = new Map<string, QuoteNode>([
    [usdc.toLowerCase(), { token: usdc, symbol: "USDC", decimals: 6, usdPegOne: true }],
  ]);
  const direct = valueQuoteUsd6(usdc, nodes);
  if (quote.toLowerCase() === usdc.toLowerCase()) return direct.usd6;

  const [c0, c1] = quote.toLowerCase() < usdc.toLowerCase() ? [quote, usdc] : [usdc, quote];
  const hop = {
    currency0: c0 as `0x${string}`,
    currency1: c1 as `0x${string}`,
    fee: 3000,
    tickSpacing: 60,
    hooks: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  };
  const sqrt = await readSqrtPriceX96(client, poolId(hop));
  if (!sqrt) return 0n;
  const quoteIs0 = quote.toLowerCase() < usdc.toLowerCase();
  const one = 10n ** BigInt(qDec);
  return fdvQuoteRaw(sqrt, one, quoteIs0);
}
