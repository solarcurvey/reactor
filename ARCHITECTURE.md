# ARCHITECTURE

## Onchain modules

| Contract | Upgradeable | Custody | Role |
| --- | --- | --- | --- |
| `ReactorToken` | No | Holds claimable quote | Fixed-supply ERC-20 + O(1) rewards |
| `CoreToken` (alias `TestCORE`) | No | None | REACTOR CORE / CORE; genesis 100M vest + 900M LP; mint once |
| `TickerRegistry` | No | None | Global ticker identity + factory versions + usedAuthorization |
| `CoreVesting` | No | 100M CORE | Immutable beneficiary; T0 launch; 30d cliff 0 then 10×30d linear |
| `CoreLiquidityVault` | No | Official CORE/USDC LP | Single-sided 900M lock; no withdraw |
| `CoreBuybackExecutor` | No | Transient USDC | Only fee-exempt official CORE buy |
| `MockERC20` | No | Optional faucet mint (test) | Labeled mock quotes (ZEC/BTC/NVDA) |
| `ReactorGuardian` | No | None | Immutable Guardian + replaceable Keeper + pauses + adapters |
| `QuoteAssetRegistry` | No | None | External quotes Guardian-curated; native quotes from graduation |
| `ReactorHook` | No | Transient quote during swap | Official-pool identity + 3.5% quote fee |
| `ReactorLiquidityVault` | No | Official LP positions | Lock-only v4 positions |
| `BuybackVault` | No | Accrued quote | Keeper CORE buy+burn via approved adapters |
| `ReactorRouter` | No | None | Unlock callback: swap / add liquidity |
| `InstantCurve` | No | Curve inventory + economic quote | Bonding curve; graduates to locked v4 |
| `SelfBurnVault` | No | Standard-mode 2% quote | Keeper market-buy + burn |
| `FlywheelVault` | No | Quote / USDC pot | Keeper settle + API-submitted Top-10 |
| `UniswapV4Adapter` | No | Transient hop | User hops; fees apply; hookless or official REACTOR hook only |
| `ProtocolV4Adapter` | No | Transient hop | Protocol vaults only; `protocolSwap` fee-exempt; not Keeper EOA, not UserRoute |
| `UserRouteExecutor` | No | Transient user funds | USDC↔token official-leg router; not a protocol vault |
| `ReactorFactory` | No | None during idle | Instant + Batch Fair Launch, priced non-$1 init, metadata, events |
| `FairClaimVault` | No | Unclaimed auction tokens + their quote slice | O(1) eligible holder for Batch Fair |
| `PoolManager` | Uniswap | All v4 reserves | Official v4-core (BUSL, non-production) |

Fewer moving parts than a full periphery stack: no PositionManager NFT, no Universal Router, no upgrade proxies.

## Official pool identity

A pool is official iff it was initialized through `ReactorHook.beforeInitialize` (factory-only) with:

- `hooks == ReactorHook`
- `fee == 0`
- quote in `QuoteAssetRegistry`
- launch token ≠ CORE, quote ≠ CORE

`afterInitialize` stores `official[poolId]` and `marketOfToken[token]`. The hook charges **only** those pool IDs. `flush` derives quote from that record.

External / hookless pools of the same token are allowed. They do not pay REACTOR economics. Economics attach to the official market, not the token.

## Swap path

```
User → ReactorRouter.unlock
     → PoolManager.swap (lpFee = 0)
         → hook.beforeSwap   (quote specified  → take 3.5% unless protocolExempt)
         → CL swap
         → hook.afterSwap    (quote unspecified → take 3.5% unless protocolExempt)
             → split 2 / 1 / 0.5
             → Rewards: token.creditRewards · Standard: SelfBurn.accrue
             → flywheel.accrue + buyback.accrue
     → settle / take
```

Pre-graduation Instant trades settle on `InstantCurve` (same 3.5% quote split). After `graduate()`, the official hooked 0% LP pool is the market.

## Launch paths

**Instant.** Factory deploys `ReactorToken` (1B/18 to `InstantCurve`, excluded). Curve opens with protocol virtual reserves. Users buy/sell immediately. Economic quote accumulates; protocol fees do not seed LP. Anyone may `graduate()` once ready — that locks reserved 20.69% + real curve quote as full-range v4 liquidity forever. Optional atomic `launchAndBuy` (full 3.5%, 5% token-out cap). Graduated tokens register as native quotes without Guardian.

**Fair.** Factory deploys token (supply held by factory). Bidders transfer quote in. After `endTime`, `finalize` once: pro-rata claimable tokens; remainder + raised quote locked as two-sided official liquidity; leftover bidder tokens claimable. No 3% during bids.

## Offchain

- **Indexer:** production data model (Postgres when `DATABASE_URL` is set; SQLite local-only). Tables cover tokens/markets/quotes/pools/trades/candles/bonding/graduations/rewards/claims/selfburn/flywheel/CORE/Top-10/keeper/guardian/routes/marks/metadata. Never the source of truth for balances or fees.
- **ValuationService:** one recursive CAT→ZCAT→ZEC→USD path with ancestry. Parent-only USD is rejected.
- **Quote API:** `POST /quote` plans proven venues only (≤3 hops), simulates server-side, discloses each official 3.5% leg.
- **Web:** homepage is `GET /markets` (zero per-token RPC). Trades use the quote API — no wallet hop sim for missing intermediate assets.
- **Pricing signer:** isolated process. Next never holds the key. Fail closed if down. No Anvil fallback outside `REACTOR_ENV=LOCAL`.
- **Media:** validate + resize/WebP → object store; short URI onchain. No base64 metadata.
- **SSE:** `/stream` for launches/trades/bonding/grad/rewards/burns/Top-10/CORE with reconnect/fallback.

## Trust boundaries

| Actor | Can |
| --- | --- |
| Guardian | Pause launches / Keeper / trading; replace Keeper; add or quarantine **external** quotes; add or disable reviewed adapters. No `setHook`. Cannot withdraw, redirect pots, change 3.5% or 2/1/0.5, set Top-10, mint, upgrade. See `GUARDIAN_MODEL.md`. |
| Keeper | Scoped settle / SelfBurn / Top-10 submit+buy / CORE buy+burn through approved adapters. Cannot config or withdraw. See `KEEPER_MODEL.md`. |
| Anyone | Launch (if open), bid, trade (if open), claim, graduate a ready curve |
| Hook | Credit rewards and vaults; cannot change CORE or fee BPS |

Different economics require a V2 deploy.
