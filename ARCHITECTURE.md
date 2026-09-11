# ARCHITECTURE

## Onchain modules

| Contract | Upgradeable | Custody | Role |
| --- | --- | --- | --- |
| `ReactorToken` | No | Holds claimable quote | Fixed-supply ERC-20 + O(1) rewards |
| `TestCORE` | No | None | Platform token; mint once to deployer |
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
| `UniswapV4Adapter` | No | Transient hop | Hookless / official / approved hooks; vaults approve it, never the Keeper EOA |
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

- **Indexer:** cache of factory/hook/vault events in SQLite. Resync from logs. Never the source of truth for balances or fees.
- **Web:** reads chain via wagmi; indexer only for lists and candles.
- **Metadata:** URI + fields emitted and stored on the factory. Local `/metadata` adapter when IPFS/S3 is absent.

## Trust boundaries

| Actor | Can |
| --- | --- |
| Guardian | Pause launches / Keeper / trading; replace Keeper; add or quarantine **external** quotes; add or disable reviewed adapters. Cannot withdraw, redirect pots, change 3.5% or 2/1/0.5, set Top-10, mint, upgrade. See `GUARDIAN_MODEL.md`. |
| Keeper | Scoped settle / SelfBurn / Top-10 submit+buy / CORE buy+burn through approved adapters. Cannot config or withdraw. See `KEEPER_MODEL.md`. |
| Anyone | Launch (if open), bid, trade (if open), claim, graduate a ready curve |
| Hook | Credit rewards and vaults; cannot change CORE or fee BPS |

Different economics require a V2 deploy.
