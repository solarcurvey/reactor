# Curve math

Instant bonding constants are protocol-owned. See `CURVE_DESIGN.md`.

- Inventory 79.31% / locked v4 20.69%
- Start FDV ~$5k USDC-equivalent (`virtualQuote0` from ValuationService)
- Ready freeze: no buy/sell until `graduate`
- Oversized terminal: clip + refund unexecuted + unearned fee
- Dev Buy ≤5% token-out, full 3.5%

Creators cannot change supply, decimals, or the curve. Fair duration/minRaise are signed, not free-form after auth.

`docs:check` fails if supply / Dev Buy / fee copy drifts.
