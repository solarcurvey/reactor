# ARCHITECTURE

## Onchain modules

| Contract | Upgradeable | Custody | Role |
| --- | --- | --- | --- |
| `ReactorToken` | No | Holds claimable quote | Fixed-supply ERC-20 + O(1) rewards |
| `TestCORE` | No | None | Platform token; mint once to deployer |
| `MockERC20` | No | Optional faucet mint (test) | Labeled mock quotes (ZEC/BTC/NVDA) |
| `QuoteAssetRegistry` | No | None | Curated quote allowlist; admin ≠ custody |
| `ReactorHook` | No | Transient quote during swap | Official-pool identity + 3% quote fee |
| `ReactorLiquidityVault` | No | Official LP positions | Lock-only v4 positions |
| `BuybackVault` | No | Accrued quote | Permissionless CORE buy+burn |
| `ReactorRouter` | No | None | Unlock callback: swap / add liquidity |
| `InstantCurve` | No | Curve inventory + economic quote | Bonding curve; graduates to locked v4 |
| `SelfBurnVault` | No | Standard-mode 2% quote | Permissionless market-buy + burn |
| `ReactorFactory` | No | None during idle | Instant + Batch Fair Launch, metadata, events |
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

**Instant.** Factory deploys `ReactorToken` (1B/18 to `InstantCurve`, excluded). Curve opens with protocol virtual reserves. Users buy/sell immediately. Economic quote accumulates; protocol fees do not seed LP. Permissionless `graduate()` locks reserved 20.69% + real curve quote as full-range v4 liquidity forever. Optional atomic `launchAndBuy` (full 3.5%, 5% token-out cap).

**Fair.** Factory deploys token (supply held by factory). Bidders transfer quote in. After `endTime`, `finalize` once: pro-rata claimable tokens; remainder + raised quote locked as two-sided official liquidity; leftover bidder tokens claimable. No 3% during bids.

## Offchain

- **Indexer:** cache of factory/hook/vault events in SQLite. Resync from logs. Never the source of truth for balances or fees.
- **Web:** reads chain via wagmi; indexer only for lists and candles.
- **Metadata:** URI + fields emitted and stored on the factory. Local `/metadata` adapter when IPFS/S3 is absent.

## Trust boundaries

| Actor | Can |
| --- | --- |
| Registry admin | Enable/disable quotes, set icon/oracle metadata |
| Anyone | Launch, bid, trade, claim, execute buyback |
| Factory owner | None of: withdraw LP, drain rewards, redirect CORE, change 2/1, mint, pause, blacklist |
| Hook | Credit rewards and buyback; cannot change CORE or fee BPS |

Different economics require a V2 deploy.
