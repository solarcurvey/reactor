# Architecture

> Immutable modules. No upgrade proxies. Official identity is the hooked 0% LP pool. Protocol **{{protocolVersion}}**. Factory **{{factoryVersionLabel}}**.

Fewer moving parts than a full periphery stack: no PositionManager NFT, no Universal Router, no upgrade proxies. Source: `ARCHITECTURE.md`.

## Onchain modules

| Contract | Upgradeable | Custody | Role |
| --- | --- | --- | --- |
| `ReactorToken` | No | Holds claimable quote | Fixed-supply ERC-20 + O(1) rewards |
| `CoreToken` (alias `TestCORE`) | No | None | REACTOR CORE / CORE; genesis 100M vest + 900M LP; mint once |
| `TickerRegistry` | No | None | Global ticker identity + factory versions + usedAuthorization |
| `CoreVesting` | No | 100M CORE | Immutable beneficiary; T0 launch; 30d cliff 0 then 10×30d linear |
| `CoreLiquidityVault` | No | Official CORE/USDC LP | Single-sided 900M lock; no withdraw |
| `CoreBuybackExecutor` | No | Transient USDC | Only fee-exempt official CORE buy |
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
| `ProtocolV4Adapter` | No | Transient hop | Protocol vaults only; `protocolSwap` fee-exempt |
| `UserRouteExecutor` | No | Transient user funds | USDC↔token official-leg router; not a protocol vault |
| `UserRouteQuoter` | No | Transient (eth_call) | Whole-route preview; always reverts `PreviewRoute` |
| `ReactorFactory` | No | Transient quote during Dev Buy / fair bids | Instant + Batch Fair bookkeeping |
| `InstantLaunchModule` | No | None | `new ReactorToken` + EIP-712 verify + official-pool open. Factory-bound. |
| `FairClaimVault` | No | Unclaimed auction tokens + quote slice | O(1) eligible holder for Batch Fair |
| `PoolManager` | Uniswap | All v4 reserves | Official v4-core (BUSL, non-production) |

Deleted from `/src` (git history keeps them): `MarketOracle.sol`, `KeeperReserve.sol`.

## Official pool identity

A pool is official iff it was initialized through `ReactorHook.beforeInitialize` with:

- `hooks == ReactorHook`
- `fee == 0`
- quote in `QuoteAssetRegistry`
- launch token ≠ CORE, quote ≠ CORE

The hook charges **only** those pool IDs. External pools of the same token do not pay REACTOR economics.

Hook permission bits:

```
BEFORE_INITIALIZE | AFTER_INITIALIZE | BEFORE_SWAP | AFTER_SWAP
| BEFORE_SWAP_RETURNS_DELTA | AFTER_SWAP_RETURNS_DELTA
= 0x30CC
```

`Hooks.validateHookPermissions` runs in the constructor. Recalculate flags and mine a new salt if you add a callback.

## Swap path

See [Nested fees](/docs/fees) for the unlock → hook → split sequence. Pre-graduation Instant trades settle on `InstantCurve`. After `graduate()`, the official hooked 0% LP pool is the market.

## Launch paths

**Instant.** Factory / InstantLaunchModule deploys `ReactorToken` (1B/18 to `InstantCurve`, excluded). Curve opens with protocol virtual reserves. Optional atomic `launchAndBuy` (full 3.5%, 5% token-out cap). Anyone may `graduate()` once ready. Graduated tokens register as native quotes without Guardian.

**Fair.** Factory deploys token (supply held by factory). Bidders transfer quote in. After `endTime`, `finalize` once. No 3% during bids.

**EIP-170.** Factory V1 runtime stays under 24,576 with a 1,024-byte CI margin (operational cap **23,552**). `new ReactorToken` + EIP-712 verify + official-pool open live in `InstantLaunchModule` (not a proxy).

## Offchain

- **Indexer:** Postgres when `DATABASE_URL` is set; SQLite local-only. Each ingest tick writes event rows and advances `indexer_state` in one transaction. Never the source of truth for balances or fees.
- **Time units:** milliseconds (`Date.now()`) vs unix seconds (`block.timestamp` / `Date.now()/1000`) are different columns. Millisecond columns are Postgres `BIGINT` (schema v6). Do not mix units.
- **ValuationService:** one recursive USD path. External USD from the configured provider registry (consensus). `GET /top10` ranks from that service + persisted `current_supply` (schema **v11**).
- **Quote API:** proven venues, ≤3 hops, one `UserRouteQuoter` eth_call per candidate, `pickBest` winner.
- **Web:** homepage is `GET /markets`. Trades use the quote API. THE REACTOR proxies `GET /top10` — it does not walk Factory logs.
- **Keeper daemon:** designated maintenance. One `leader_locks` lease. Mainnet 5042 disabled.
- **Pricing signer:** isolated process. Fail closed if down or if the durable store cannot be opened.
- **Media:** validate + WebP → object store; short URI onchain. No base64 metadata.

## Trust boundaries

| Actor | Can |
| --- | --- |
| Guardian | Pause launches / Keeper / trading; replace Keeper; add or quarantine **external** quotes; add or disable reviewed adapters. No `setHook`. Cannot withdraw, redirect pots, change 3.5% or 2/1/0.5, set Top-10, mint, upgrade. |
| Keeper | Scoped settle / SelfBurn / Top-10 submit+buy / CORE buy+burn through approved adapters. Cannot config or withdraw. |
| Anyone | Launch (if open), bid, trade (if open), claim, graduate a ready curve |
| Hook | Credit rewards and vaults; cannot change CORE or fee BPS |

Different economics require a V2 deploy.

Continue: [Security](/docs/security) · [Guardian](/docs/guardian) · [Keeper](/docs/keeper) · `ARCHITECTURE.md`.
