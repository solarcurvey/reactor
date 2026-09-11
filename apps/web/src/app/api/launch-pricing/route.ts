import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcLocal } from "@/lib/chain";
import { addresses } from "@/lib/addresses";
import { fdvQuoteRaw, readSqrtPriceX96 } from "@/lib/marketdata";
import { poolId } from "@/lib/pool";

/**
 * Short-lived EIP-712 LaunchPricingAuthorization for non-$1 quotes.
 * Computes virtualQuote0 so start FDV is ~$5k USD-equivalent from the hop book.
 * Not an onchain ZEC/USD oracle.
 */
const ANVIL0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const factoryAbi = parseAbi([
  "function pricingNonce(address) view returns (uint256)",
  "function virtualQuote0ForUsd(address quote, uint256 quoteUsd6) view returns (uint256)",
]);

const erc20Abi = parseAbi(["function decimals() view returns (uint8)"]);
const registryAbi = parseAbi([
  "function usdc() view returns (address)",
  "function get(address) view returns (address token, string symbol, string name, uint8 decimals, string icon, uint8 category, bool enabled, bool exists, bool rewardsEnabled, bool buybackRouteEnabled, bool hopViaUsdc, bool reactorNative)",
]);

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { quote?: string };
    const quote = body.quote as `0x${string}` | undefined;
    if (!quote || !/^0x[0-9a-fA-F]{40}$/.test(quote)) {
      return NextResponse.json({ error: "quote required" }, { status: 400 });
    }

    const client = createPublicClient({ chain: arcLocal, transport: http(arcLocal.rpcUrls.default.http[0]) });
    const usdc = addresses.USDC.toLowerCase();
    if (quote.toLowerCase() === usdc) {
      return NextResponse.json({ needsAuth: false, reason: "USDC is $1 — unsigned Instant is allowed" });
    }

    const asset = await client.readContract({
      address: addresses.QuoteAssetRegistry,
      abi: registryAbi,
      functionName: "get",
      args: [quote],
    });
    const category = Number(asset[5]);
    if (category === 4) {
      return NextResponse.json({ needsAuth: false, reason: "Stablecoins category — unsigned Instant is allowed" });
    }

    const quoteDecimals = Number(
      await client.readContract({ address: quote, abi: erc20Abi, functionName: "decimals" }),
    );
    const quoteUsd6 = await hopQuoteUsd6(client, quote, quoteDecimals);
    if (quoteUsd6 === 0n) {
      return NextResponse.json(
        { error: "cannot price quote — no hop book, fail closed", needsAuth: true },
        { status: 422 },
      );
    }

    const [nonce, virtualQuote0] = await Promise.all([
      client.readContract({ address: addresses.ReactorFactory, abi: factoryAbi, functionName: "pricingNonce", args: [quote] }),
      client.readContract({
        address: addresses.ReactorFactory,
        abi: factoryAbi,
        functionName: "virtualQuote0ForUsd",
        args: [quote, quoteUsd6],
      }),
    ]);

    const pk = (process.env.PRICING_SIGNER_PK ?? ANVIL0) as `0x${string}`;
    const account = privateKeyToAccount(pk);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 5 * 60);
    const chainId = BigInt(arcLocal.id);
    const auth = {
      factory: addresses.ReactorFactory,
      quote,
      quoteDecimals,
      virtualQuote0: virtualQuote0.toString(),
      nonce: nonce.toString(),
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
          { name: "quote", type: "address" },
          { name: "quoteDecimals", type: "uint8" },
          { name: "virtualQuote0", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "chainId", type: "uint256" },
        ],
      },
      primaryType: "LaunchPricingAuthorization",
      message: {
        factory: addresses.ReactorFactory,
        quote,
        quoteDecimals,
        virtualQuote0,
        nonce,
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
      trust: "Operational Keeper / launch-pricing signer. Not an onchain USD oracle. virtualQuote0 targets ~$5k start FDV.",
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
