# Launch lifecycle

> Instant is **bonding curve → ready → frozen → graduate → locked v4**. Fair is a timed pro-rata sale, then 50/50 locked official v4. Not audited.

Creators pick identity and quote. Protocol owns supply (**1B / 18**), Instant curve constants, start FDV, and the 3.5% split. See [Creators](/docs/creators).

## Instant

```
launch → InstantCurve open
      → buys/sells (3.5% on executed quote)
      → terminal buy hits ready
      → frozen (ReadyLocked: no buy, no sell)
      → anyone graduate()
      → reserved 20.69% + real curve quote locked as official v4 (0% LP)
```

| Stage | Trading | Fees |
| --- | --- | --- |
| Open curve | `buy` / `sell` | 3.5% of executed gross quote |
| `ready` / frozen | **None** | Already taken on the terminal executed gross; unexecuted + unearned fee refunded |
| After `graduate` | Official hooked pool | 3.5% quote-side hook |

Rules:

- `_buy` / `_sell` revert `ReadyLocked` when `ready`.
- `graduate` requires `ready` (not “quote ≥ target”) and revalidates terminal reserves.
- Repeat `graduate` reverts.
- Leftover unsold curve inventory stays locked on the curve — it cannot leak to creator or LP.
- Protocol fee quote is **not** seeded into graduation LP.
- Optional `launchAndBuy` is atomic, full 3.5%, **≤5%** token-out. Over the cap reverts.

Preferred path: terminal buy establishes exact terminal state → `ready` → frozen → permissionless `graduate`.

See [Curve math](/docs/curve). Attack tests: `test/attack/CurveFreeze.t.sol`.

## Fair (Batch Fair Launch)

Not Uniswap CCA. Not a rename of CCA.

```
launch → Factory holds supply
      → timed bids (quote in, 0% REACTOR charge)
      → endTime → finalize once
      → pro-rata claimable tokens
      → remainder + raised quote locked as two-sided official liquidity
      → leftover bidder tokens claimable via FairClaimVault
      → 3.5% starts on the official pool
```

| Item | Value |
| --- | --- |
| Charge during bids | **0%** |
| `auctionBps` | **5000** (50/50) locked |
| Default duration | **45 minutes** (signed; protocol default) |
| `curveConfig` | `keccak256(abi.encode(supply, decimals, duration, auctionBps, minRaise))` |
| `FAIR_V1` | Identifier only — hashing it as `curveConfig` reverts `WrongParams` |
| Finalize | Once. Repeat reverts. |

Fair bids do not accrue buyback. `FairClaimVault` is the O(1) eligible holder of unclaimed auction tokens.

## Official pool after either path

A pool is official iff it was initialized through `ReactorHook.beforeInitialize` (Factory, InstantCurve, or bound InstantLaunchModule) with:

- `hooks == ReactorHook`
- `fee == 0`
- quote in `QuoteAssetRegistry`
- launch token ≠ CORE, quote ≠ CORE

`afterInitialize` stores `official[poolId]` and `marketOfToken[token]`. The hook charges **only** those pool IDs.

External / hookless pools of the same token are allowed. They do not pay REACTOR economics.

## CORE is not this lifecycle

CORE has no bonding curve, no graduation, no Rewards mode, and no creator knobs. Genesis is **100M vest + 900M locked** official CORE/USDC from block one. See [CORE](/docs/core).

## Permissionless after launch

Anyone may:

- Trade when the market is open (and not ready-locked / Guardian-paused)
- Claim rewards
- `graduate` a ready Instant curve
- Bid / claim Fair inventory they are eligible for

Nobody may withdraw official LP, mint after construct, or edit frozen metadata.

Continue: [Economics](/docs/economics) · [Fees](/docs/fees) · [Architecture](/docs/architecture).
