import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import { writeFileSync } from "node:fs";
import deployment from "./deployment.json" with { type: "json" };
import factoryAbi from "./abi/ReactorFactory.json" with { type: "json" };
import routerAbi from "./abi/ReactorRouter.json" with { type: "json" };
import tokenAbi from "./abi/ReactorToken.json" with { type: "json" };
import erc20Abi from "./abi/MockERC20.json" with { type: "json" };
import buybackAbi from "./abi/BuybackVault.json" with { type: "json" };
import hookAbi from "./abi/ReactorHook.json" with { type: "json" };

const RPC = process.env.RPC_URL ?? deployment.rpc;
const A = deployment.addresses;

const chain = defineChain({
  id: deployment.chainId,
  name: "reactor-local",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

// Standard anvil keys 0-3
const ANVIL = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
] as Hex[];

const publicClient = createPublicClient({ chain, transport: http(RPC) });

function wallet(i: number) {
  const account = privateKeyToAccount(ANVIL[i]);
  return {
    account,
    client: createWalletClient({ account, chain, transport: http(RPC) }),
  };
}

function poolKey(token: Address, quote: Address) {
  const [currency0, currency1] = token.toLowerCase() < quote.toLowerCase() ? [token, quote] : [quote, token];
  return {
    currency0,
    currency1,
    fee: 0,
    tickSpacing: 60,
    hooks: A.ReactorHook as Address, // must match factory.hook() — CREATE2 changes if hook bytecode changes
  };
}

function feeSplit(notional: bigint) {
  const holders = (notional * 200n) / 10_000n;
  const buyback = (notional * 100n) / 10_000n;
  return { holders, buyback, fee: holders + buyback };
}

async function send(
  w: ReturnType<typeof wallet>,
  params: Parameters<typeof w.client.writeContract>[0],
) {
  const hash = await w.client.writeContract(params);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`tx failed ${hash}`);
  return { hash, receipt };
}

async function main() {
  const evidence: Record<string, unknown> = {
    network: deployment.network,
    claimedArcTestnet: false,
    chainId: await publicClient.getChainId(),
    rpc: RPC,
    startedAt: new Date().toISOString(),
    addresses: A,
    steps: [] as Record<string, unknown>[],
  };
  const steps = evidence.steps as Record<string, unknown>[];
  const log = (step: string, data: Record<string, unknown>) => {
    console.log(`\n== ${step} ==`);
    console.log(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    steps.push({ step, ...data });
  };

  const deployer = wallet(0);
  const alice = wallet(1);
  const bob = wallet(2);
  const carol = wallet(3);

  log("1_connect", {
    deployer: deployer.account.address,
    alice: alice.account.address,
    bob: bob.account.address,
    carol: carol.account.address,
  });

  const code = await publicClient.getCode({ address: A.ReactorFactory as Address });
  if (!code || code === "0x") throw new Error("Factory missing — run Deploy.s.sol first");
  log("2_verify_deploy", { factory: A.ReactorFactory, factoryCodeBytes: code.length });

  const coreSupply = await publicClient.readContract({
    address: A.TestCORE as Address,
    abi: tokenAbi,
    functionName: "totalSupply",
  });
  log("3_testcore", { address: A.TestCORE, totalSupply: coreSupply.toString() });

  const coreBal = await publicClient.readContract({
    address: A.TestCORE as Address,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [A.PoolManager],
  });
  log("4_core_liquidity", { poolManagerCore: coreBal.toString(), note: "CORE/USDC hookless pool seeded at deploy" });

  const usdcOn = await publicClient.readContract({
    address: A.QuoteAssetRegistry as Address,
    abi: parseAbi(["function isEnabled(address) view returns (bool)"]),
    functionName: "isEnabled",
    args: [A.USDC as Address],
  });
  const zecOn = await publicClient.readContract({
    address: A.QuoteAssetRegistry as Address,
    abi: parseAbi(["function isEnabled(address) view returns (bool)"]),
    functionName: "isEnabled",
    args: [A.ZEC as Address],
  });
  log("5_register_usdc", { usdc: A.USDC, enabled: usdcOn });
  log("6_register_zec", { zec: A.ZEC, enabled: zecOn });

  // Fund traders
  for (const w of [alice, bob, carol]) {
    await send(deployer, {
      address: A.ZEC as Address,
      abi: erc20Abi,
      functionName: "mint",
      args: [w.account.address, 50_000n * 10n ** 8n],
    });
    await send(deployer, {
      address: A.USDC as Address,
      abi: erc20Abi,
      functionName: "mint",
      args: [w.account.address, 1_000_000n * 10n ** 6n],
    });
  }

  const zcat = await send(deployer, {
    address: A.ReactorFactory as Address,
    abi: factoryAbi,
    functionName: "instantLaunch",
    args: [
      {
        name: "ZCAT",
        symbol: "ZCAT",
        decimals: 18,
        supply: 0n,
        quote: A.ZEC,
        fdvQuoteRaw: 80_000n * 10n ** 8n,
        devBuyQuote: 0n,
        image: "/icons/zcat.svg",
        description: "Instant official market quoted in Mock ZEC.",
        website: "https://example.invalid/zcat",
        twitter: "",
        telegram: "",
      },
    ],
  });
  const created = await publicClient.getContractEvents({
    address: A.ReactorFactory as Address,
    abi: factoryAbi,
    eventName: "TokenCreated",
    fromBlock: zcat.receipt.blockNumber,
    toBlock: zcat.receipt.blockNumber,
  });
  const zcatToken = created[0]!.args.token as Address;
  const info = await publicClient.readContract({
    address: A.ReactorFactory as Address,
    abi: factoryAbi,
    functionName: "tokenInfo",
    args: [zcatToken],
  });
  const zcatPoolId = (info as { poolId: Hex }).poolId ?? (info as unknown as Hex[])[4];
  log("7_instant_zcat", {
    tx: zcat.hash,
    token: zcatToken,
    poolId: zcatPoolId,
    quote: A.ZEC,
  });

  async function buy(w: ReturnType<typeof wallet>, token: Address, quote: Address, amount: bigint) {
    await send(w, {
      address: quote,
      abi: erc20Abi,
      functionName: "approve",
      args: [A.ReactorRouter, amount],
    });
    const key = poolKey(token, quote);
    const zfo = quote.toLowerCase() < token.toLowerCase();
    return send(w, {
      address: A.ReactorRouter as Address,
      abi: routerAbi,
      functionName: "swap",
      args: [key, zfo, -amount, 0n, w.account.address],
    });
  }

  async function sell(w: ReturnType<typeof wallet>, token: Address, quote: Address, amount: bigint) {
    await send(w, {
      address: token,
      abi: tokenAbi,
      functionName: "approve",
      args: [A.ReactorRouter, amount],
    });
    const key = poolKey(token, quote);
    const zfo = token.toLowerCase() < quote.toLowerCase();
    return send(w, {
      address: A.ReactorRouter as Address,
      abi: routerAbi,
      functionName: "swap",
      args: [key, zfo, -amount, 0n, w.account.address],
    });
  }

  const buyAlice = 3_000n * 10n ** 8n;
  const buyBob = 2_000n * 10n ** 8n;
  const txA = await buy(alice, zcatToken, A.ZEC as Address, buyAlice);
  const txB = await buy(bob, zcatToken, A.ZEC as Address, buyBob);
  const aliceBal = (await publicClient.readContract({
    address: zcatToken,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [alice.account.address],
  })) as bigint;
  const bobBal = (await publicClient.readContract({
    address: zcatToken,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [bob.account.address],
  })) as bigint;
  log("8_multi_buy", {
    aliceTx: txA.hash,
    bobTx: txB.hash,
    aliceTokens: aliceBal.toString(),
    bobTokens: bobBal.toString(),
    expectedFeeAlice: feeSplit(buyAlice),
    expectedFeeBob: feeSplit(buyBob),
  });

  const sellAmt = aliceBal / 4n;
  const txSell = await sell(alice, zcatToken, A.ZEC as Address, sellAmt);
  log("9_sell", { tx: txSell.hash, sold: sellAmt.toString() });

  const aliceRewards = (await publicClient.readContract({
    address: zcatToken,
    abi: tokenAbi,
    functionName: "pendingRewards",
    args: [alice.account.address],
  })) as bigint;
  const lifetime = (await publicClient.readContract({
    address: zcatToken,
    abi: tokenAbi,
    functionName: "lifetimeRewards",
  })) as bigint;
  const buyA = feeSplit(buyAlice);
  const buyB = feeSplit(buyBob);
  log("10_zec_rewards", {
    alicePending: aliceRewards.toString(),
    lifetimeRewards: lifetime.toString(),
    expectedHoldersFromBuys: (buyA.holders + buyB.holders).toString(),
    note: "Sell also credits 2% of its quote notional; lifetime >= buy holders.",
  });
  if (aliceRewards === 0n) throw new Error("Alice should have ZEC rewards");
  if (lifetime < buyA.holders + buyB.holders) throw new Error("lifetime rewards below expected buy holders");

  const zecReserve = (await publicClient.readContract({
    address: A.BuybackVault as Address,
    abi: buybackAbi,
    functionName: "accrued",
    args: [A.ZEC],
  })) as bigint;
  log("11_buyback_reserve_zec", {
    accruedZec: zecReserve.toString(),
    expectedBuybackFromBuys: (buyA.buyback + buyB.buyback).toString(),
    note: "ZEC route unset (CORE pool is USDC). Reserve pending — by design.",
  });
  if (zecReserve === 0n) throw new Error("ZEC buyback reserve empty");

  const beforeTransfer = aliceBal - sellAmt;
  const hop = beforeTransfer / 10n;
  const balBefore = (await publicClient.readContract({
    address: zcatToken,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [alice.account.address],
  })) as bigint;
  const txXfer = await send(alice, {
    address: zcatToken,
    abi: tokenAbi,
    functionName: "transfer",
    args: [carol.account.address, hop],
  });
  const balAfter = (await publicClient.readContract({
    address: zcatToken,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [alice.account.address],
  })) as bigint;
  if (balBefore - balAfter !== hop) throw new Error("transfer tax detected");
  log("12_tax_free_transfer", {
    tx: txXfer.hash,
    sent: hop.toString(),
    aliceDelta: (balBefore - balAfter).toString(),
  });

  const carolBefore = (await publicClient.readContract({
    address: zcatToken,
    abi: tokenAbi,
    functionName: "pendingRewards",
    args: [carol.account.address],
  })) as bigint;
  const txAfter = await buy(bob, zcatToken, A.ZEC as Address, 500n * 10n ** 8n);
  const carolAfter = (await publicClient.readContract({
    address: zcatToken,
    abi: tokenAbi,
    functionName: "pendingRewards",
    args: [carol.account.address],
  })) as bigint;
  log("13_trade_after_transfer", {
    tx: txAfter.hash,
    carolRewardsBefore: carolBefore.toString(),
    carolRewardsAfter: carolAfter.toString(),
  });
  if (carolAfter <= carolBefore) throw new Error("Carol should accrue after receiving tokens");

  await send(alice, {
    address: A.ReactorHook as Address,
    abi: hookAbi,
    functionName: "flush",
    args: [A.ZEC, zcatToken],
  });
  const tokenZec = (await publicClient.readContract({
    address: A.ZEC as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [zcatToken],
  })) as bigint;
  const pendingNow = (await publicClient.readContract({
    address: zcatToken,
    abi: tokenAbi,
    functionName: "pendingRewards",
    args: [alice.account.address],
  })) as bigint;
  if (tokenZec < pendingNow) throw new Error(`insolvent token ZEC ${tokenZec} < ${pendingNow}`);
  const claim = await send(alice, {
    address: zcatToken,
    abi: tokenAbi,
    functionName: "claimRewards",
    args: [alice.account.address],
  });
  log("14_claim", { tx: claim.hash });

  // USDC-quoted market so buyback can execute on the configured route
  const ucat = await send(deployer, {
    address: A.ReactorFactory as Address,
    abi: factoryAbi,
    functionName: "instantLaunch",
    args: [
      {
        name: "UCAT",
        symbol: "UCAT",
        decimals: 18,
        supply: 0n,
        quote: A.USDC,
        fdvQuoteRaw: 50_000n * 10n ** 6n,
        devBuyQuote: 0n,
        image: "/icons/ucat.svg",
        description: "USDC-quoted official market to fuel CORE buyback.",
        website: "",
        twitter: "",
        telegram: "",
      },
    ],
  });
  const ucatEv = await publicClient.getContractEvents({
    address: A.ReactorFactory as Address,
    abi: factoryAbi,
    eventName: "TokenCreated",
    fromBlock: ucat.receipt.blockNumber,
    toBlock: ucat.receipt.blockNumber,
  });
  const ucatToken = ucatEv[0]!.args.token as Address;
  const usdcBuy = 10_000n * 10n ** 6n;
  await buy(alice, ucatToken, A.USDC as Address, usdcBuy);
  await send(alice, {
    address: A.ReactorHook as Address,
    abi: hookAbi,
    functionName: "flush",
    args: [A.USDC, ucatToken],
  });
  const usdcReserve = (await publicClient.readContract({
    address: A.BuybackVault as Address,
    abi: buybackAbi,
    functionName: "accrued",
    args: [A.USDC],
  })) as bigint;
  const vaultUsdc = (await publicClient.readContract({
    address: A.USDC as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [A.BuybackVault],
  })) as bigint;
  const expectedUsdcBuyback = feeSplit(usdcBuy).buyback;
  log("15_usdc_reserve_for_buyback", {
    ucat: ucatToken,
    usdcReserve: usdcReserve.toString(),
    vaultUsdc: vaultUsdc.toString(),
    expected: expectedUsdcBuyback.toString(),
  });
  if (vaultUsdc < usdcReserve) throw new Error("buyback vault missing USDC after flush");

  const burnedBefore = (await publicClient.readContract({
    address: A.BuybackVault as Address,
    abi: buybackAbi,
    functionName: "lifetimeBurned",
  })) as bigint;
  const exec = await send(alice, {
    address: A.BuybackVault as Address,
    abi: buybackAbi,
    functionName: "execute",
    args: [A.USDC, usdcReserve, 0n, BigInt(Math.floor(Date.now() / 1000) + 600)],
  });
  const burnedAfter = (await publicClient.readContract({
    address: A.BuybackVault as Address,
    abi: buybackAbi,
    functionName: "lifetimeBurned",
  })) as bigint;
  log("16_core_burn", {
    tx: exec.hash,
    burnedBefore: burnedBefore.toString(),
    burnedAfter: burnedAfter.toString(),
    delta: (burnedAfter - burnedBefore).toString(),
  });
  if (burnedAfter <= burnedBefore) throw new Error("CORE was not burned");

  const fair = await send(deployer, {
    address: A.ReactorFactory as Address,
    abi: factoryAbi,
    functionName: "createFairLaunch",
    args: [
      {
        name: "FCAT",
        symbol: "FCAT",
        decimals: 18,
        supply: 0n,
        quote: A.ZEC,
        duration: 60n,
        auctionBps: 0,
        minRaise: 0n,
        image: "/icons/fcat.svg",
        description: "Fair launch — 0% during auction, 3% after migrate.",
        website: "",
        twitter: "",
        telegram: "",
      },
    ],
  });
  const fairEv = await publicClient.getContractEvents({
    address: A.ReactorFactory as Address,
    abi: factoryAbi,
    eventName: "FairLaunchCreated",
    fromBlock: fair.receipt.blockNumber,
    toBlock: fair.receipt.blockNumber,
  });
  const fairId = fairEv[0]!.args.fairId as bigint;
  const fcatToken = fairEv[0]!.args.token as Address;
  log("17_fair_create", { tx: fair.hash, fairId: fairId.toString(), token: fcatToken });

  const accruedBeforeAuction = (await publicClient.readContract({
    address: A.BuybackVault as Address,
    abi: buybackAbi,
    functionName: "accrued",
    args: [A.ZEC],
  })) as bigint;

  await send(alice, {
    address: A.ZEC as Address,
    abi: erc20Abi,
    functionName: "approve",
    args: [A.ReactorFactory, 1_000n * 10n ** 8n],
  });
  const bidA = await send(alice, {
    address: A.ReactorFactory as Address,
    abi: factoryAbi,
    functionName: "bid",
    args: [fairId, 1_000n * 10n ** 8n],
  });
  await send(bob, {
    address: A.ZEC as Address,
    abi: erc20Abi,
    functionName: "approve",
    args: [A.ReactorFactory, 2_000n * 10n ** 8n],
  });
  const bidB = await send(bob, {
    address: A.ReactorFactory as Address,
    abi: factoryAbi,
    functionName: "bid",
    args: [fairId, 2_000n * 10n ** 8n],
  });
  const accruedDuring = (await publicClient.readContract({
    address: A.BuybackVault as Address,
    abi: buybackAbi,
    functionName: "accrued",
    args: [A.ZEC],
  })) as bigint;
  log("18_bids", {
    alice: bidA.hash,
    bob: bidB.hash,
    buybackUnchanged: accruedDuring === accruedBeforeAuction,
  });
  if (accruedDuring !== accruedBeforeAuction) throw new Error("3% charged during CCA — forbidden");

  await publicClient.request({
    method: "evm_increaseTime" as never,
    params: [70] as never,
  });
  await publicClient.request({ method: "evm_mine" as never, params: [] as never });

  const fin = await send(deployer, {
    address: A.ReactorFactory as Address,
    abi: factoryAbi,
    functionName: "finalizeFairLaunch",
    args: [fairId],
  });
  const finInfo = await publicClient.readContract({
    address: A.ReactorFactory as Address,
    abi: factoryAbi,
    functionName: "tokenInfo",
    args: [fcatToken],
  });
  const live = (finInfo as { marketLive: boolean }).marketLive ?? Boolean((finInfo as unknown as unknown[])[5]);
  const fcatPool = (finInfo as { poolId: Hex }).poolId ?? (finInfo as unknown as Hex[])[4];
  log("19_finalize", { tx: fin.hash, marketLive: live });
  log("20_migrate", { poolId: fcatPool, marketLive: live });
  if (!live) throw new Error("fair market not live");

  await send(alice, {
    address: A.ReactorFactory as Address,
    abi: factoryAbi,
    functionName: "claimFairTokens",
    args: [fairId, alice.account.address],
  });

  const accruedPreTrade = (await publicClient.readContract({
    address: A.BuybackVault as Address,
    abi: buybackAbi,
    functionName: "accrued",
    args: [A.ZEC],
  })) as bigint;
  const post = await buy(carol, fcatToken, A.ZEC as Address, 200n * 10n ** 8n);
  const accruedPost = (await publicClient.readContract({
    address: A.BuybackVault as Address,
    abi: buybackAbi,
    functionName: "accrued",
    args: [A.ZEC],
  })) as bigint;
  const expectedPost = feeSplit(200n * 10n ** 8n);
  log("21_post_migration_trade", { tx: post.hash });
  log("22_three_percent_after_only", {
    accruedDelta: (accruedPost - accruedPreTrade).toString(),
    expectedBuyback: expectedPost.buyback.toString(),
    auctionCharged: false,
  });
  if (accruedPost - accruedPreTrade !== expectedPost.buyback) {
    throw new Error("post-migration buyback share mismatch");
  }

  const hookOfficial = await publicClient.readContract({
    address: A.ReactorHook as Address,
    abi: hookAbi,
    functionName: "official",
    args: [zcatPoolId],
  });

  log("23_onchain_truth", {
    zcatOfficial: hookOfficial,
    note: "UI reads the same factory/token/vault views. No fabricated stats.",
  });

  evidence.finishedAt = new Date().toISOString();
  evidence.success = true;
  const out = "/workspace/deployments/e2e-evidence.json";
  writeFileSync(out, JSON.stringify(evidence, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log(`\nWrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
