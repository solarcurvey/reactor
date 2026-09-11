# Curve math

Instant uses frozen virtual-reserve geometry. Creators do not pick FDV.

## Virtual quote₀

usdPegOne (canonical USDC) uses protocol USDC-6 start:

`virtualQuote0 = f(DEFAULT_SUPPLY, quoteDecimals)`

Non-$1 quotes use a signed `virtualQuote0` so a $50 ZEC and a $60k WBTC open at the same **USD** start FDV. EURC is a stablecoin category and is **not** $1.

Worked example (same $150 buy, exact USD match):

| Quote | USD/unit | Quote in | Token out |
| --- | --- | --- | --- |
| USDC-6 | $1 | 150e6 | ≈ same |
| ZEC-8 | $50 | 3e8 | ≈ same |
| WBTC-8 | $60,000 | 250,000 | ≈ same |

See `LaunchPricing.t.sol` `test_usdEquivalentGeometry_usdcZecWbtcNative` and `CURVE_DESIGN.md`.

## Graduation

When real quote hits the target, buys/sells freeze (`ready`). `graduate()` locks reserved tokens + economic quote as full-range official v4. Ready-state fees apply only to executed gross quote. Oversized terminal clips and refunds unexecuted input.
