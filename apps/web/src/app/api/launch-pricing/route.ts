import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcLocal } from "@/lib/chain";
import { addresses } from "@/lib/addresses";

/**
 * Short-lived EIP-712 LaunchPricingAuthorization for non-$1 quotes.
 * Local fallback: Anvil account 0 (same as default Deploy keeper / pricingSigner).
 * Not an onchain ZEC/USD oracle.
 */
const ANVIL0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const factoryAbi = parseAbi([
  "function pricingNonce(address) view returns (uint256)",
  "function expectedVirtualQuote0(address) view returns (uint256)",
  "function usdc() view returns (address)",
]);

const erc20Abi = parseAbi(["function decimals() view returns (uint8)"]);
const registryAbi = parseAbi([
  "function usdc() view returns (address)",
  "function get(address) view returns (address token, string symbol, string name, uint8 decimals, string icon, uint8 category, address usdOracle, bool enabled, bool exists, bool rewardsEnabled, bool buybackRouteEnabled, bool hopViaUsdc, bool reactorNative)",
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

    const [nonce, virtualQuote0, quoteDecimals] = await Promise.all([
      client.readContract({ address: addresses.ReactorFactory, abi: factoryAbi, functionName: "pricingNonce", args: [quote] }),
      client.readContract({
        address: addresses.ReactorFactory,
        abi: factoryAbi,
        functionName: "expectedVirtualQuote0",
        args: [quote],
      }),
      client.readContract({ address: quote, abi: erc20Abi, functionName: "decimals" }),
    ]);

    const pk = (process.env.PRICING_SIGNER_PK ?? ANVIL0) as `0x${string}`;
    const account = privateKeyToAccount(pk);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 5 * 60);
    const chainId = BigInt(arcLocal.id);
    const auth = {
      factory: addresses.ReactorFactory,
      quote,
      quoteDecimals: Number(quoteDecimals),
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
        quoteDecimals: Number(quoteDecimals),
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
      ttlSec: 300,
      trust: "Operational Keeper / launch-pricing signer. Not an onchain USD oracle.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "pricing sign failed", needsAuth: true },
      { status: 500 },
    );
  }
}
