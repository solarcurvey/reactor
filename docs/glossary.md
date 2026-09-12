# Glossary

| Term | Meaning |
| --- | --- |
| Official REACTOR Pool | Hooked Uniswap v4 pool, **0% LP**, 3.5% quote-side hook charge |
| Instant | Bonding curve → ready → frozen → graduate → locked v4 |
| Fair | Pro-rata timed sale, 0% during auction, 50/50 locked at clear |
| `INSTANT_CURVE_V1` | Instant `curveConfig` constant |
| `fairCurveConfig` | `keccak256(abi.encode(supply, decimals, duration, auctionBps, minRaise))` |
| `FAIR_V1` | Identifier only — not a valid Fair `curveConfig` |
| `launchConfigHash` | ALLOW-receipt digest of immutable launch identity |
| Turnstile | Cloudflare widget + `siteverify`. CHALLENGE ≠ ALLOW |
| Issuance bucket | Durable cap on **signed** LaunchAuthorizations |
| ValuationService | Single USD engine for signer, Top-10, `/markets` |
| Burn-adjusted supply | Remaining onchain `totalSupply` after any `burn()`. Indexer `current_supply` (schema v9) tracks it via token-level burns + bounded `totalSupply()` reconcile — not a live ≡ and not a protocol-event sum |
| `fdv_usd6` | USD-6 market cap / FDV = mark × burn-adjusted remaining supply. Not initial 1B × price |
| `usdPegOne` | Explicit $1 flag. EURC / “stable” is not $1 |
| UserRouteQuoter | Whole-route `eth_call` preview; always reverts `PreviewRoute` |
| UserRouteExecutor | User nested USDC path. Not a vault |
| Guardian | Only privileged security authority |
| Keeper | Designated maintenance. One atomic lease (renew + fence) |
| CORE | Protocol token (`CoreToken`). Never Top-10 |
| Factory V1 | Immutable on-chain factory label. Not protocol semver |
| Protocol 0.3.2 | This software + docs release |
| Millisecond columns | `Date.now()` wall clock: admission hits, issuance `updated_ms`, leader lease, Keeper jobs, alerts. Postgres `BIGINT` (schema v6) |
| Unix-seconds columns | `Date.now()/1000` or `block.timestamp`: trades, ticker lock, receipt expiry |
| Arc gas USDC | Native 18-decimal gas unit |
| Protocol USDC | ERC-20 6 decimals (`0x3600…0000` on Arc) |
