# Curve math

> Instant bonding constants are protocol-owned. Creators have no FDV / supply / fee knobs. Not single-sided v4 from trade #1.

Clean-room constant-product **virtual-reserve** curve. Simulation date: 2026-09-11. Target: **~$5,000 starting FDV** on USDC-6. 3.5% quote-side fee verified.

`docs:check` fails if supply / Dev Buy / fee copy drifts. Source: `CURVE_DESIGN.md`.

## Frozen constants

| Symbol | Value |
| --- | --- |
| Total supply | `1_000_000_000e18` (**1B / 18**) |
| Curve inventory | **79.31%** = `793_100_000e18` |
| v4 reserve | **20.69%** = `206_900_000e18` |
| Virtual token offset | `V_off = S_curve * S_lp / (S_curve - S_lp)` ≈ `279_925_605.595e18` |
| Virtual token₀ | `S_curve + V_off` ≈ `1_073_025_605.595e18` |
| Start FDV (USDC) | **`5_000e6`** |
| Virtual quote₀ (USDC-6) | `FDV * virtualToken₀ / supply` = **`5_365.128027` USDC** (`5365128027` raw) |
| Economic quote to graduate | `Q₀ * S_curve / V_off` = **`15_200.763892` USDC** |
| Last curve / first v4 FDV | **`~$73,469`** |
| Continuity `P_curve / P_v4` | `1 + ~1.4e-14` (wei rounding) |
| Dev buy cap | **5% of supply by token out** = `50_000_000e18` |
| Fee | 3.5% quote, **not** graduation liquidity |
| Instant `curveConfig` | `INSTANT_CURVE_V1` |

## Prices (USDC)

| | USDC / token | FDV |
| --- | --- | --- |
| Curve open | `5.0e-6` | $5,000 |
| Curve close / v4 open | `7.347e-5` | $73,469 |

v4 initializes with **exactly** `reservedLp` tokens + `realQuote` (economic curve quote only). Leftover unsold curve inventory stays locked on the curve — it cannot leak to creator or LP.

## Who may use unsigned geometry

Only **usdPegOne** assets (Guardian flag; initially canonical USDC) use that USDC-6 `Q₀` unsigned. Category.Stablecoins is **not** $1 — EURC must be signed.

Non-peg quotes (ZEC / WBTC / EURC / native 18) take Factory-verified signed `LaunchPricingAuthorization.virtualQuote0` as the curve’s `virtualQuote`. Digest is unique per creator/quote/virtualQuote0/curveConfig/salt/deadline/chain — no serial nonce.

The pricing signer computes `virtualQuote0ForUsd(supply, qdec, quoteUsd6)` via ValuationService (accepted consensus mark) so start FDV is **~$5k USD-equivalent**. If valuation is unavailable that quote launch is disabled. Same USD buy size → same token-out geometry. **Not an onchain ZEC/USD oracle.**

## Fee effects (USDC, buys only, no sells)

Users pay 3.5%; **96.5%** enters virtual reserves.

| Path | Economic quote | User spend | Protocol fee |
| --- | --- | --- | --- |
| Fill to graduation | $15,200.76 | **$15,752.09** | $551.32 |
| + v4 to $250k Top-10 floor | +$12,839.56 in pool | **+$13,305** | ~$466 |

Ungraduated tokens are **not** Top-10 eligible.

## Dev buy (fresh curve, full 3.5%)

Token-out cap 50M (**5%**). Quote-in that would exceed the cap **reverts** (no silent clip).

| Token out | Curve quote (96.5%) | User pays | Fee |
| --- | --- | --- | --- |
| 1% (10M) | $50.47 | $52.30 | $1.83 |
| 2% (20M) | $101.90 | $105.60 | $3.70 |
| 5% (50M) | $262.22 | $271.73 | $9.51 |

No free allocation. Creator purchase is disclosed forever (`devBought`). Rewards mode: fees are credited **before** tokens are delivered, so the creator does not inherit historic rewards; dust carries if eligible supply is 0.

## Ready / freeze / graduate

- Terminal buy clips to remaining-to-target (and inventory).
- Fees on a terminal/partial fill apply only to **executed gross**. `quoteIn - executedGross` is refunded (unexecuted + unearned fee).
- When `ready`, buy and sell revert `ReadyLocked`.
- `graduate` requires `ready` and revalidates reserves. Repeat reverts.

See [Launch lifecycle](/docs/lifecycle).

## Why 79.31 / 20.69

Chosen so `V_off = S_curve * S_lp / (S_curve - S_lp)` makes **last curve marginal price = v4 spot** when the curve inventory is sold and `realQuote` plus `S_lp` seed the pool. This is the public Pump-style identity; the $5k start FDV is ours.

## Rejected (do not re-propose)

- Creator-set FDV / supply / fee / curve knobs
- Single-sided permanent v4 from trade #1
- Putting protocol fee quote into graduation LP
- Silent cap on oversized dev buys

Continue: [Economics](/docs/economics) · [Fees](/docs/fees) · `CURVE_DESIGN.md`.
